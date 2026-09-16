# 任务清单：首次运行向导 (Onboarding)

> 依据 [plan-onboarding.md](./plan-onboarding.md)。按依赖顺序排列，不按重要性。
> 每项完成即勾选；每个切片收尾跑 `npm run lint && npm test && npm run build`。

## Slice 1：环境探测 + 失败可见 ✅

- [x] Task 1.1：`server/env.ts` —— node 版本比较与 `SetupStatus` 类型
  - Verify: `npm test -- env`（边界 20.19 / 22.12 / 22.18 / 22.19 / 23.0）
  - Files: `server/env.ts`, `server/env.test.ts`

- [x] Task 1.2：`server/env.ts` —— 探测函数（注入式 runner）
  - Verify: 假 runner 覆盖「有 / 无 / 版本过低」三种
  - Files: `server/env.ts`, `server/env.test.ts`

- [x] Task 1.3：桥接新增 `get_setup_status` 指令
  - Files: `server/bridge.ts`

- [x] Task 1.4：前端接住 `SetupStatus` 并渲染阻断页
  - Verify: `SetupWizard.test.tsx`
  - Files: `src/types/pi.ts`, `src/services/rpcHandler.ts`, `src/components/SetupWizard.tsx`, `src/App.tsx`

- [x] Task 1.5：连接后自动请求一次 `get_setup_status`
  - Files: `src/hooks/usePiWebSocket.ts`, `src/services/piSetupActions.ts`

## Slice 2：解析 pi 路径 + 改造 spawn ✅

- [x] Task 2.1：先补测 `PiSupervisor` 现有行为（回归护栏）
  - Verify: `npm test -- pi`（原有 11 项 + 新增 6 项）
  - Files: `server/pi.test.ts`

- [x] Task 2.2：`server/piLocate.ts` —— 按平台解析 pi 可执行文件
  - Verify: 单测各平台候选顺序 + 全缺失（9 项）
  - Files: `server/piLocate.ts`, `server/piLocate.test.ts`

- [x] Task 2.3：`server/pi.ts` 使用解析出的命令
  - Verify: 单测 + 真实机器解析到 `AppData\Local\pi-node\current\pi.cmd`
  - 注: 顺手把 ENOENT 翻译成「找不到 pi（尝试执行：…）」，不再直接把 `spawn pi ENOENT` 丢给用户
  - Files: `server/pi.ts`, `server/bridge.ts`

## Slice 3：代跑官方安装器 ✅

- [x] Task 3.1：`server/ansiLines.ts` —— 去 ANSI + `\r`/`\n` 双分隔
  - Acceptance: `\r` 覆盖不攒行；ANSI 转义被剥离；多字节字符不被劈开
  - Verify: 单测（进度条序列、彩色输出、UTF-8 边界）
  - Files: `server/ansiLines.ts`, `server/ansiLines.test.ts`

- [x] Task 3.2：`server/piInstall.ts` —— 构造平台官方命令
  - Acceptance: 参数为静态字面量；不拼接用户输入；可导出命令字符串供 UI 展示
  - Verify: 单测三平台命令
  - Files: `server/piInstall.ts`, `server/piInstall.test.ts`

- [x] Task 3.3：`server/piInstall.ts` —— 执行与流式回传
  - Acceptance: 逐行回传；失败带退出码与末尾输出；可取消
  - Verify: 注入假 runner 的成功/失败/取消三条路
  - Files: `server/piInstall.ts`, `server/piInstall.test.ts`

- [x] Task 3.4：Node 版本不足时改为引导（方案 A）
  - Acceptance: 不代跑；给出官方命令；轮询检测，装好后自动继续
  - Verify: 单测版本不足分支
  - Files: `server/piInstall.ts`, `server/bridge.ts`, `src/components/SetupWizard.tsx`

- [x] Task 3.5：桥接新增 `install_pi` 指令与事件流
  - Acceptance: 完成后自动重跑 `env-probe` + `pi-locate` 并广播新状态
  - Verify: 单测路由
  - Files: `server/bridge.ts`

