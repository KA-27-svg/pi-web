# Pi/Pi-web一键部署

[![最新版本](https://img.shields.io/github/v/release/KA-27-svg/pi-web?label=%E4%B8%8B%E8%BD%BD&color=blue)](https://github.com/KA-27-svg/pi-web/releases/latest)

在浏览器里使用本机的 [`pi`](https://github.com/earendil-works/pi) 编码代理。

**Windows 上零基础也能用。** 不用先装 Node、不用先装 pi、不用碰终端——双击一下，缺什么它自己
装什么，装完自动打开浏览器。从一台什么都没配的电脑，到能对着 pi 说话，中间只有一步要你自己
做：填一个模型 API key。

```
浏览器 ──WebSocket──▶ 桥接（Node） ──stdin/stdout──▶ pi --mode rpc
```

pi 负责思考、调工具、读写文件；这个项目只负责让它好读、好输入。会话与模型配置都存在 pi 自己
那边，删掉这个项目不影响你的 pi。

> 这不是官方的 `@agegr/pi-web`（那是一个 Next.js 全功能应用）。本项目是自建的轻量实现，功能上
> 是它刻意精简的子集。

---

## 使用步骤

### 1. 下载

**不想用 Git**：点最上面那个蓝色的「下载」徽章（或仓库右侧的 Releases），下载 zip 解压到任意目录。

**用 Git**：

```bash
git clone https://github.com/KA-27-svg/pi-web.git
```

也可以直接在 GitHub 页面上点 **Code → Download ZIP**。

### 2. 双击 `start.bat`

Windows 上双击它，会弹出一个黑窗口，它自己按顺序把该装的都装上，每步报一行结果和用时：

```
  正在准备运行环境。首次要几分钟，之后就没有这一步了：

  [1/4] Node.js
        OK  v22.23.2（刚下了一份到项目目录），用时 48 秒
  [2/4] pi
        OK  0.85.1（刚装好），用时 21 秒
  [3/4] 项目依赖
        OK  已安装，用时 29 秒
  [4/4] 构建
        OK  已完成

  准备完成。正在启动服务，浏览器会自动打开。
```

装完它会**自动打开浏览器**，并在桌面放一个「Pi Web」图标——以后点那个图标就行。黑窗口开着
服务就在跑，关掉它就停。

> macOS / Linux 上暂时要自己来：装好 Node 22.19.0 或更新版本，然后
> `npm install && npm start`，再打开 <http://127.0.0.1:3001>。

### 3. 填一个 API key

第一次打开看到的不是对话界面，而是一个向导，它会告诉你还差什么。到这一步通常只剩一件：
**挑一个模型供应商，把 API key 贴进去**，然后就能开始对话。

- **已经有订阅**（Claude Pro / ChatGPT Plus / GitHub Copilot 等）——向导会告诉你在终端里跑
  一次 `/login`，授权完成后页面自己继续
- **用中转站 / 自建网关**——选一个供应商（比如 DeepSeek），把密钥贴进去，再把**地址**改成你的中转站。它仍然用 pi 内置的模型清单，只是把请求发到你指定的地址，所以不用声明模型、也不用选 API 类型
- **想跳过向导自己配**——向导写的就是 pi 自己的 `auth.json` / `models.json` / `settings.json`
- **在终端里改配置**——跑完 `/login`、或手改了 `models.json`，页面会自己发现并刷新模型列表，不用回来重连

### 4. 用起来

| 想做什么 | 怎么做 |
| --- | --- |
| 发消息 | 底部输入框打字，Enter 发送，Shift+Enter 换行 |
| 停止生成 | 点方块按钮，或按 Esc |
| 生成中还想补一句 | 直接打字，点**时钟按钮**排队，当前回答结束后自动处理 |
| 换工作目录 | 侧栏「工作目录」（pi 会以新目录重启） |
| 加 / 换模型供应商 | 侧栏「模型供应商」；名字留空就用官方的。已配过的供应商，改名字 / 地址不必重贴密钥，点「管理」能删掉 |
| 换模型 / 思考强度 | 右下角设置里选；选中的模型会顺手记为默认，下次启动还是它 |
| 藏掉不常用的模型 | 右下角设置 → 模型 → 最底下「管理」（只影响网页这边，pi 那边不变） |
| 查环境有没有毛病 | 右下角设置 → 环境自检 |
| 新建对话 | 侧栏「新建对话」 |
| 翻历史对话 | 左下角展开侧栏，可搜索、重命名、删除（进回收箱保留 30 天） |
| 跳到某次提问 | 对话区右侧的短横线轨道，悬停预览，点击跳过去 |

### 5. 发附件

点输入框右下角的**回形针**，可以从电脑选文件，也可以从当前工作目录里挑。**一个字节都不复制**，
只把真实路径拿回来，文件原地不动。也可以直接**拖拽**文件进来，或者**粘贴**截图（Ctrl+V）。

| 类型 | 怎么送到模型 |
| --- | --- |
| 图片 | 压到最长边 2000px 后直接给模型「看」 |
| 文本（`.ts` `.md` `.json` `.csv` …） | 内容内联进 prompt |
| 二进制（`.docx` `.pdf` `.xlsx` …） | 只给路径，由 agent 自己读（装了 `pandoc` 体验更好） |

### 6. 想改这个项目本身

```bash
npm run dev
```

桥接在 :3001（只监听本机），页面在 :5173，两个都得在，有热更新。

---

## 致谢

- [pi](https://github.com/earendil-works/pi)（earendil-works）—— 这个前端只是它的一个壳：RPC 协议、事件流、会话文件格式、模型与思考档位都来自 pi 自己，接入时主要依据它的 `docs/rpc.md`。
- 官方 [`@agegr/pi-web`](https://www.npmjs.com/package/@agegr/pi-web) —— 交互上的参考：历史消息分页加载、右侧滚动轨道都受它启发。本项目在功能上是它刻意精简的子集。
- 用到的库：[React](https://react.dev) · [Vite](https://vite.dev) · [Tailwind CSS](https://tailwindcss.com) · [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) · [Prism](https://prismjs.com) · [lucide](https://lucide.dev) · [ws](https://github.com/websockets/ws)

---

[MIT](./LICENSE)
