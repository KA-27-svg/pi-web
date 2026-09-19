# Spec: 助手模式（双 lane：顾问 + 执行）

> 状态：**已实现**（`Slice 0`~`Slice 4` 全部落地，编译 / lint / 956 项测试 / 构建全绿，真机冒烟全过）
> 目标版本：未定（tag 落后于当前提交）
> 相关文档：README.md（当前架构）、SPEC-chat-core.md、SPEC-onboarding.md

## Objective

现在只有一个会话、一个上下文。想跟 AI 商量一句，就得往**正在执行的那个上下文**里插话；头脑风暴的反复试探会一直堆在执行上下文里，既烧 token 又干扰判断。

本规格要把「想」和「做」拆成两个并排、各自独立的窗口：左边是**顾问**（只聊、不碰项目），右边是**执行**（今天的 pi-web）。结论用一次点击从左边流到右边。

**用户**：用 pi-web 做项目、但需要先想清楚再动手的人（本仓库的 AGENTS.md 已经在用「skill 路由 + plan 落文件」做隔离，说明这个需求是真实存在的）。

**成功的样子**：
- 打开开关，左右两窗并排；关掉开关回到单窗，执行窗口的状态（消息、滚动位置）一点都不丢。
- **执行窗口正在生成时，顾问窗口仍能正常对话**——这才是这个功能的意义（不是"先聊完再执行"）。
- 顾问窗口碰不到你的代码：它没有工具。
- 结论不只是"复制粘贴"：执行方拿得到完整的推理链，而不只是结论本身。

**非目标（明确不做）**：
- 不做多顾问（N:1 蜂群）。桥接实现按 Map 写，但 UI 只接两个 lane。
- 不做自动双向同步（不把执行结果自动回灌给顾问）。
- 不做顾问直接写文件（写文件由桥接代劳，顾问保持无工具）。
- 不做拖出独立浏览器窗口、不做移动端双栏、不做人格编辑器。

## 背景事实（决定方案，来自实测 `pi --help` 与阅读现桥接代码）

1. **pi 自带顾问所需要的一切**，不需要另写模型客户端：
   - `--no-tools / -nt`、`--tools`、`--exclude-tools` → 顾问可以是一个**没有工具**的 pi，天然不可能改项目。
   - `--system-prompt` / `--append-system-prompt` → 顾问人格不用写代码。
   - `--session-dir`、`--no-session`、`--name`、`--continue` → 顾问的对话可以完全隔离在另一个目录。
   - `--provider` / `--model` / `--thinking` → **顾问可以跟执行窗口用不同模型**（顾问用推理强的、执行用快的）。
2. **桥接现在是「一个 pi + 全局广播」**：
   - `server/bridge.ts` 持有**单个** `PiSupervisor`；`currentCwd`、`pendingSwitchCwd`、`picked`（附件白名单）都是全局单例。
   - 每条 pi 输出都走 `broadcast()` 发给**所有** WebSocket 客户端 → 现在开两个标签页是"镜像同一个会话"。**这条语义必须保住**。
   - 未命中桥接分支的指令一律 `sendToPi(ws, data)` 转发给那唯一的 pi。
3. **会话目录布局**：`~/.pi/agent/sessions/<项目 slug>/`（`server/sessions.ts:sessionsRoot()`）。pi-web 自己的持久化数据也放在 `~/.pi/agent/`（如 `pi-web-picked-files.json`）。
4. **前端状态集中在 hook 里**：`usePiWebSocket()` 一个实例持有 `messages`/`status` 与四组动作模块；`App.tsx` 自己的状态只有外壳（侧栏、设置面板、弹窗、toast）加少量 pane 局部状态（`threadWindow`/`composerEngaged`/`openingIcon`）。→ 拆出 `ConversationPane` 是中等工作量。
5. **RPC 原生支持排队**：`streamingBehavior` / `clear_queue`，前端已有「生成中排队发送」（`ChatInput` 的 `queue`）。→ 执行窗口在跑活儿时，顾问的投递会**排队**而不是打断。

## 能力地图