- [x] Task 3.6：前端安装步骤（展示命令 → 确认 → 日志 → 兜底）
  - Acceptance: 执行前必须把确切命令展示给用户；失败时展示可复制的官方命令并轮询检测
  - Verify: 组件测试；手动走成功与失败
  - Files: `src/components/SetupWizard.tsx`, `src/services/piSetupActions.ts`, `src/App.tsx`

## Slice 4：预设供应商填 key ✅

- [x] Task 4.0（已砍）：Git Bash 缺失时只提示，不改配置
  - 决定：不做 `defaultTools` 开关。它要重启 pi，且 `defaultTools` 是全量替换工具集，
    写漏一个就把 agent 搞坏，代价大于收益。改为在向导里提示用户去终端跑官方命令，
    由 `install.ps1` 自己装 Portable Git 并写好 `shellPath`。
  - Files: `server/env.ts`（问题项文案）, `SPEC-onboarding.md`, `tasks/plan-onboarding.md`

- [x] Task 4.1：`server/setupConfig.ts` —— `auth.json` 读改写 + 0600
  - Acceptance: 保留已有条目；新写入权限 0600；不存在时创建；损坏文件不静默覆盖
  - Verify: 单测（已有条目保留、权限、损坏文件）
  - Files: `server/setupConfig.ts`, `server/setupConfig.test.ts`

- [x] Task 4.2：预设供应商目录
  - Acceptance: 覆盖主流供应商及其 `auth.json` key；数据来自 pi 的 providers 文档
  - Verify: 单测结构
  - Files: `server/providers.ts`, `server/providers.test.ts`

- [x] Task 4.3：桥接新增 `save_provider_key` / `set_default_model` / `list_configured_providers`
  - Acceptance: key 只写不读；响应不含 key；写后**不重启** pi（凭证是惰性读取的），只刷新模型列表与状态
  - Verify: 单测响应体不含 key
  - Files: `server/bridge.ts`, `server/setupConfig.ts`

- [x] Task 4.4：前端供应商选择 + key 输入步骤
  - Acceptance: 保存后立即能用；模型列表为空时给可读错误
  - Verify: 组件测试；手动配真实供应商
  - 实现落在新文件 `src/components/ProviderSetup.tsx`（SetupWizard 只做壳，避免单文件过大）
  - Files: `src/components/ProviderSetup.tsx`, `src/components/SetupWizard.tsx`, `src/services/piSetupActions.ts`

- [x] Task 4.5：OAuth 订阅登录引导
  - Acceptance: 说明在终端跑 `/login`；轮询 `auth.json` 变化后自动继续
  - Verify: 单测轮询逻辑；手动
  - Files: `src/components/SetupWizard.tsx`, `server/setupConfig.ts`

## Slice 5：自定义端点 ✅

- [x] Task 5.1：`models.json` 读写
  - Acceptance: 保留已有 providers；结构符合 pi 的 models.json 规范
  - Verify: 单测
  - Files: `server/setupConfig.ts`, `server/setupConfig.test.ts`

- [x] Task 5.2：`list_provider_models` —— 拉 `<baseUrl>/models`
  - Acceptance: 超时可配；失败时退化为手填模型 id，不阻断
  - Verify: 单测（成功/超时/异常结构）
  - Files: `server/providerModels.ts`, `server/providerModels.test.ts`

- [x] Task 5.3：前端自定义端点表单
  - Acceptance: baseUrl、api 类型、模型 id、key；能选到拉回来的模型
  - Verify: 组件测试；手动对接真实端点
  - Files: `src/components/SetupWizard.tsx`, `src/services/piSetupActions.ts`

## Slice 6：环境自检 ✅

- [x] Task 6.1：`SettingsPanel` 自检区
  - 范围收窄：只做**本机配置**自检（版本 / 凭证 / Git Bash），**不做**连通性检测——
    真测连通性要发一条会产生真实费用的模型请求，不该自动或半自动地跑。界面上明说这条边界。
  - Verify: 组件测试；手动
  - Files: `src/components/SettingsPanel.tsx`

- [x] Task 6.2：更新 README 的「准备」章节
  - Acceptance: 说明现在可以跳过手动装 pi / 配模型，由向导完成
  - Verify: 通读
  - Files: `README.md`
