# Pi/Pi-web一键部署

在浏览器里使用本机的 [`pi`](https://github.com/earendil-works/pi) 编码代理。

```
浏览器 ──WebSocket──▶ 桥接（Node） ──stdin/stdout──▶ pi --mode rpc
```

pi 负责思考、调工具、读写文件；这个项目只负责让它好读、好输入。会话与模型配置都存在 pi 自己那边，删掉这个项目不影响你的 pi。

装完依赖后 `npm start` 一条命令起服务，只占一个端口。本机缺 pi、或者装了但没配模型时，打开页面会看到向导，跟着装、跟着填就行。

> 这不是官方的 `@agegr/pi-web`（那是一个 Next.js 全功能应用）。本项目是自建的轻量实现：一个 WebSocket 桥接 + 一个 Vite + React 界面。

---

## 教程

### 1. 准备

只需要一样东西：

**Node.js 22.19.0+** —— `node --version` 确认。

> 这个门槛来自 pi，不是本项目。低于它网页照样能跑起来，但装不了 pi——
> 向导会明确告诉你差多少。

**pi 本身和模型配置不用自己先装**，网页里能一路做完。

### 2. 启动

```bash
git clone https://github.com/KA-27-svg/pi-web.git
cd pi-web
npm install
npm start
```

`npm start` 会先构建，再由桥接托管前端。之后打开 **http://127.0.0.1:3001** 即可——只有一个进程、一个端口，不需要 Vite。

Windows 也可以直接双击 `start.bat`：它会自动装依赖、构建、等端口真的起来再开浏览器，关掉那个窗口就停服务。

第一次运行还会在桌面放一个「Pi Web」快捷方式（用仓库里的 `pi-web.ico` 作图标），
之后点图标就等于跑 `start.bat`。

如果本机还缺东西，先看到的是向导弹窗页，而不是对话界面——什么都就绪了才会进去：

| 缺什么 | 向导做什么 |
| --- | --- |
| 没装 pi | 给出 pi 官方的安装命令；点「帮我安装」由桥接代跑，输出实时显示 |
| Node 版本不够 | 只给命令，让你在自己终端里跑。官方安装器在没有终端时不会自己装 Node |
| 没配模型 | 选供应商贴 API key；订阅账号（Claude Pro / ChatGPT / Copilot）引导你去终端跑 `/login`，授权完页面自己继续 |
| 中转站 / 自建端点 | 填 `baseUrl` + API 类型 + 模型 id；可以从 `<baseUrl>/models` 拉列表，拉不到就手填 |
| 没找到 Git Bash（Windows） | 只是提示，不阻断。在终端跑一次官方安装命令，它会顺手装好并配好 `shellPath` |

向导做的事就是 pi 自己的配置文件（`auth.json` / `models.json` / `settings.json`），所以想跳过向导、自己手配也完全行。

### 3. 开发时

要改这个项目本身，用开发模式（热更新，两个进程两个端口）：

```bash
npm run dev
```

桥接在 :3001（只监听本机），页面在 :5173，两个都得在。`npm run serve` 可以跳过构建直接起桥接，前提是已经构建过。

### 4. 用起来

| 想做什么 | 怎么做 |
| --- | --- |
| 发消息 | 底部输入框打字，Enter 发送，Shift+Enter 换行 |
| 停止生成 | 点方块按钮，或按 Esc |
| 生成中还想补一句 | 直接打字，点**时钟按钮**排队，当前回答结束后自动处理 |
| 换工作目录 | 右下角设置 → 工作目录 → 切换（pi 会以新目录重启） |
| 换模型 / 思考强度 | 右下角设置里选 |
| 查环境有没有毛病 | 右下角设置 → 环境自检（只查本机配置，不测网络连通性） |
| 新建对话 | 侧栏「新建对话」 |
| 翻历史对话 | 左下角展开侧栏，可搜索、重命名、删除（删除进回收箱，保留 30 天） |
| 快速跳到某次提问 | 对话区右侧的短横线轨道：一条线对应一次提问，悬停预览，点击跳过去 |

### 5. 附件

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

---

## 致谢

- [pi](https://github.com/earendil-works/pi)（earendil-works）—— 这个前端只是它的一个壳：RPC 协议、事件流、会话文件格式、模型与思考档位都来自 pi 自己，接入时主要依据它的 `docs/rpc.md`。
- 官方 [`@agegr/pi-web`](https://www.npmjs.com/package/@agegr/pi-web) —— 交互上的参考：历史消息分页加载、右侧滚动轨道都受它启发。本项目在功能上是它刻意精简的子集。
- 用到的库：[React](https://react.dev) · [Vite](https://vite.dev) · [Tailwind CSS](https://tailwindcss.com) · [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) · [Prism](https://prismjs.com) · [lucide](https://lucide.dev) · [ws](https://github.com/websockets/ws)

## License

[MIT](./LICENSE)