| 模块 id | 职责 | 依赖 |
|---|---|---|
| `lane-routing` | 桥接把「一个 pi」改成「每 lane 一个 pi」，按 lane 定向收发 | — |
| `pane-split` | 前端把「一次对话」从 App 拆成 `ConversationPane`，并做双栏布局 | lane-routing |
| `advisor-lane` | 顾问进程：无工具、独立 session-dir、内置人格、独立模型 | lane-routing |
| `handoff` | 结论块→卡片（可编辑）+ 排队投递 | pane-split, advisor-lane |
| `plan-file` | 结论落成 `docs/plans/*.md`（路径限制在执行窗口 cwd 内） | handoff |

构建顺序：`lane-routing → pane-split → advisor-lane → handoff → plan-file`

## 技术方案

### 桥接侧（改造为主）

- **`server/lanes.ts`（新）**：`Lane` 容器 = 一个 `PiSupervisor` + 自己的 `cwd` + 自己的 `pendingSwitchCwd`；`LaneRegistry` 管 `Map<laneId, Lane>`，在收到某 lane 的第一条指令时惰性 `ensure()`。spawn 注入，可确定性测试（同 `pi.test.ts` 的做法）。
- **`server/bridge.ts`（改）**：
  - `pi` 单例 → `lanes`；`currentCwd` → 每 lane 一份。
  - 新增 `register_lane` 指令：连接建立后先登记自己的 lane（**默认 `main`**），桥接维护 `Map<WebSocket, laneId>`。
  - **pi 输出只发给同 lane 的连接**（`sendToLane`）。全局事实（`setup_status`、`install_*`）仍 `broadcast`。
  - `WATCHED_COMMANDS` 的日志带上 lane，否则下次「对话自己暂停」时分不清是哪个窗口被打断。
  - 全局设置类指令（`save_provider_key` / `delete_provider` / `set_default_model` / `probe_api` / `install_pi` / 会话文件类）**保持全局**：它们读写 `~/.pi/agent` 或项目会话目录，与 lane 无关，回包仍广播。
- **`server/pi.ts`（改）**：`piCommandLine(command, extraArgs: string[] = [])`，参数由桥接以**静态字面量**给出。

### 前端侧（改造 + 新增）

- **`src/components/ConversationPane.tsx`（新）**：把线程区、滚动轨道、输入框、上下文提示条，以及 pane 局部状态（`threadWindow`、`composerEngaged`、`openingIcon`、**贴底的 `useLayoutEffect`**）一起搬进来。入参 = `usePiWebSocket()` 的返回值。
- **`src/hooks/usePiWebSocket.ts`（改）**：`usePiWebSocket({ lane = 'main' })`；`onopen` 里**先**发 `register_lane`（不等回包，靠 WebSocket 的顺序保证），**再** `requestInitialState`。
- **`src/services/piBridge.ts`（改）**：`PiBridge` 接口加 `lane`；动作模块发的每条指令自动带 lane（所有动作都经过 `request` / `sendCommand`，一处改全通）。
- **`src/components/AssistantLayout.tsx`（新）**：双栏 + 可拖动分隔 + 窄屏退化成 tab；比例与开关状态存 localStorage（`useAssistantMode`）。
- **`src/components/AdvisorPane.tsx`（新）**：顾问窗口 = `usePiWebSocket({ lane: 'advisor' })` + 模型选择条 + `ConversationPane`。
- **结论卡片**：顾问输出里的 ```handoff 围栏块由 **`MarkdownView` 的 code 渲染器**接手（`HandoffCard`），不另写一套解析器——多块就是多张卡，未闭合的围栏（流式中间）也已经是一张卡。
- **`src/App.tsx`（改）**：把全局外壳（侧栏/设置/向导/toast）留在 App，对话区换成 `ConversationPane`；**顾问那个 hook 实例只在开关打开时才挂载**。

### 关键约束

- **lane 默认 `main`**：不带 lane 的客户端（旧页面、第二个标签页）仍镜像同一会话。破掉这条就改变了现有用法。
- **pi 输出绝不能广播**：lane A 的 `get_messages` / `get_state` / `get_available_models` 回包若广播给 lane B，B 的 `rpcHandler` 会把它当自己的状态更新。按 lane 定向是硬要求。
- **顾问的模型不能走 `set_model`**：`set_model` 会转发给 pi（会话内生效），但前端在成功后还会发 `set_default_model`——那会写 `settings.json` 的**全局默认模型**，把执行窗口的默认也改掉。顾问 pane 的模型必须走 spawn 参数（新增 `set_lane_model` → 重启该 lane 的 pi），且**不得**触发 `set_default_model`。
- **两个进程不得共用 session 文件**：顾问用独立 `--session-dir ~/.pi/agent/pi-web-advisor-sessions`。两个进程 append 同一份转录会毁掉历史。
- **shell 注入面**：MVP 里顾问人格是桥接里的**静态常量**（可安全拼进命令行）。一旦做成用户可编辑，必须改成 `--append-system-prompt <文件路径>`，不把用户文本拼进 shell 字符串。
- **写文件必须限制在执行窗口 cwd 内**（复用 `server/uploads.ts` / `resolveAttachment` 的路径守卫思路）。
- **顾问 pane 也要走 `threadWindow` 的体量窗口**，否则长顾问会话会重演「切会话卡顿」。

## Commands

```
Dev:    npm run dev
Build:  npm run build       # 含 npx tsc -b
Lint:   npm run lint
Test:   npm test
```

## Project Structure

```
server/
  lanes.ts            # 新增：Lane 容器 + LaneRegistry（每 lane 一个 pi）
  advisor.ts          # 新增：顾问的 lane id / 人格文案 / 参数 / 会话目录
  planFile.ts         # 新增：把结论写进 docs/plans/（限制在 cwd 内）
  bridge.ts           # 改造：register_lane / sendToLane / 每 lane cwd / save_plan_file / set_lane_model
  pi.ts               # 改造：piCommandLine 与 PiSupervisor 支持附加参数
