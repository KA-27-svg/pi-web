# Pi Web

Pi Agent 的本地网页工作台 —— 极简、无框、以阅读和输入为核心。

它直接驱动本机安装的 [`pi`](https://github.com/earendil-works/pi) 编码代理，共用 pi 自己的会话文件与模型配置：终端里聊过的对话，在网页里能接着聊。

> 这不是官方的 `@agegr/pi-web`（那是一个 Next.js 全功能应用）。本项目是自建的轻量实现：一个 WebSocket 桥接 + 一个 Vite + React 界面。

---

## 介绍

```
浏览器 ──WebSocket──▶ 桥接（Node） ──stdin/stdout──▶ pi --mode rpc
```

pi 负责思考、调工具、读写文件；这个项目只负责让它好读、好输入。会话和配置仍然是 pi 自己的，删掉这个项目不影响你的 pi。

**它有什么不一样**

- **极简到无框**：没有头像、没有气泡边框，Pi 的回答就是纯正文流。
- **选文件不复制文件**：用回形针选的文件，桥接替你在本机弹原生对话框、只把**路径**拿回来，文件原地不动。文本内容直接内联进 prompt，不指望模型「愿意去读一次文件」。
- **桥接补上 pi 缺的那半边**：pi 的 RPC 没有「列出 / 重命名 / 删除历史会话」这类接口，桥接按 pi 的存储约定直接读写会话文件，所以历史会话、回收站、重命名都能在网页里做。
- **省 token 是有意为之**：图片先压到 2000px（provider 按像素收费）、只渲染最近 50 条消息、思考与工具默认折叠。
- **安全边界是主动做的**：握手阶段校验来源（挡跨站 WebSocket 劫持）、附件路径限制在工作目录内或你亲手选过的、用系统程序打开文件不经过 shell。
- **只有 8 个依赖**：没有状态管理库、没有组件库，界面全部手写。

---

## 教程

### 1. 准备

这个项目**不是独立应用**，它只是 pi 的界面，所以得先有 pi：

1. **Node.js 22+** —— `node --version` 确认
2. **装 pi** —— `npm install -g @earendil-works/pi-coding-agent`，装完 `pi --version` 能打印版本
3. **配好模型** —— 在终端跑一次 `pi`，用 `/settings` 登录或填 API key

> 第 3 步别跳过。没配的话网页能打开、能打字，但发消息**不会有任何回复**。

### 2. 启动

```bash
git clone https://github.com/KA-27-svg/pi-web.git
cd pi-web
npm install
npm run dev
```

打开 http://localhost:5173 。

Windows 也可以直接双击 `start.bat`：它会自动装依赖、等端口真的起来再开浏览器，关掉那个窗口就停服务。

> 桥接在 :3001（只监听本机），页面在 :5173，两个都得在。

### 3. 用起来

| 想做什么 | 怎么做 |
| --- | --- |
| 发消息 | 底部输入框打字，Enter 发送，Shift+Enter 换行 |
| 停止生成 | 点方块按钮，或按 Esc |
| 生成中还想补一句 | 直接打字，点**时钟按钮**排队，当前回答结束后自动处理 |
| 换工作目录 | 右下角设置 → 工作目录 → 切换（pi 会以新目录重启） |
| 换模型 / 思考强度 | 右下角设置里选 |
| 新建对话 | 侧栏「新建对话」 |
| 翻历史对话 | 左下角展开侧栏，可搜索、重命名、删除（删除进回收箱，保留 30 天） |
| 快速跳到某次提问 | 对话区右侧的短横线轨道：一条线对应一次提问，悬停预览，点击跳过去 |

### 4. 附件

点输入框右下角的**回形针**：

- **从电脑选择…** —— 弹系统原生的文件选择框。**一个字节都不复制**，只把真实路径拿回来，文件原地不动。
- **从项目里选择…** —— 列当前工作目录，点一个文件。同样不复制。

也可以**拖拽**文件进来，或者直接**粘贴**截图（Ctrl+V）。

文件最终怎么送到模型：

| 类型 | 怎么送 |
| --- | --- |
| 图片 | 压到最长边 2000px 后以 base64 直接给模型「看」 |
| 文本（`.ts` `.md` `.json` `.csv` …） | 内容直接内联进 prompt |
| 二进制（`.docx` `.pdf` `.xlsx` …） | 只给路径，由 agent 自己读（装了 `pandoc` 体验会好很多） |

> 只有**拖拽 / 粘贴**进来的二进制文件会被复制到工作目录的 `.pi-web-uploads/`——浏览器不告诉页面这类文件的本地路径，没有别的办法。用回形针选的文件永远不复制。

### 5. 两点注意

- **macOS / Linux**：「从电脑选择…」不可用——系统原生文件框目前只在 Windows 上实现，点它会明确报错（不会假装能用）。拖拽、粘贴、「从项目里选择」都正常。
- **不要**把 `PI_BRIDGE_HOST` 设成 `0.0.0.0`。桥接能以任意目录拉起 `pi`，等同于把你本机的命令执行能力开放出去。真要跨设备访问，用 `PI_BRIDGE_ORIGINS` 显式列出来源，别把校验关掉。

---

## 致谢

- [pi](https://github.com/earendil-works/pi)（earendil-works）—— 这个前端只是它的一个壳：RPC 协议、事件流、会话文件格式、模型与思考档位都来自 pi 自己，接入时主要依据它的 `docs/rpc.md`。
- 官方 [`@agegr/pi-web`](https://www.npmjs.com/package/@agegr/pi-web) —— 交互上的参考：历史消息分页加载、右侧滚动轨道都受它启发。本项目在功能上是它刻意精简的子集。
- 用到的库：[React](https://react.dev) · [Vite](https://vite.dev) · [Tailwind CSS](https://tailwindcss.com) · [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) · [Prism](https://prismjs.com) · [lucide](https://lucide.dev) · [ws](https://github.com/websockets/ws)

## License

[MIT](./LICENSE)
