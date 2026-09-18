# 任务清单：助手模式（双 lane：顾问 + 执行）

> 依据 [SPEC-assistant-lanes.md](./SPEC-assistant-lanes.md)。按依赖顺序排列，不按重要性。
> **全部完成**（每个切片收尾都跑过 `npm run lint && npm test && npm run build`）。
> 收尾状态：`tsc OK · lint OK · 963 tests passed / 3 skipped · build OK`。

## Slice 0：先验证假设（不写产品代码）✅

- [x] Task 0.1：`pi --mode rpc --no-tools` 跑一轮
  - 结果：正常走完 `agent_start → message_start/update/end ×2 → agent_end → agent_settled`，不卡
  - Verify: 手工（脚本临时写，跑完已删）
- [x] Task 0.2：同项目目录同时跑两个 pi 进程
  - 结果：一个用默认会话目录、一个用 `--session-dir`，同时跑一轮都正常结束
  - Verify: 手工
- [x] Task 0.3：`--session-dir <独立目录> --continue`
  - 结果：`get_messages` 返回上轮的 2 条 → 能续
  - 顺带发现：空目录里 `--continue` 没有会话可续，所以桥接先看目录里有没有 `.jsonl`
  - Files: `server/advisor.ts:hasAdvisorSessions`

## Slice 1：桥接 lane 化（行为不变）✅

- [x] Task 1.1：`server/lanes.ts` —— `Lane` 容器 + `LaneRegistry`
  - Acceptance: 同 laneId 复用同一 `PiSupervisor`；不同 lane 完全隔离；缺省/未知 laneId 落 `main`；首次用到才 `ensure()`
  - Verify: `server/lanes.test.ts`（14 项：白名单、惰性、隔离、回调带 lane、restart、批量、换 pi 路径）
  - Files: `server/lanes.ts`, `server/lanes.test.ts`
- [x] Task 1.2：`piCommandLine` 支持附加参数
  - Acceptance: 参数逐个 `quoteIfNeeded`；空数组时与改造前逐字一致
  - Verify: `server/pi.test.ts`（新增「带空格路径过引号」）
  - Files: `server/pi.ts`, `server/pi.test.ts`
- [x] Task 1.3：桥接接线 —— `register_lane` + 按 lane 定向收发 + 每 lane cwd
  - Acceptance: pi 输出只到同 lane 的连接；`setup_status` / `install_*` 仍广播；不带 lane 的客户端落 `main`；`WATCHED_COMMANDS` 日志带 lane
  - Verify: 现有测试全绿 + 真机冒烟（顾问的回包 0 条漏到执行窗口，反之亦然）
  - Files: `server/bridge.ts`
  - 顺带：新增 `PI_BRIDGE_PORT`（调试/多实例用，默认仍是 3001）

## Slice 2：前端拆出 ConversationPane（行为不变）✅

- [x] Task 2.1：抽出 `src/components/ConversationPane.tsx`
  - Acceptance: 线程 + 轨道 + 输入框 + 上下文提示条 + 两处 `useLayoutEffect` 贴底全部搬入；App 只留外壳
  - Verify: 现有测试全绿（**没有改任何既有断言**）
  - Files: `src/components/ConversationPane.tsx`, `src/App.tsx`
  - 顺带：对话区改用 `data-conversation-scroll` 标记（页面上有两个 pane，id 只能有一个）；轨道 `aria-controls` 改成可传的 `scrollId`
- [x] Task 2.2：`usePiWebSocket({ lane })` + `PiBridge.lane`
  - Acceptance: `onopen` 后首个包是 `register_lane`；动作模块发的每条指令都带 lane
  - Verify: `usePiWebSocket.test.tsx` 新增 6 项（首包、每条带 lane、顾问实例、旧版桥接兜底、换模型不走 `set_model`）
  - Files: `src/hooks/usePiWebSocket.ts`, `src/hooks/usePiWebSocket.test.tsx`, `src/services/piBridge.ts`
  - 注：`register_lane` 的**回包不等**——WebSocket 保证顺序，等它反而会把首屏拖到超时