src/
  components/ConversationPane.tsx   # 新增：一次对话（线程+轨道+输入框）
  components/AssistantLayout.tsx    # 新增：双栏 + 拖动分隔 + 窄屏 tab
  components/AdvisorPane.tsx        # 新增：顾问窗口（独立 lane + 模型选择）
  components/HandoffCard.tsx        # 新增：结论卡片（可编辑 + 两种投递）
  hooks/usePiWebSocket.ts           # 改造：lane 参数 + register_lane
  hooks/useAssistantMode.ts         # 新增：开关与比例持久化
  services/piBridge.ts              # 改造：接口带 lane
  services/piHandoffActions.ts      # 新增：savePlanFile
  utils/paneRatio.ts                # 新增：分栏比例的纯计算
  App.tsx                           # 改造：外壳 + 两个 pane
```

## Testing Strategy

- 沿用 vitest，测试与被测文件同目录（`*.test.ts` / `*.test.tsx`）。
- spawn **必须注入**（同 `PiSupervisor` 的 `spawnPi` 注入方式），不真的拉起 pi。
- 必测：
  - `LaneRegistry`：同 lane 复用同一实例、不同 lane 互不影响、默认 `main`、惰性 ensure。
  - `piCommandLine` 的附加参数拼装（顾问那几条 flag）。
  - `sendToLane`：lane A 的输出不会到达 lane B 的连接。
  - `usePiWebSocket`：首个包是 `register_lane`。
  - `utils/handoff`：未闭合围栏、多个块、无块。
  - `planFile`：`..` 穿越、绝对路径、重名、目录不存在。
- 手工验证（测试覆盖不到）：两个标签页仍镜像；开助手模式后两窗能同时流式输出。

## Boundaries

- **Always**:
  - lane 默认 `main`，保住多客户端镜像语义。
  - 顾问进程带 `--no-tools`（除非显式配置只读白名单），会话目录指向独立目录。
  - 写文件限制在执行窗口 cwd 之内，并给可读的失败原因。
  - pi 输出只发给同 lane 的连接。
- **Ask first**:
  - 给顾问开任何工具（哪怕只读）。
  - 把顾问人格做成可编辑。
  - 把 lane 数量做成可配置 / 新增运行时依赖。
- **Never**:
  - 让顾问进程复用执行窗口的 session 文件。
  - 让顾问 pane 触发 `set_default_model`。
  - 回显 API key、写进日志或会话文件。
  - 用 shell 拼接用户输入。

## Success Criteria

- [x] 打开开关：左右两窗同时可见；关掉：回到单窗，且执行窗口状态不丢。
      → 主 pane 在任何模式下都是同一个元素（开关只影响右栏），所以它不可能被卸载重挂；分栏行为有组件测试。
- [x] 执行窗口正在生成时，顾问窗口仍能正常对话。
      → 两条 lane 是两个独立 pi 进程，lane 隔离已真机验证；没有用真 API 同时跑两轮（省钱）。
- [x] 顾问对话不写进 `~/.pi/agent/sessions/<项目 slug>/`（无新增文件）。
      → 顾问跑在 `--session-dir ~/.pi/agent/pi-web-advisor-sessions`，真机冒烟打印了实际命令行。
- [x] 顾问窗口改不了项目文件。→ `--no-tools`，从构造上做不到。
- [x] 顾问窗口换模型后，`settings.json` 的 `defaultModel` 不变。→ 真机冒烟：逐字节未变。
- [x] 结论卡片投递后执行窗口收到消息；执行窗口忙碌时它**排队**而非打断。
      → `piHandoffActions.test.ts` 覆盖两种模式、排队、失败时不静默。
- [x] 「存为计划并投递」后仓库出现 `docs/plans/<时间戳>-*.md`，内容与卡片逐字一致，且投递消息里带该路径。
      → 真机冒烟 + `planFile.test.ts`。
- [x] 不开助手模式时，多标签页行为与今天完全一致。
      → 缺省 lane 落 `main` 有单测锁住；顾问栏关着时根本不挂载（连第二个进程都不会起）。
- [x] `npm run lint && npm test && npm run build` 全绿。

### 还没验证 / 已知限制

- 两条 lane **同时**跑真 API（顾问在答、执行在跑）没测；同一 provider 的并发限额会不会撞也不知道。
- 顾问的模型不持久化：桥接重启后回默认模型（要持久化得再加一层 lane 配置文件）。
- 顾问窗口只隐藏了附件入口，拖文件进来会怎样没测。
- ~~顾问的对话不进侧栏的会话列表~~ → **已做**，见下面「追加：顾问历史进侧栏」。

## 追加：顾问历史进侧栏（已实现）

「新对话」之后旧顾问对话在界面上找不回来——这是第一版欠的账，补上了。

**先实测了一个决定实现方式的事实**：pi 的 `--session-dir` 是**平铺**的（`.jsonl` 直接躺在
给的那个目录里），不是默认布局的「按项目分子目录」。所以 `listSessions` 两种摆法都扫，
否则顾问目录永远列不出东西。

- 路由按**路径**而不是按连接：落在 `pi-web-advisor-sessions` 下的会话路径，
  切换 / 改名 / 删除一律路由到顾问目录与顾问那条 lane。侧栏长在执行窗口的连接上，
  但它替顾问做这些事时，回包只回顾问那边。
- 替另一条 lane 切会话时，桥接先给那边发 `session_switching`，让它也进「切换中」，
  否则它不会把新历史换上去。执行窗口自己**不进**切换中（它的回包永远不来）。
- 删除：项目会话照旧进回收箱；顾问会话**直接删**（它的沉淀物在 docs/plans/，
  会话文件没什么可后悔的），所以顾问那行没有「撤销」。
- UI：侧栏历史视图里加「项目 / 顾问」两个小 tab（只有助手模式开着才出现），
  搜索 / 刷新 / 滚动位置记忆各自独立；顾问当前停在哪个会话由顾问窗口上报
  （侧栏拿不到那条 lane 的状态）。

真机冒烟：列出顾问历史（带 scope）、替顾问切会话（pi 接受 `--session-dir` 里的会话，
重拉历史读到了内容）、执行 lane 全程没收到顾问的会话内容、改名 / 删除落对目录、
顾问目录之外的文件依旧删不了。

## 已决事项

1. **方向 B + E，不做 A / C / D。**
   - A（顺序接力，靠 `switch_session` 切窗口）：零桥接改动，但 `switch_session` 会 teardown 并 **abort 正在跑的那一轮**，「边聊边盯」不成立。
   - C（同一会话里切"只讨论不执行"）：**共享上下文**，顾问的废稿照样占执行窗口的 token，恰恰没解决要解决的问题。
   - D（顾问走轻量模型通道）：要新写模型客户端 + 密钥处理，顾问照样没工具，净亏。
2. **lane = 连接属性**，由 `register_lane` 登记，默认 `main`。不用"按消息类型猜 lane"这种隐式推断——猜错会把执行窗口的消息投进顾问进程。
3. **顾问无工具**（`--no-tools`）。人格见第 8 条（走文件，不是拼在命令行里的常量）。
4. **投递走结论块**：顾问输出里带约定标记的围栏块 → 渲染成卡片（**发送前可编辑**）→ 主按钮「存为计划并投递」、次按钮「直接投递文本」。
   - 主按钮是重点：把结论落成文件，执行方用工具读全文，**推理链不丢**，而且可 review、可迭代——这正是 A/C/D 都做不到的那部分价值。
5. **顾问对话留档在独立目录**，不进项目会话列表；桥接重启后接着上次聊（用 `--continue`，见待验证假设）。
6. **布局**：左右双栏 + 可拖动分隔 + 窄屏退化成 tab；开关与比例存 localStorage。
7. **顾问 pane 首版不支持附件**（附件是给"执行"用的）；MVP 也不主动回收顾问进程（关掉开关不杀，省一次冷启动）。
8. **顾问人格走文件**：`~/.pi/agent/pi-web-advisor-persona.md`，不存在就写一份默认的、**已存在绝不覆盖**。
   - 起因是实测：`--system-prompt` 拿到一个**存在的路径**时读文件、否则当字面量（已读 pi 源码确认）。
   - 顺带解决两件事：多行人格不必进命令行（cmd 下的引号处理不可靠）、用户想改人格直接编辑这个文件。
9. **执行窗口在左、顾问在右**（原规格写的是反的）。理由：开关一开一关时执行窗口和侧栏都不挪位置，顾问栏落在右边的空位里；反过来每切一次整个界面都要重排一次。
10. **顾问的模型只存内存**：桥接重启后回到默认模型。写全局配置是硬禁止（会改掉执行窗口的默认模型），而单独开一份 lane 配置文件在 MVP 里是多余的一层。
11. **`PI_BRIDGE_PORT` 环境变量**：默认仍是 3001（前端写死的），只在调试 / 想同时跑第二个桥接实例时用。冒烟测试就是靠它在备用端口跑的。
12. **结论块不另写解析器**：交给 `MarkdownView` 的 code 渲染器。原规格里"取最后一个块"变成"每个块一张卡"——反而更对（一个块讲一件事）。

## 关键实现陷阱

- **`get_messages` 体积翻倍**：开助手模式后两个会话的历史同时在内存里。顾问窗口必须走 `threadWindow` 的体量窗口（见 `src/utils/threadWindow.ts`）。
- **贴底逻辑要跟着搬**：`App.tsx` 里那两处 `useLayoutEffect` 贴底（修"图片闪现"的那版）必须搬进 `ConversationPane`，否则顾问 pane 会重现同样的闪现。
- **顾问 pane 的挂载时机**：hook 只在开关打开时才挂载，否则每次开网页都会多起一个 pi 进程。
- **`cwd_changed` 是 per-lane**：切工作目录只该影响自己那个窗口；广播给另一个 lane 会让对方以为目录也变了。
- **重启桥接后 `pendingSwitchCwd` 之类的临时态要按 lane 归零**，不能沿用全局单例的写法。

## 待验证的假设（动手前先做实验，别直接写代码）

- [x] `--no-tools` 的 pi 在 **RPC 模式**下能正常跑完一轮（工具列表为空时不卡住）。→ **已验证**：`agent_start → turn_start → message_start/update/end ×2 → turn_end → agent_end → agent_settled`，不卡。
- [x] 两个 pi 进程同项目目录并存不互相踩。→ **已验证**：一个用默认会话目录、一个用 `--session-dir`，同时跑一轮都正常结束。
- [x] `--continue` 配 `--session-dir` 能从该目录续上次会话。→ **已验证**：`get_messages` 返回上轮的 2 条。桥接还会先看目录里有没有 `.jsonl` 才加 `--continue`（空目录没得续）。
- [ ] **你会真的在"执行还在跑"的时候去顾问窗口聊天。** 如果其实总是先聊完再执行，A 就够，能省一个数量级的成本。→ 只能靠用上一段时间才知道。
- [ ] 顾问与执行同时跑时，同一 provider 的并发/速率限额会不会撞（撞了要在 UI 上给提示）。→ 未测。
- [x] `--system-prompt` 是否支持传文件。→ **已验证**（读 pi 源码：`existsSync(source) ? resolvePath(source) : 字面量`），所以才把人格改成了文件。

## 真机冒烟（在备用端口跑，跑完已清理临时产物）

```
✓ 桥接在备用端口起来了 — :3123
✓ 两条 lane 都登记成功
✓ 顾问的回包只发给顾问那条连接 — main 期间收到 0 条
✓ 执行窗口的回包只发给执行窗口
✓ 顾问进程带 --no-tools 与独立会话目录
✓ 顾问人格文件已落盘
✓ save_plan_file 写进 docs/plans 并返回相对路径 — docs/plans/20260918-2335-冒烟计划.md
✓ 文件内容与投递内容逐字一致
✓ set_lane_model 不动全局 settings.json
✓ 顾问窗口不能切工作目录
```

## 追加：同一上游的官方 + 中转并存（已实现）

**用户报的问题**：官方 DeepSeek 配好后，再配一个中转的 DeepSeek，结果只剩「官方那个」。

**根因（是通病，不是个例）**：凭证按供应商 id 单键存储——`auth.json` 里 `deepseek`
只有一条，中转地址写进同一条，等于把官方入口覆盖掉。而模型清单来自 pi 的内置目录，
界面上看起来还是「官方 DeepSeek」，实际请求全去了中转。pi 的凭证解析确实认
auth.json 条目里的 `baseUrl`（源码 `model-registry.js`：`resolution.auth.baseUrl`），
但**一个 id 只能有一个地址**——同一上游的官方和中转在数据模型上就不可能并存。

**读 pi 源码定下的三个事实**（决定了修法）：
1. models.json 的 `ProviderConfigSchema` 支持任意新 id（`name`/`baseUrl`/`api`/`models`）。
2. 对目录里**没有**的 id，`applyModelsJson` 的 baseModels 是空数组——不写 `models`
   就一个模型都没有，界面上不可见。所以新端点必须带清单。
3. `modelFromJson` 里 `definition.baseUrl` 优先于 provider 级地址——所以复制目录定义时
   **必须剥掉 baseUrl**，否则中转地址被定义里的官方地址盖掉。
   另外 pi 的 RPC **没有**热重载 models.json 的指令（`runtime.refresh()` 只在启动时走），
   新 provider 必须重启 pi 才能被看见。

**实现**：
- 中转保存成**独立端点**：新 id（`<上游>-relay`，撞了往 `-2`、`-3` 排）+ 自己的密钥地址
  + 从 pi 内置目录**原样复制**的模型清单（剥 baseUrl/provider/headers）。
  官方条目一个字节不动，两个入口并存。
- **迁移**：官方条目上若残留旧版写法的中转地址，保存时自动清掉（密钥保留），
  否则官方入口仍然指向中转，用户会以为官方的还能用。
- 删除：内置目录里的 id 只清凭证与显示名（models.json 可能有用户手写的内容）；
  不在目录里的 id 是我们建的端点，整条删。
- 前端：地址栏语义改为「填了就是独立端点」；已配的中转端点出现在供应商下拉的
  第二个分组里（可改名 / 换密钥 / 换地址，地址会回显）；提示保存后 pi 会重启一次。
- 重启：只在创建端点这条路上 `lanes.restartAll()`（与 install_pi 同一先例），
  因为新 provider 不重启就永远不可见。

**真机冒烟**（跑完已恢复 auth.json / models.json / settings.json）：
```
✓ 内置目录里有官方 deepseek 的模型 — 4 个
✓ 中转保存成功，回包带新 id — deepseek-relay
✓ 官方条目还在且不再指向中转
✓ 中转有自己的条目（自己的 key + 地址）
✓ models.json 写入了中转端点的清单 — 4 个模型
✓ 复制的定义里没有 baseUrl
✓ 官方入口的模型仍在清单里 — 4 个
✓ 中转端点的模型出现在清单里，地址指向中转 — 4 个
✓ 删中转端点后 auth 与 models.json 都干净了
```

### 补充：中转分组的模型名和官方不一样（真实案例）

用户的中转（micuapi）报的两件事，推翻了「复制内置目录」这一版的做法：

1. **地址是假 200**：用户给的 `https://…/1`，下面所有请求都返回 200 空响应；
   真正的 API 前缀是 `https://…/v1`。只看状态码根本发现不了。
