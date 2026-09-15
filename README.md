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

点输入框右下角的**回形针**，出来两个选项：

- **从电脑选择…** —— 弹系统原生的文件选择框。**一个字节都不复制**：浏览器拿不到本地
  路径，但桥接就跑在同一台机器上，可以替你弹这个框、把真实路径拿回来。文件原地不动。
- **从项目里选择…** —— 列当前工作目录，点一个文件。同样不复制。

也可以**拖拽**文件到输入框，或直接**粘贴**截图（Ctrl+V）。

### 文件最终怎么送到模型

| 类型 | 怎么送 | 会不会被复制 |
| --- | --- | --- |
| 图片 | 缩到 2000px 后以 base64 走 `prompt.images` | 不会 |
| 文本（`.ts` `.md` `.json` `.csv` `.log` …） | **内容直接内联进 prompt** | 不会 |
| 二进制（`.docx` `.pdf` `.xlsx` …） | 只给路径，agent 自己用 `read` / `bash` | 拖拽进来才会 |

把文本内容直接内联，是为了**不依赖「模型愿不愿意去读一次文件」**——内容直接摆在它面前。
上限 100 KB，超了只取开头并注明「完整内容请用 read 读取」。

**只有拖拽 / 粘贴进来的二进制文件会被复制**到工作目录的 `.pi-web-uploads/`：浏览器不会
告诉我们这类文件的本地路径，没有别的办法。用回形针选的文件永远不被复制。

图片会自动缩放到最长边 2000px（超了转 JPEG q0.85，导出前铺白底）：provider 的 token
成本随像素增长，而 pi 自己的 `images.autoResize` 只管 CLI 的 `@file` 附件和 `read` 工具，
RPC 传进去的 `images` 是原样透传的。

二进制格式（docx / pdf）**pi 自己不解析**，agent 通常会调用本机的 `pandoc`，装了体验会
好很多。

对话里图片显示为缩略图、文件显示为卡片；路径不会直接暴露在气泡里。落盘目录里会自动写
一个 `.gitignore`（内容为 `*`），所以不会出现在项目 `git status` 里；同名文件不覆盖。

### 点开附件

- **图片**：点一下在应用内放大查看（铺满屏幕，点任意处或按 Esc 关闭）
- **文件**：点一下用**系统默认程序**打开

打开文件的路径沿用与读取相同的边界：工作目录内的相对路径、你刚在系统对话框里亲手
选过的绝对路径，**或这个话题里你自己贴过的附件**。第三条是从会话内容里认领的
（只看用户消息）——否则换个工作目录或重启一次桥接，历史里那些绝对路径的附件就全
打不开了。认领到的路径也会落盘到 `~/.pi/agent/pi-web-picked-files.json`。

### 安全边界

- 「从项目里选择」只能在**当前工作目录内**浏览（`server/browse.ts` 的 `resolveWithin`）
- `read_attachment` 只允许读工作目录内的相对路径，或**你刚在系统对话框里亲手选过**的
  绝对路径（`server/pickedFiles.ts`），不是任意绝对路径
- `pick_file` 只在 Windows 上实现；其它平台会明确报错，而不是假装能用

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
  uploads.ts       附件落盘（只在拖拽二进制文件时才用得上）
  browse.ts        列工作目录（只读，路径限制在工作目录内）
  fileDialog.ts    弹系统原生的文件选择框（拿回真实路径，不复制文件）
  pickedFiles.ts   记住可读/可打开的路径（含从会话内容里认领的）
  attachmentPaths.ts 从会话内容里挖出用户贴过的附件路径
  textAttachment.ts 读附件：文本→内联，图片→base64，二进制→只报大小
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
