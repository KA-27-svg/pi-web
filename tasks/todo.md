# Task Checklist: Pi-Web 极简对话核心 (Phase 1)

- [ ] Task 1.1: 脚手架初始化与依赖安装
  - Acceptance: Vite + React + TS 项目初始化完成，安装 Tailwind CSS, Lucide-React 等必要依赖。
  - Verify: `npm run build` 成功。
  - Files: `package.json`, `vite.config.ts`, `tailwind.config.js`, `tsconfig.json`

- [ ] Task 1.2: 设计系统底座与 CSS 变量配置
  - Acceptance: 配置好语义化 CSS 变量（background, foreground, muted, border, primary 等），并让 Tailwind 正确引用。
  - Verify: 页面应用基础变量渲染无误。
  - Files: `src/styles/index.css`, `tailwind.config.js`

- [ ] Task 2.1: 消息与会话核心类型定义及状态管理
  - Acceptance: 定义清晰的 `Message`（含 reasoning 思考内容、content 正文、角色等）及 `Settings` 类型，编写 `useChat` 状态管理。
  - Verify: 类型检查通过，状态增删改查方法可用。
  - Files: `src/types/index.ts`, `src/hooks/useChat.ts`

- [ ] Task 2.2: 极简主界面框架与自适应输入框
  - Acceptance: 实现单栏居中主布局、顶部微小状态栏与底部自适应高度的输入框（支持 Enter 发送，Shift+Enter 换行）。
  - Verify: 页面具备极简现代质感，打字换行自如。
  - Files: `src/components/ChatInput.tsx`, `src/components/TopBar.tsx`, `src/App.tsx`

- [ ] Task 3.1: Markdown 解析与代码高亮组件（含一键复制）
  - Acceptance: 完美渲染 Markdown，针对代码块显示语言标签和一键复制按钮。
  - Verify: 输入复杂 markdown 代码块渲染美观且复制正常。
  - Files: `src/components/CodeBlock.tsx`, `src/components/MarkdownView.tsx`

- [ ] Task 3.2: 渐进式思考链组件 (ThinkingBlock)
  - Acceptance: 实现思考链（Thinking 过程）优雅折叠与平滑展开动画。
  - Verify: 思考过程默认收起，点击清晰展开。
  - Files: `src/components/ThinkingBlock.tsx`, `src/components/MessageItem.tsx`

- [ ] Task 3.3: OpenAI 兼容 SSE 流式客户端
  - Acceptance: 实现基于 Fetch EventSource 的流式处理引擎，支持实时流式打字与中断请求。
  - Verify: 对接真实或 Mock SSE 流时文字实时打字机刷新。
  - Files: `src/services/api.ts`

- [ ] Task 4.1: 轻量设置抽屉与本地持久化
  - Acceptance: 提供 API URL, API Key, Model 配置抽屉，支持清空会话；数据自动同步至 localStorage。
  - Verify: 修改设置并发送消息，刷新浏览器所有数据和设置完整保留。
  - Files: `src/components/SettingsModal.tsx`, `src/hooks/useSettings.ts`