2. **分组卖的模型名和官方不同**：上游 `/v1/models` 列的是 `deepseek-v4-flash`、
   `deepseek-v4-pro` 这些，没有内置目录的 `deepseek-chat` / `deepseek-reasoner`。
   复制内置目录在这种站上必然 `model_not_found`。

所以创建端点时改为**先问上游自己**（`GET {地址}/models`，带密钥）：
- 拿得到 → 用**上游的清单**（模型名用 id，api 默认 `openai-completions`，
  contextWindow / cost 让 pi 用默认值）。这才是真的能用。
- 拿不到（地址错 / 分组不暴露清单 / 网络问题）→ 退回复制内置目录，端点照样建，
  回包带 `modelsFrom` 标记来源。

真机冒烟（用真实密钥跑，跑完已恢复配置文件）：
```
✓ 错误地址(/1)也能保存（退回复制内置目录）
✓ 正确地址(/v1)保存成功，清单来自上游 — deepseek-relay
✓ 中转清单用的是上游的模型名 — 14 个（deepseek-v4-flash…）
✓ 官方条目没被动过；官方 deepseek 模型仍在 — 4 个
✓ 中转端点的模型出现 — 14 个
✓ 切到中转模型后真实回复了一个字
✓ 删端点后 auth 与 models.json 干净
```