- [x] Task 2.3：`src/components/AssistantLayout.tsx` —— 双栏 + 拖动分隔 + 窄屏 tab
  - Acceptance: 分隔比例拖到边界会夹住；双击复位；窄屏退化成 tab
  - Verify: `AssistantLayout.test.tsx`（12 项）+ `paneRatio.test.ts`（比例纯计算，含 0 宽容器）
  - Files: `src/components/AssistantLayout.tsx`, `src/utils/paneRatio.ts`, `src/hooks/useAssistantMode.ts`
  - 偏差：**执行在左、顾问在右**（原规格写反了）。理由：开关切换时执行窗口与侧栏不挪位

## Slice 3：顾问 lane ✅

- [x] Task 3.1：顾问的 spawn 参数与惰性拉起
  - Acceptance: 命令行含 `--no-tools --system-prompt <人格文件> --session-dir …`；不响应 `change_cwd`；开关没开时进程不存在
  - Verify: `lanes.test.ts` / `advisor.test.ts` / 真机冒烟（打印了实际命令行）
  - Files: `server/advisor.ts`, `server/lanes.ts`, `server/bridge.ts`
  - 偏差：人格是**文件**（`~/.pi/agent/pi-web-advisor-persona.md`，已存在不覆盖），不是命令行里的常量
- [x] Task 3.2：顾问的模型走 spawn 参数
  - Acceptance: `set_lane_model` → 重启该 lane 的 pi；`settings.json` 的 `defaultModel` **不变**
  - Verify: 真机冒烟（settings.json 逐字节未变）
  - Files: `server/bridge.ts`, `src/services/piStreamingActions.ts`
  - 限制：模型只存内存，桥接重启后回默认
- [x] Task 3.3：顾问 pane 的收窄
  - Acceptance: 附件入口关闭；顾问会话不进侧栏；模型选择条 + 上下文提示正常
  - Verify: `AdvisorPane.tsx`（附件入口靠不传 `onPickFile`/`onListDir` 自然隐藏）
  - 顺带：顾问窗口加了「新对话」入口（否则它的上下文只会一直长）

## Slice 4：投递（E）✅

- [x] Task 4.1：结论块 → 卡片
  - Acceptance: ```handoff 渲染成卡片；**流式未闭合**时也已经是卡片；多块 = 多张卡；别的语言仍是代码块；执行窗口自己看到的是普通代码块
  - Verify: `HandoffCard.test.tsx`（markdown 集成 4 项）
  - Files: `src/components/HandoffCard.tsx`, `src/components/MarkdownView.tsx`
  - 偏差：**没写单独的解析器**，交给 markdown 的 code 渲染器（比手写解析更稳，还自带未闭合处理）
- [x] Task 4.2：卡片可编辑 + 发送前确认
  - Acceptance: 编辑后的文本以编辑结果为准；空内容禁用发送；失败把原因显示在卡片上
  - Verify: `HandoffCard.test.tsx`（6 项）
  - Files: `src/components/HandoffCard.tsx`
- [x] Task 4.3：`server/planFile.ts` —— 结论写进 `docs/plans/`
  - Acceptance: 文件名 `<YYYYMMDD-HHmm>-<slug>.md`；`..` / 绝对路径一律拒绝；目录不存在则创建；重名加序号
  - Verify: `planFile.test.ts`（17 项，含路径穿越与中文 slug）
  - Files: `server/planFile.ts`, `server/planFile.test.ts`
- [x] Task 4.4：投递链路（排队语义）
  - Acceptance: 主按钮 = 存文件 + 投递「按 `<路径>` 执行」；次按钮 = 直接投递；消息带来源标记；忙碌时排队
  - Verify: `piHandoffActions.test.ts`（7 项）+ 真机冒烟（文件逐字一致、相对路径正确）
  - Files: `src/services/piHandoffActions.ts`, `src/App.tsx`
  - 注：投递本身抽成了与 React 无关的 `createHandoffDelivery`，所以能单测

## 收尾

- [x] 真机冒烟（备用端口 3123，跑完清理了临时产物与多出来的 pi 进程，**没动**用户原有的 3 个）
- [x] 更新 `SPEC-assistant-lanes.md`：假设打勾、偏差记录、Success Criteria 打勾 + 「还没验证 / 已知限制」
- [ ] **用户需要重启桥接进程**（前端已经不认识旧桥接的指令集：`register_lane` / `save_plan_file` / `set_lane_model`）
