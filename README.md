# Pi Web

Pi Agent 的本地网页工作台 —— 一个极简、无框、以阅读和输入为核心的自定义前端，直接驱动本机安装的
[`pi`](https://github.com/earendil-works/pi) 编码代理。

> 这不是官方的 `@agegr/pi-web`（那是一个 Next.js 全功能应用）。本项目是自建的轻量实现：一个
> WebSocket 桥接加一个 Vite + React 界面，共用 pi 自己的会话文件与模型配置。

## 架构

```
浏览器 (Vite :5173)
   │  WebSocket
   ▼
server/bridge.ts (:3001，默认只监听 127.0.0.1)
   │  stdin/stdout JSONL
   ▼
pi --mode rpc
```

- **`server/bridge.ts`** — 以子进程方式运行 `pi --mode rpc`，把 stdout 的 JSONL 事件广播给浏览器，
  把浏览器指令写回 stdin；同时自愈重启崩溃的 pi 进程。
- **`server/sessions.ts`** — pi 的 RPC 没有「列出 / 重命名 / 删除历史会话」接口，这部分直接读写
  `~/.pi/agent/sessions`：重命名沿用 pi 的存储约定，在 JSONL 末尾追加一条 `session_info`。
  所有路径都会校验必须落在会话目录内且以 `.jsonl` 结尾。
- **前端** — `usePiWebSocket` 负责连接与重连，`RpcEventHandler` 把 RPC 事件翻译成消息与状态，
  组件本身只负责渲染。

## 快速开始

需要 Node.js 22+，以及已在 PATH 中的 `pi`（`pi --version` 可用）。

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动桥接和 Vite，然后打开 http://localhost:5173 。

Windows 上也可以直接双击 `start.bat`（或把它做成快捷方式放在桌面 / 开始菜单）。它会：

- 先确认 Node 已安装，缺依赖时自动 `npm install`；
- 服务已在运行时不再重复启动，直接打开页面；
- 等端口真的监听后再开浏览器，避免先看到「无法访问」；
- 关闭那个控制台窗口即停服务。

## 附件

输入框有四个入口：**拖拽**、**粘贴**（截图直接 Ctrl+V）、点**回形针**从本地磁盘上传、
点**文件夹**从工作目录里挑一个已经在那儿的文件。

两类附件走完全不同的通道：

| 类型 | 怎么送 | 为什么 |
| --- | --- | --- |
| **图片** | 直接以 base64 走 pi 原生的 `prompt.images` | 模型真的「看见」图；不落盘 |
| **其它文件** | 把路径写进消息 | pi 没有通用附件通道，只能让 agent 自己去读 |

### 图片会自动缩放

最长边超过 2000px 或体积超过 5 MB 时，用 canvas 重采样并转成 JPEG q0.85（导出前铺
白底，否则透明区会变黑）。尺寸和体积都合规时原样发送——不重编码意味着不掉画质、
不丢动画、不失透明。

原因：provider 的 token 成本随像素增长（Anthropic 公式 `宽×高÷750`），一张 4000×3000
的截图约 16000 tokens；而且单请求图片超过 20 张时 Claude 还会把单图尺寸卡到 2000px。
pi 自己的 `images.autoResize` 只作用于 CLI 的 `@file` 附件和 `read` 工具，RPC 传进去的
`images` 是原样透传的，所以这一步得客户端自己做。

### 文件：两种来源 + 两种送达方式

**来源**（二选一）：

- **从工作目录选**（推荐）：文件已经在磁盘上，只用它的相对路径。零传输、无大小限制、
  零等待。和 Codex 的 `/mention` 同一个思路。只能看工作目录里面。
- **上传**：把字节传给桥接、落到工作目录的 `.pi-web-uploads/`。用于工作目录之外的
  文件（浏览器拿不到本地路径，只能传字节）。

**送达**（按文件类型自动选）：

| 文件 | 怎么送 | 模型看到什么 |
| --- | --- | --- |
| 文本（`.ts` `.md` `.json` `.csv` `.log` …） | **内容直接内联进 prompt** | 内容本身，不用先调工具 |
| 二进制（`.docx` `.pdf` `.xlsx` `.png` …） | 只给路径 | 路径，由 agent 自己用 `read` / `bash` 处理 |

内联上限 100 KB，超了只取开头并注明「完整内容请用 read 读取」。这一步的意义在于
**不依赖「模型愿不愿意去读一次文件」**——文本内容直接摆在它面前。

docx / pdf 这类二进制格式 **pi 自己不解析**，agent 通常会调用本机的 `pandoc` 转成
文本，所以装了 pandoc 体验会好很多。

对话里图片显示为缩略图、文件显示为卡片；路径不会直接暴露在气泡里。上传目录里会自动写一个
`.gitignore`（内容为 `*`），所以不会出现在项目 `git status` 里。同名文件不覆盖，自动加 `-1`
后缀；文件名会做净化（防路径穿越）。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 同时启动桥接与前端 |
| `npm run dev:server` | 只启动桥接 |
| `npm run dev:vite` | 只启动前端 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm test` | 运行测试（vitest，一次性） |
| `npm run test:watch` | 监听模式跑测试 |
| `npm run lint` | oxlint |
| `npm run preview` | 预览构建产物 |

## 配置

| 环境变量 | 作用 | 默认 |
| --- | --- | --- |
| `PI_BRIDGE_HOST` | 桥接监听地址 | `127.0.0.1` |
| `PI_BRIDGE_ORIGINS` | 允许连入的前端来源（逗号分隔，仅 `http://`） | `localhost` / `127.0.0.1` 的 5173、4173、3001 |

> ⚠️ 桥接能以任意工作目录拉起 `pi --mode rpc`，等同于把本机命令执行能力开放出去。
> 除非你完全清楚后果，否则不要把 `PI_BRIDGE_HOST` 设成 `0.0.0.0`。
>
> WebSocket **不受同源策略约束**，任何网页都能发起到 `ws://127.0.0.1:3001` 的连接，
> 所以桥接在握手阶段校验 `Origin`（白名单外一律 403）。跨设备使用时，用
> `PI_BRIDGE_ORIGINS` 显式列出来源，不要直接把校验关掉。

## 目录结构

```
server/
  bridge.ts        WebSocket 服务、会话指令分发
  origin.ts        握手阶段的 Origin 白名单（挡 CSWSH）
  pi.ts            pi 子进程生命周期（自愈重启、身份校验）
  lines.ts         stdout 字节流 → 整行（多字节字符跨块安全）
  uploads.ts       附件落盘（文件名净化、不覆盖、大小上限）
  browse.ts        列工作目录（只读，路径限制在工作目录内）
  textAttachment.ts 把文本附件读出来内联（二进制返回 null）
  reply.ts         统一的异步回包封装
  sessions.ts      会话列表 / 重命名 / 删除（含路径穿越防护）
  trash.ts         回收箱：移入 / 恢复 / 彻底删除 / 过期清理
src/
  components/      纯展示组件
  hooks/           连接与状态（usePiWebSocket）
  services/        RPC 事件翻译（RpcEventHandler）
  utils/           历史消息解析（MessageParser）
  types/           共享类型
  index.css        设计变量（浅色 / 深色，跟随系统）
```

## 测试

```bash
npm test
```

覆盖三块最容易静默改坏的地方：

- `server/origin.test.ts` — Origin 白名单判定，以及真实 http + ws 握手下陌生来源被 403。
- `server/pi.test.ts` — 子进程生命周期：自愈重启、**旧进程迟到退出不干扰新进程**、stdin 不可写时 `send` 返回 false。
- `server/lines.test.ts` — 分块解码：多字节字符跨块、逐字节喂入。
- `server/sessions.test.ts` — 会话扫描（含头部被注入内容撞满、多字节分块边界）、重命名追加、删除、路径穿越防护。
- `src/services/rpcHandler.test.ts` — 一轮的生命周期（`agent_end` vs `agent_settled`）、`get_state` 竞态、崩溃收尾、工具调用状态机。
- `src/utils/messageParser.test.ts` — 历史消息还原与稳定 ID（ID 不稳定会导致刷新时整段对话重新挂载并重播动画）。

## 已知限制

- **单用户本地使用**：桥接全局共享一个 pi 子进程，多标签页会互相影响。
- **工具结果不回填**：从历史加载时只还原工具调用本身，不还原其结果。
- **生成中不能再发消息**：pi 要求带 `streamingBehavior` 才能排队，目前界面在生成时禁用发送。
- **超过 2000px 的图片会被重编码**：这会丢掉动画（GIF 变静态帧）和透明通道。
