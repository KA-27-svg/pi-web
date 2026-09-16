# Spec: 首次运行向导（Onboarding）

> 状态：**草案，待评审**
> 目标版本：未定
> 相关文档：README.md（当前架构）、pi 官方 [quickstart](https://pi.dev/docs/latest/quickstart) / [providers](https://pi.dev/docs/latest/providers) / [models](https://pi.dev/docs/latest/models)

## Objective

当前 Pi Web 只服务于**已经装好 pi 并配好模型**的用户：克隆、`npm run dev`、打开网页，但如果本机没有 pi 或没有模型凭证，用户只会看到界面卡住或一句难懂的错误。对新手不友好。

本规格要让项目**自带引导**：克隆 → 启动 → 网页自动检测环境 → 按官方步骤装上 pi → 在网页里填模型配置 → 直接开聊。

**用户**：第一次接触 pi / pi-web、不熟悉终端与 npm 的开发者。

**成功的样子**：
- 本机没装 pi 时，打开网页能看到"还缺什么、点一下装"的界面，而不是空白或 `spawn pi ENOENT`。
- 环境就绪但没配模型时，能在网页里选供应商、贴 API key，配完立刻能对话。
- 全过程不要求用户先去读 pi 的文档。

**非目标（明确不做）**：
- 不把 pi 或 Node 打包进本项目做成"零依赖单文件应用"。
- 不实现 OAuth 订阅登录（Claude Pro / ChatGPT / Copilot）的自动化，只做引导 + 检测。
- 不修改 pi 本身。

## 背景事实（决定方案，来自实际阅读官方安装器与文档）

1. **pi 没有配置类 RPC。** `docs/rpc.md` 只有 prompt / state / model / session 等，**没有 login、没有设置 API key 的命令**。`/login` 是纯 TUI 流程。
2. **但配置是文件驱动，桥接可直接读写**（桥接已经在直接读写会话文件）：
   - `~/.pi/agent/auth.json` — `{"<provider>":{"type":"api_key","key":"..."}}`
   - `~/.pi/agent/models.json` — 自定义供应商（`baseUrl` + `api` + `models[]`）
   - `~/.pi/agent/settings.json` — `defaultProvider` / `defaultModel`
   - 写入后调**已有的** `pi.restart()` + `get_available_models` 即可生效。
3. **内置供应商目录随 pi 打包、离线可用**，所以主流供应商只需贴 key。
4. **官方安装器要求 Node ≥ 22.19.0 与 npm 已存在**：
   - `install.sh`（macOS/Linux）：无 TTY 时**不会**自动装 Node，直接报错退出。
   - `install.ps1`（Windows）：同上；且**无 TTY 时会跳过 Git Bash 安装**。
   - 因为 pi-web 自己是 Node 项目、桥接就跑在 Node 上，Node 必然存在——但版本可能不够（见第 5 点）。
5. **存在 Node 版本空档**：本项目 `vite` 只需 Node `^20.19.0 || >=22.12.0`，而 pi 需要 `>=22.19.0`。所以"网页能打开"不等于"能装 pi"。必须显式检测版本。
6. **官方安装器会安装到哪**（用于安装后定位 pi 可执行文件，因为运行中的进程 PATH 不会自动刷新）：
   - Unix：`npm prefix -g` 的 `bin/pi`；不可写时退回 `~/.local/bin/pi`；standalone Node 在 `~/.local/share/pi-node/current`。
   - Windows：npm 全局 prefix 的 `pi.cmd`；不可写时退回 `%APPDATA%\npm\pi.cmd`；standalone Node 在 `%LOCALAPPDATA%\pi-node\current`。
7. **官方安装器是非交互安全的**：检测不到 TTY 时默认执行 install/reinstall，所以桥接可以非交互地调用它。
8. **OAuth 无法自动化**，只能引导用户开终端跑 `/login`，桥接轮询 `auth.json` 变化后继续。

## 能力地图

| 模块 id | 职责 | 依赖 |
|---|---|---|
| `env-probe` | 探测 node 版本 / npm / pi 是否可执行 / Git Bash，产出结构化 `SetupStatus` | — |
| `pi-locate` | 解析 pi 可执行文件绝对路径（PATH + 平台已知安装位），供 spawn 使用 | env-probe |
| `pi-install` | 调用官方安装器（或给出官方命令），把输出流式回传 | env-probe, pi-locate |
| `provider-auth` | 预设供应商贴 key → 写 `auth.json` | env-probe |
| `custom-provider` | 自定义端点 → 写 `models.json`，可从 `<baseUrl>/models` 拉模型列表 | provider-auth |
| `onboarding-ui` | 首启向导壳、步骤流转、错误提示、跳过 | 上述全部 |
| `health-check` | 设置面板自检：版本 / 模型可用性 / 最小连通性 | 全部 |

构建顺序：`env-probe → pi-locate → pi-install → provider-auth → custom-provider → onboarding-ui → health-check`

## 技术方案

### 桥接侧（新增）

- `server/env.ts`：探测函数族，纯函数 + 注入了命令执行的薄封装（便于测试）。
  - node 版本比较必须复用 pi 的语义（`>= 22.19.0`）。
- `server/piLocate.ts`：按平台候选列表解析 pi 可执行文件；Windows 返回 `pi.cmd`。
- `server/piInstall.ts`：按平台拼官方安装命令并执行，逐行回传输出。
  - Windows：`powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://pi.dev/install.ps1 | iex"`
  - macOS/Linux：`sh -c "curl -fsSL https://pi.dev/install.sh | sh"`
  - 参数是**静态字面量**，不拼接用户输入。
- `server/setupConfig.ts`：读写 `auth.json` / `models.json` / `settings.json`。
  - 写入 `auth.json` 必须 `0600`。
  - 读改写，保留用户已有条目，不做整体覆盖。
- 桥接指令族（新增，走已有的 `reply()` 封装与 Origin 校验）：
  `get_setup_status` / `install_pi` / `save_provider_key` / `save_custom_provider` / `list_provider_models` / `set_default_model`。
- **改造 `server/pi.ts`**：`defaultSpawnPi` 现在硬编码 `spawn('pi', ...)`，改为接受 `piLocate` 解析出的命令；`PiSupervisor` 在 pi 未找到时不静默失败。

### 前端侧（新增）

- `src/components/SetupWizard.tsx` + 每步子组件，复用现有视觉基调。
- `usePiWebSocket` 增加 `setup` 领域的动作模块（与现有 `piStreamingActions` / `piSessionActions` / `piAttachmentActions` 同构）。
- `App.tsx`：连接后若 `SetupStatus` 显示未就绪，渲染向导而非对话区。
- `SettingsPanel` 增加「环境自检」入口（health-check）。

### 关键约束

- **安装器输出处理**：官方安装器用 `\r`（回车覆盖）画进度条，而现有 `server/lines.ts` 的 `LineDecoder` 只按 `\n` 切分。需要一个去 ANSI + 按 `\r`/`\n` 双分隔的读取器，否则进度会攒成一行巨型文本。
- **PATH 陈旧**：安装完成后当前进程的 PATH 不会更新，必须靠 `pi-locate` 的已知路径列表，不能依赖 `pi` 命令。
- **重启时序**：写入配置后要 `pi.restart()` 再 `get_available_models`，且要处理"模型列表为空"（写错了）的情况。

## Commands

```
Dev:    npm run dev
Build:  npm run build
Lint:   npm run lint
Test:   npm test
```

## Project Structure

```
server/
  env.ts              # 新增：node/npm/pi/git-bash 探测
  piLocate.ts         # 新增：解析 pi 可执行文件路径
  piInstall.ts        # 新增：调用官方安装器
  setupConfig.ts      # 新增：auth.json / models.json / settings.json 读写
  ansiLines.ts        # 新增：去 ANSI + \r/\n 双分隔的行读取
  pi.ts               # 改造：spawn 解析出的命令
  bridge.ts           # 改造：新增 setup 指令族路由
src/
  components/SetupWizard.tsx        # 新增：向导壳
  services/piSetupActions.ts        # 新增：setup 领域动作
  App.tsx                           # 改造：未就绪时进向导
  components/SettingsPanel.tsx      # 改造：自检入口
```

## Testing Strategy

- 沿用 vitest，测试与被测文件同目录（`*.test.ts` / `*.test.tsx`），这是现有惯例。
- 命令执行必须**注入**（参考 `PiSupervisor` 的 `spawnPi` 注入方式），不真的调用 npm / 安装器。
- 必测：
  - node 版本比较边界（22.18 / 22.19 / 20.19）。
  - `pi-locate` 在各平台的候选顺序与"都找不到"。
  - `setupConfig` 读改写不丢已有条目；`auth.json` 权限为 0600。
  - 去 ANSI + `\r` 行读取器。
  - 向导状态机：未装 pi → 未配模型 → 就绪。

## Boundaries

- **Always**:
  - 写 `auth.json` 用 0600；读改写、保留用户已有配置。
  - 探测结果与安装命令都明确展示给用户。
  - 安装/配置失败要给可读原因，不能静默。
- **Ask first**:
  - 在 UI 之外触发安装（例如未来的静默/定时安装）。正常的向导内安装已经由用户点击确认，不属于 ask-first。
  - 新增任何运行时依赖（当前只有 8 个，是刻意维持的）。
- **Never**:
  - 把 API key 回显到前端、写进日志或会话文件。
  - 把 `PI_BRIDGE_HOST` 放开或关掉 Origin 校验来"方便引导"。
  - 用 shell 拼接用户输入。
  - 在用户未明确确认时执行系统级安装。

## Success Criteria

- [ ] 本机无 pi 时，打开网页看到向导，指明缺什么，且能完成安装。
- [ ] Node < 22.19 时，向导明确报出版本空档，而不是让安装静默失败。
- [ ] 未配模型时，能在网页里选预设供应商贴 key，配完立即可对话。
- [ ] 能配置自定义端点（baseUrl + api 类型 + 模型 id）。
- [ ] 安装/配置后无需重启终端或重新 `npm run dev` 即可用。
- [ ] OAuth 订阅用户被正确引导，且 `/login` 完成后网页能自动识别。
- [ ] `npm run lint && npm test && npm run build` 全绿。

## 已决事项

1. **安装方式：方案 C —— 桥接代跑官方安装器为主，给出命令为兜底。**
   - 主路径：用户在向导里**明确点击确认**后，桥接按平台代跑官方安装器，输出流式显示在网页。
   - 兜底：代跑失败、或环境禁止联网/执行时，改为展示平台对应的**官方命令 + 一键复制**，并自动轮询检测是否装好。
   - 两种路径都必须先把**确切命令**展示给用户再执行。`auth.json` 等凭证不回显。
2. **Windows 的 Git Bash：优先不装，改用 `powershell` 工具。**
   - 官方安装器在无 TTY 时会跳过 Git Bash，而 pi 的 `bash` 工具依赖它。
   - 但 pi 官方支持替换默认工具，把 `defaultTools` 设为 `["read", "powershell", "edit", "write"]` 即可绕开 Bash，`powershell` 工具走 `pwsh.exe`（没有则退到 Windows PowerShell）。
   - 因此缺 Git Bash 时：**先提供“用 powershell 工具”这个开关**（桥接写 `settings.json`，需用户同意），用户同意则**一个字节都不用下载**。
   - 备选：检测顺序与 pi 一致（`settings.json` 的 `shellPath` → Git Bash 常见安装位 → PATH 上的 `bash.exe`）；都没有且用户不愿改工具时，提示在自己终端跑官方安装器（那里才会出现 Git Bash 选择菜单）。
3. **Node 版本不够时选“引导”，不自装（方案 A）。**
   - 官方安装器的 preflight 失败后，无 TTY 下**直接报错退出，不会自装 Node**。
   - 桥接不自己下载 Node（那等于把官方脚本那段复刻一遍，偏离“只走官方步骤”）。
   - 向导给出一条命令让用户**在自己的终端**跑（那里有 TTY，官方脚本会问装不装 standalone Node），桥接轮询检测完成后继续。
   - 只影响 Node 20.19 ~ 22.18 这一档：完全没 Node 的机器到不了向导页（pi-web 自己就跑在 Node 上）。
4. **配置只做共用 `~/.pi/agent`。** 不做 `PI_CODING_AGENT_DIR` 隔离模式——与 README 的价值主张（终端聊过的网页能接着聊）一致。

## 关键实现陷阱

**POSIX 上代跑官方安装器必须 `detached: true`。**

`install.sh` 用 `: <>/dev/tty` 判断“有没有终端”，它开的是**控制终端**，不是 stdin。桥接是从终端启动的，子进程即使 stdin 是管道也仍然共享那个控制终端，于是 `/dev/tty` 能打开，脚本会问 `Install Node.js 22.19.0 or newer now? [Y/n]` 然后**永久等输入**。

用 `detached: true` 启动（内部走 `setsid()`，新 session 无控制终端）即可让它自动走非交互分支。

Windows 不需要：`install.ps1` 判的是 `[Console]::IsInputRedirected`，管道 stdin 即为真。

> 注：此结论由官方脚本源码推出，尚未在真实 Linux/macOS 上实测（Windows + Git Bash 的 `/dev/tty` 行为不同，验不出来）。实现该切片时必须在真实 POSIX 环境验证一次。
