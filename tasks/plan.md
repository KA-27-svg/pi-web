# Technical Implementation Plan: Pi-Web 极简对话核心 (Phase 1)

> **历史归档 · 非当前实现**
> 本文描述的是项目初期的「OpenAI 兼容 SSE」方案。该方案已被 `pi --mode rpc` 桥接取代。
> 当前架构见 [README](../README.md)。

## Overview
本计划将 Phase 1 分为 4 个垂直递进切片（Slices），严格遵循从底层骨架到核心交互，再到高级渲染与持久化的步骤，保证每个阶段都能独立验证并可运行。

## Slices & Dependency Order

### Slice 1: 脚手架与设计系统底座 (Foundation)
- 目标：初始化 Vite + React 18 + TS 项目，配置 Tailwind CSS 与 CSS 变量系统。
- 关键点：设置好 `--background`、`--foreground`、`--accent` 等变量，确保一期核心写完后无缝接入二期主题。
- 验证：`npm run dev` 正常启动，页面能正确响应 CSS 变量样式。

### Slice 2: 数据结构与极简布局骨架 (Layout & State)
- 目标：搭建应用主框架（顶栏、消息对话流区域、底部自适应输入框）。
- 关键点：极简视觉（风格 C），沉浸式居中排版，输入框随文字自适应高度。
- 验证：界面在桌面端与窄屏下排版自如，UI 极致干净。

### Slice 3: 流式通信与 Markdown/代码高亮引擎 (Stream & Render Engine)
- 目标：实现 OpenAI 兼容格式的 SSE 流式客户端，解析消息内容。
- 关键点：
  - 接入 Markdown 渲染与代码块语法高亮。
  - 实现代码块右上角一键复制与提示反馈。
  - 渐进式折叠：自动捕获并折叠 `<think>` 思考过程，提供平滑展开/折叠按钮。
- 验证：模拟或实际流式返回时，打字平滑无跳屏，代码高亮准确，折叠流畅。

### Slice 4: 本地持久化与轻量设置抽屉 (Storage & Settings)
- 目标：支持配置自定义 API Endpoint、API Key、Model Name；自动保存会话至 localStorage。
- 关键点：设置抽屉采用渐进式隐藏设计（点击右上角轻量唤出），不占据主界面常驻空间。
- 验证：配置自定义服务后可发起完整对话，刷新页面历史记录不丢失。