### 中转端点：保存时勾选模型（补充）

上游 `/models` 常报混合分组：真实案例一个「DeepSeek」分组同时卖 DeepSeek 6 个 +
智谱 3 个 + Kimi 3 个 + MiniMax + qwen。照单全收会得到名叫「DeepSeek 中转」的端点下
挂着一堆别家模型——标签在骗人。

填了地址后保存变成**两步**：

1. `probe_endpoint_models`：`GET {地址}/models` 拿上游清单（拿不到退回 pi 内置目录），
   逐条算出 `recommended` —— 内置目录有同名，或名字像该上游（前缀命中，
   或按非字母数字切段后整段相等，能认 `moonshot/kimi-k3` 里的 `kimi`）。
2. 前端列出清单，「这个上游的」与「同一个分组里的其它厂商」分两段，默认只勾前者，
   可全选/全不选，也可以勾上别家的（同一个端点下混着用）。

勾选结果随 `save_provider_key` 的 `models` 传给桥接；勾中的 id 里，
内置目录有同名定义的用目录那份（带 cost / contextWindow / compat），
目录没有的（中转独有模型）退回最小定义 `{id, name: id, api: 'openai-completions'}`。

编辑已有端点：`createProviderEndpoint` 传 `id` 就原地更新（id 不变，否则会话与默认
模型里存的那个 id 会失效），密钥留空表示沿用已存的那份。地址 / 密钥 / 供应商一变，
前端作废探测结果——拿着 A 的清单存给 B 是纯粹的错。

