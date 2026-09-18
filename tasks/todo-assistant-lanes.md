# 任务清单：助手模式（双 lane：顾问 + 执行）

> 依据 [SPEC-assistant-lanes.md](./SPEC-assistant-lanes.md)。按依赖顺序排列，不按重要性。
> 每项完成即勾选；每个切片收尾跑 `npm run lint && npm test && npm run build`。
> **动手前先做掉 Spec 末尾「待验证的假设」里的前三条实验**（`--no-tools` 能否跑 RPC、两进程并存、`--continue` + `--session-dir`）。

## Slice 0：先验证假设（不写产品代码）

- [ ] Task 0.1：手动跑一次 `pi --mode rpc --no-tools`，发一条 prompt，确认能正常收流
  - Acceptance: 有 `message_update` / `message_end`，不卡在等工具
  - Verify: 手工，把命令行与输出记进 Spec 的「待验证的假设」
- [ ] Task 0.2：同项目目录同时跑两个 pi 进程，各跑一轮
  - Acceptance: `~/.pi/agent/sessions/<项目 slug>/` 出现两个互不干扰的会话文件；会话列表正常
  - Verify: 手工
- [ ] Task 0.3：验证 `--session-dir <独立目录> --continue` 能续上次会话
  - Acceptance: 第二次启动能读到第一次的转录；不行则记录退化为"每次新会话"
  - Verify: 手工

## Slice 1：桥接 lane 化（行为不变）

- [ ] Task 1.1：`server/lanes.ts` —— `Lane` 容器 + `LaneRegistry`
  - Acceptance: 同 laneId 复用同一 `PiSupervisor`；不同 lane 完全隔离；未知/缺省 laneId 落到 `main`；首次用到才 `ensure()`
  - Verify: `server/lanes.test.ts`（注入假 spawn）
  - Files: `server/lanes.ts`, `server/lanes.test.ts`
- [ ] Task 1.2：`piCommandLine` 支持附加参数
  - Acceptance: 参数以字符串数组传入、逐个 `quoteIfNeeded`；空数组时输出与今天逐字一致
  - Verify: `server/pi.test.ts` 增补
  - Files: `server/pi.ts`, `server/pi.test.ts`
- [ ] Task 1.3：桥接接线 —— `register_lane` + 按 lane 定向收发 + 每 lane cwd
  - Acceptance: pi 输出只到同 lane 的连接；`setup_status` / `install_*` 仍广播；不带 lane 的客户端仍落 `main`（多标签页镜像不变）；`WATCHED_COMMANDS` 日志带 lane
  - Verify: 现有测试全绿；手工开两个标签页确认仍镜像
  - Files: `server/bridge.ts`

## Slice 2：前端拆出 ConversationPane（行为不变）

- [ ] Task 2.1：抽出 `src/components/ConversationPane.tsx`
  - Acceptance: 线程 + 轨道 + 输入框 + 上下文提示条 + 那两处 `useLayoutEffect` 贴底全部搬入；App 只留外壳状态；单窗行为与今天完全一致
  - Verify: 现有测试全绿（不改任何断言）；手工切长会话确认不卡、不闪
  - Files: `src/components/ConversationPane.tsx`, `src/App.tsx`
- [ ] Task 2.2：`usePiWebSocket({ lane })` + `PiBridge.lane`
  - Acceptance: `onopen` 后**首个包**是 `register_lane`；动作模块发出的每条指令都带 lane
  - Verify: `src/hooks/usePiWebSocket.test.tsx` 断言首包与带 lane
  - Files: `src/hooks/usePiWebSocket.ts`, `src/hooks/usePiWebSocket.test.tsx`, `src/services/piBridge.ts`
- [ ] Task 2.3：`src/components/AssistantLayout.tsx` —— 双栏 + 拖动分隔 + 开关 + 窄屏 tab
  - Acceptance: 开关切换不丢 pane 状态；分隔比例与开关状态持久化；窄屏下退化成 tab
  - Verify: 组件测试（开关、拖动、持久化、窄屏分支）
  - Files: `src/components/AssistantLayout.tsx`, `src/components/AssistantLayout.test.tsx`, `src/App.tsx`

## Slice 3：顾问 lane

- [ ] Task 3.1：顾问的 spawn 参数与惰性拉起
  - Acceptance: 命令行含 `--no-tools --session-dir ~/.pi/agent/pi-web-advisor-sessions` 与内置人格；顾问 lane 不响应 `change_cwd`；开关没开时进程不存在
  - Verify: `server/lanes.test.ts` / `server/pi.test.ts` 断言命令行；手工确认开关关闭时无第二个进程
  - Files: `server/lanes.ts`, `server/bridge.ts`
- [ ] Task 3.2：顾问的模型选择走 spawn 参数
  - Acceptance: 新增 `set_lane_model` → 重启该 lane 的 pi；`settings.json` 的 `defaultModel` **不变**
  - Verify: 单测断言配置文件未被写
  - Files: `server/bridge.ts`, `src/services/piStreamingActions.ts`
- [ ] Task 3.3：顾问 pane 的收窄
  - Acceptance: 附件入口关闭；顾问会话不出现在侧栏会话列表；顾问 pane 的模型/上下文提示正常
  - Verify: 组件测试 + 手工
  - Files: `src/components/ConversationPane.tsx`, `src/components/ChatInput.tsx`

## Slice 4：投递（E）

- [ ] Task 4.1：`src/utils/handoff.ts` —— 结论块解析
  - Acceptance: 抽出带约定标记的围栏块；能处理**流式未闭合**、多个块（取最后一个）、无块（视为整条消息）
  - Verify: `src/utils/handoff.test.ts`（未闭合 / 多个 / 无 / 嵌套 ```
  - Files: `src/utils/handoff.ts`, `src/utils/handoff.test.ts`
- [ ] Task 4.2：投递卡片 + 发送前可编辑
  - Acceptance: 卡片渲染在顾问消息里；编辑后的文本以编辑结果为准；空内容禁用发送
  - Verify: 组件测试
  - Files: `src/components/HandoffCard.tsx`, `src/components/HandoffCard.test.tsx`, `src/components/PiMessageItem.tsx`
- [ ] Task 4.3：`server/planFile.ts` —— 结论写进 `docs/plans/`
  - Acceptance: 文件名 `<YYYYMMDD-HHmm>-<slug>.md`；`..` / 绝对路径 / cwd 之外一律拒绝；目录不存在则创建；重名加序号
  - Verify: `server/planFile.test.ts`（穿越、绝对路径、重名、建目录）
  - Files: `server/planFile.ts`, `server/planFile.test.ts`
- [ ] Task 4.4：投递链路（排队语义）
  - Acceptance: 主按钮 = 存文件 + 投递「按 `<路径>` 执行」；次按钮 = 直接投递文本；消息带来源标记「来自顾问窗口」；执行窗口忙碌时**排队**不打断
  - Verify: 集成测试（假 pi 收到 prompt）；手工验证忙碌时是排队
  - Files: `src/services/piStreamingActions.ts`, `server/bridge.ts`, `src/components/HandoffCard.tsx`
