# Spec: Pi-Web 极简对话核心 (Phase 1)

## Objective
打造一个极简、沉浸、美观且高性能的本地 Pi Web 对话界面（风格 C：渐进式设计）。
核心聚焦于打造顶级的输入、流式打字与阅读体验，优雅折叠思考链/状态信息，并基于 CSS 变量完成样式预置，为二期主题与深度自定义打下坚实基础。

## Tech Stack
- **Framework**: React 18+ + TypeScript + Vite
- **Styling**: Tailwind CSS (基于 CSS 变量预留主题插槽)
- **Icons**: Lucide React
- **Markdown & Code**: react-markdown + remark-gfm + 代码高亮与一键复制
- **API Protocol**: OpenAI-Compatible SSE Streaming API（支持直连 Ollama / 本地 LM Studio / 兼容云端接口）
- **State & Storage**: 本地状态管理 + localStorage 持久化

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`

## Project Structure
```text
C:/Users/25478/Desktop/pi web/
  ├── SPEC-chat-core.md
  ├── tasks/
  │   ├── plan.md
  │   └── todo.md
  ├── public/
  ├── src/
  │   ├── components/      # UI 组件 (MessageList, ChatInput, ThinkingBlock, CodeBlock, TopBar)
  │   ├── hooks/           # 自定义 Hook (useChat, useAutoScroll, useSettings)
  │   ├── services/        # API 通信与流式解析 (streamClient, openai)
  │   ├── types/           # 类型定义 (Message, Session, Settings)
  │   ├── styles/          # 主题与全局 CSS 变量定义
  │   ├── App.tsx          # 根应用
  │   └── main.tsx
  ├── index.html
  ├── package.json
  ├── tailwind.config.js
  ├── tsconfig.json
  └── vite.config.ts
```

## Code Style & Conventions
- 保持函数式组件与自定义 Hooks 清晰分离。
- 组件职责单一，避免大文件（单文件原则上不超过 200 行）。
- 所有配色与留白使用语义化 Tailwind Token / CSS 变量（例如 `bg-background`、`text-foreground`、`border-border`），绝不硬编码十六进制颜色。

## Testing & Verification Strategy
- 构建校验：`npm run build` 无 TypeScript 错误与编译报警。
- 手动/UI验证：
  1. 页面快速加载（首屏无杂音，极致极简留白）。
  2. 流式文本打字平滑、自动滚屏体验自然。
  3. 支持 Markdown（加粗、列表、表格、代码高亮、复制按钮）。
  4. 渐进式折叠：Pi 的思考过程（`<think>...</think>` 或独立 reasoning）默认折叠，支持一键展开。
  5. 刷新页面后历史会话完整保留。

## Boundaries
- **Always**: 
  - 遵循渐进式极简原则，主界面不堆砌无用按钮。
  - 流式更新不能引起页面剧烈闪烁或抖动。
  - 使用 CSS 语义化变量为下一阶段主题系统铺路。
- **Ask first**:
  - 引入任何体积大于 100KB 的重型第三方组件库。
  - 改变核心通信协议或数据存储结构。
- **Never**:
  - 在主视图中放置常驻的沉重配置栏破坏沉浸感。
  - 泄露或硬编码任何 API 密钥至仓库。

## Success Criteria
- [ ] 1. 成功使用 Vite + React + TS 搭建开发环境并集成 Tailwind CSS。
- [ ] 2. 完成基于 CSS 变量的基础设计系统（背景、文字、卡片、边框、高亮色）。
- [ ] 3. 完成自适应多行输入框与快捷键（Enter 发送，Shift+Enter 换行）。
- [ ] 4. 完成流式渲染器与 Markdown 解析组件（支持代码块语法高亮与一键复制）。
- [ ] 5. 完成思考链（Thinking 过程）优雅折叠与渐进式展示。
- [ ] 6. 完成极简 API 配置抽屉（提供 Endpoint、Key、Model 配置）及本地持久化。
