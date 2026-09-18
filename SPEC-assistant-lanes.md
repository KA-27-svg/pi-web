# Spec: 助手模式（双 lane：顾问 + 执行）

> 状态：**已定方向（B + E），待排期**
> 目标版本：未定
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
| `handoff` | 结论块解析 + 投递卡片（可编辑）+ 排队投递 | pane-split, advisor-lane |
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
- **`src/hooks/usePiWebSocket.ts`（改）**：`usePiWebSocket({ lane = 'main' })`；`onopen` 里**先**发 `register_lane`，**再** `requestInitialState`。
- **`src/services/piBridge.ts`（改）**：`PiBridge` 接口加 `lane`；动作模块发的每条指令自动带 lane（所有动作都经过 `request` / `sendCommand`，一处改全通）。
- **`src/components/AssistantLayout.tsx`（新）**：双栏 + 可拖动分隔 + 开关 + 窄屏退化成 tab；比例与开关状态存 localStorage。
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
  bridge.ts           # 改造：register_lane / sendToLane / 每 lane cwd
  pi.ts               # 改造：piCommandLine 支持附加参数
  planFile.ts         # 新增：把结论写进 docs/plans/（限制在 cwd 内）
src/
  components/ConversationPane.tsx   # 新增：一次对话（线程+轨道+输入框）
  components/AssistantLayout.tsx    # 新增：双栏 + 拖动分隔 + 开关
  hooks/usePiWebSocket.ts           # 改造：lane 参数 + register_lane
  services/piBridge.ts              # 改造：接口带 lane
  utils/handoff.ts                  # 新增：结论块解析
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

- [ ] 打开开关：左右两窗同时可见；关掉：回到单窗，且执行窗口消息与滚动位置不丢。
- [ ] 执行窗口正在生成时，顾问窗口仍能正常对话并流式输出。
- [ ] 顾问对话不写进 `~/.pi/agent/sessions/<项目 slug>/`（无新增文件）。
- [ ] 顾问窗口改不了项目文件（让它"创建个文件试试"，它做不到）。
- [ ] 顾问窗口换模型后，`settings.json` 的 `defaultModel` 不变。
- [ ] 结论卡片投递后执行窗口收到消息；执行窗口忙碌时它**排队**而非打断。
- [ ] 「存为计划并投递」后仓库出现 `docs/plans/<时间戳>-*.md`，内容与卡片逐字一致，且投递消息里带该路径。
- [ ] 不开助手模式时，多标签页行为与今天完全一致。
- [ ] `npm run lint && npm test && npm run build` 全绿。

## 已决事项

1. **方向 B + E，不做 A / C / D。**
   - A（顺序接力，靠 `switch_session` 切窗口）：零桥接改动，但 `switch_session` 会 teardown 并 **abort 正在跑的那一轮**，「边聊边盯」不成立。
   - C（同一会话里切"只讨论不执行"）：**共享上下文**，顾问的废稿照样占执行窗口的 token，恰恰没解决要解决的问题。
   - D（顾问走轻量模型通道）：要新写模型客户端 + 密钥处理，顾问照样没工具，净亏。
2. **lane = 连接属性**，由 `register_lane` 登记，默认 `main`。不用"按消息类型猜 lane"这种隐式推断——猜错会把执行窗口的消息投进顾问进程。
3. **顾问无工具**（`--no-tools`），人格在 MVP 是桥接里的静态常量。
4. **投递走结论块**：顾问输出里带约定标记的围栏块 → 渲染成卡片（**发送前可编辑**）→ 主按钮「存为计划并投递」、次按钮「直接投递文本」。
   - 主按钮是重点：把结论落成文件，执行方用工具读全文，**推理链不丢**，而且可 review、可迭代——这正是 A/C/D 都做不到的那部分价值。
5. **顾问对话留档在独立目录**，不进项目会话列表；桥接重启后接着上次聊（用 `--continue`，见待验证假设）。
6. **布局**：左右双栏 + 可拖动分隔 + 窄屏退化成 tab；开关与比例存 localStorage。
7. **顾问 pane 首版不支持附件**（附件是给"执行"用的）；MVP 也不主动回收顾问进程（关掉开关不杀，省一次冷启动）。

## 关键实现陷阱

- **`get_messages` 体积翻倍**：开助手模式后两个会话的历史同时在内存里。顾问窗口必须走 `threadWindow` 的体量窗口（见 `src/utils/threadWindow.ts`）。
- **贴底逻辑要跟着搬**：`App.tsx` 里那两处 `useLayoutEffect` 贴底（修"图片闪现"的那版）必须搬进 `ConversationPane`，否则顾问 pane 会重现同样的闪现。
- **顾问 pane 的挂载时机**：hook 只在开关打开时才挂载，否则每次开网页都会多起一个 pi 进程。
- **`cwd_changed` 是 per-lane**：切工作目录只该影响自己那个窗口；广播给另一个 lane 会让对方以为目录也变了。
- **重启桥接后 `pendingSwitchCwd` 之类的临时态要按 lane 归零**，不能沿用全局单例的写法。

## 待验证的假设（动手前先做实验，别直接写代码）

- [ ] `--no-tools` 的 pi 在 **RPC 模式**下能正常跑完一轮（工具列表为空时不卡住）。
- [ ] 两个 pi 进程同项目目录并存不互相踩：pi 里**没找到会话锁**（`proper-lockfile` 只是被捆绑的依赖，没用在会话上），不同会话文件各写各的应该没事，但要实测一次。
- [ ] `--continue` 配 `--session-dir` 能从该目录续上次会话；不行就退化成"每次开新会话"。
- [ ] **你会真的在"执行还在跑"的时候去顾问窗口聊天。** 如果其实总是先聊完再执行，A 就够，能省一个数量级的成本。建议先手动模拟一星期。
- [ ] 顾问与执行同时跑时，同一 provider 的并发/速率限额会不会撞（撞了要在 UI 上给提示）。
- [ ] `--system-prompt` 是否支持传文件（只有 `--append-system-prompt` 明确写了 "text or file contents"）——这一步只影响后续的"人格可编辑"。