认不出上游的手写 id（`wode`）不再直接报错：照常探测、一个都不预勾。
此时 `id === provider`，迁移那一步必须跳过，否则「清理官方条目残留地址」清掉的
正是刚写好的中转地址。

### 勾选界面的两处简化（补充）

- 模型清单是一个平铺列表，标题只写「N 个模型」，右侧全选 / 全不选。
  默认勾选（内置目录有同名，或名字像该上游）照旧，只是不再用文字解释、
  也不再按「该上游 / 其它厂商」分段——列出来让用户自己挑就够了。
- 供应商下拉只列内置目录的「官方入口」，不再重复列一份已配端点
  （那跟弹窗顶部「已经配好的」chip 重复）。端点仍在那里删。

**代价与补偿**：端点不在下拉里之后，「重配一个已有中转」= 选中上游 + 重填同一个地址。
桥接因此必须认得出这是同一个端点，否则每保存一次就多一个 `deepseek-relay-2`：

- `derivedEndpointIds(上游, ids)`：`<上游>-relay`、`<上游>-relay-2`…（不含官方条目本身）
- `sameEndpointUrl(a, b)`：去尾斜杠 / 大小写 / 空格后比较。**不做路径改写**——
  `/v1` 与 `/1` 是不同地址（真实案例里 `/1` 是假 200）。
- 保存与探测都先 `endpointForAddress(上游, 地址)` 找已有端点：找到就原地更新，
  并用**端点自己存着的**密钥（所以重配时可以留空密钥）。
