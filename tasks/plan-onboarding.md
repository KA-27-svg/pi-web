# 技术实施计划：首次运行向导 (Onboarding)

> 依据 [SPEC-onboarding.md](../SPEC-onboarding.md)。已决：安装走**方案 C**（桥接代跑官方安装器为主、给命令兜底）。
> 实施遵循 `incremental-implementation` 与 `test-driven-development`：每个切片独立可验证，先红后绿。

## 设计原则

- **不碰 pi**：所有新增能力都在桥接侧，复用现有 RPC 与 Origin 校验。
- **注入式命令执行**：探测与安装都通过注入的 runner 执行（参考 `PiSupervisor` 的 `spawnPi` 注入），测试不真的跑 npm / 安装器。
- **失败必须可见**：这一整轮的起点就是"静默失败让新手懵"，任何一步都不允许无反应。
- **凭证单向**：key 只写不读、不回显、不落日志。

## 切片与依赖

```
Slice 1  env-probe ──▶ Slice 2  pi-locate ──▶ Slice 3  pi-install
                             │                        │
                             └──────────┬─────────────┘
                                        ▼
                          Slice 4  provider-auth ──▶ Slice 5  custom-provider
                                        │
                                        ▼
                                  Slice 6  health-check
```

---

### Slice 1：环境探测 + 失败可见（`env-probe`）

**目标**：能准确说出"这台机器缺什么"，并在缺 pi 时给出可读界面，而不是空白或 `spawn pi ENOENT`。

- `server/env.ts`：探测 node 版本、npm、pi、Git Bash，产出 `SetupStatus`。版本比较复用 pi 的语义（`>= 22.19.0`）。
- 桥接新增 `get_setup_status`（走现有 `reply()`）。
- `src/types/pi.ts` 增加 `SetupStatus`；`rpcHandler` 接住它。
- `App.tsx`：连接后若未就绪，渲染阻断页说明缺什么。

**验证**：版本比较边界单测（20.19 / 22.12 / 22.18 / 22.19）；手动模拟缺 pi。

**为什么先做**：即使后面的自动化都没做，这一片也能把最糟的体验（新手看到卡死）消掉。

---

### Slice 2：解析 pi 路径 + 改造 spawn（`pi-locate`）

**目标**：不再依赖 `PATH` 里的 `pi`，为安装后 PATH 陈旧做准备。

- `server/piLocate.ts`：按平台候选顺序解析 pi 可执行文件（Windows 返回 `pi.cmd`）。
- `server/pi.ts`：`defaultSpawnPi` 改为接受解析出的命令；找不到时给出明确错误而非 ENOENT。

**验证**：候选顺序单测 + "都找不到"单测；手动确认现有机器行为不变。

**风险**：改的是启动链路，**必须保证在已装 pi 的机器上零行为变化**。

---

### Slice 3：代跑官方安装器（`pi-install`）

**目标**：一键装 pi，进度可见；失败时可复制官方命令自己跑。

- `server/ansiLines.ts`：去 ANSI + 按 `\r`/`\n` 双分隔。官方安装器用 `\r` 画进度条，现有 `LineDecoder` 只认 `\n`，不处理会把整段进度攒成一行。
- `server/piInstall.ts`：按平台拼官方命令并执行，逐行回传。
  - Windows：`powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://pi.dev/install.ps1 | iex"`
  - macOS/Linux：`sh -c "curl -fsSL https://pi.dev/install.sh | sh"`
  - 参数为静态字面量，不拼接用户输入。
- 桥接新增 `install_pi`，输出以事件流回传；完成后再跑一次 `env-probe` + `pi-locate`。
- 前端向导步骤：**先展示确切命令 → 用户确认 → 流式日志 → 成功/失败**。失败走兜底：展示命令 + 复制按钮 + 轮询检测。
- Node 版本不足时不代跑：官方安装器在无 TTY 下不会装 Node，直接给出说明。

**验证**：`ansiLines` 单测（含 `\r` 覆盖与 ANSI 转义）；命令构建单测；用注入的假 runner 走通成功/失败两条路。

**风险**：这是唯一"执行远程下载代码"的切片，UI 上必须把命令原文摆出来。

---

### Slice 4：预设供应商填 key（`provider-auth`）

**目标**：在网页里选供应商、贴 key，配完即可对话。

- `server/setupConfig.ts`：读写 `auth.json`（0600）、`models.json`、`settings.json`。**读改写、保留已有条目**。
- 桥接内置一份精简的预设供应商目录（provider 名 → `auth.json` key / 环境变量名），取自 pi 的 providers 文档。
- 新增 `save_provider_key` / `set_default_model`。
- 保存后 `pi.restart()` → `get_available_models` → 刷新界面状态。
- 同一片里做 **OAuth 引导**：订阅用户展示"在终端跑 `/login`"，并轮询 `auth.json` 变化后继续。

**验证**：读改写不丢条目单测；权限 0600 单测；手动配一个真实供应商。

---

### Slice 5：自定义端点（`custom-provider`）

**目标**：支持中转站/自建端点。

- 写 `models.json`（`baseUrl` + `api` + `models[]`）。
- 新增 `list_provider_models`：从 `<baseUrl>/models` 拉列表填充下拉（多数 OpenAI 兼容端点支持）。
- 前端表单：baseUrl、api 类型、模型 id、key。

**验证**：models.json 结构单测；手动对接一个真实 OpenAI 兼容端点。

---

### Slice 6：环境自检（`health-check`）

**目标**：装完之后能自查，不用重开向导。

- `SettingsPanel` 增加自检区：pi 版本、Node 版本、Git Bash、模型可用性、最小连通性测试。

**验证**：手动。

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 改 `server/pi.ts` 启动链路引入回归 | Slice 2 单独成片，先补测现有行为再改 |
| 代跑安装器在企业环境被禁 | 兜底给命令（方案 C 的本意） |
| 官方安装器输出格式变动 | 只依赖"行"这一层，不解析具体文案；进度展示容错 |
| 用户已有配置被覆盖 | `setupConfig` 一律读改写，并有单测兜住 |
| Windows 上没有 Git Bash | Slice 1 就探测出来，Slice 3 引导解决 |

## 检查点

每个切片结束都要：`npm run lint && npm test && npm run build` 全绿，并更新本文件的进度。
