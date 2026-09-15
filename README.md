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

> ⚠️ 桥接能以任意工作目录拉起 `pi --mode rpc`，等同于把本机命令执行能力开放出去。
> 除非你完全清楚后果，否则不要把 `PI_BRIDGE_HOST` 设成 `0.0.0.0`。

## 目录结构

```
server/
  bridge.ts        WebSocket 服务、pi 子进程生命周期、会话指令分发
  sessions.ts      会话列表 / 重命名 / 删除（含路径穿越防护）
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

- `server/sessions.test.ts` — 会话扫描（含头部被注入内容撞满、多字节分块边界）、重命名追加、删除、路径穿越防护。
- `src/services/rpcHandler.test.ts` — 一轮的生命周期（`agent_end` vs `agent_settled`）、`get_state` 竞态、崩溃收尾、工具调用状态机。
- `src/utils/messageParser.test.ts` — 历史消息还原与稳定 ID（ID 不稳定会导致刷新时整段对话重新挂载并重播动画）。

## 已知限制

- **单用户本地使用**：桥接全局共享一个 pi 子进程，多标签页会互相影响。
- **工具结果不回填**：从历史加载时只还原工具调用本身，不还原其结果。
- **生成中不能再发消息**：pi 要求带 `streamingBehavior` 才能排队，目前界面在生成时禁用发送。
