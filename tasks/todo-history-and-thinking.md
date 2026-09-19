# 任务清单：压缩后的历史回看 + 中转模型推理档位

> 依据用户在 pi-web 里报的三个 bug（2026-09-19）。
> **全部完成**：`tsc OK · oxlint exit 0 · 1057 tests passed / 3 skipped · build OK`。
> 真机验证：隔离桥接（`PI_CODING_AGENT_DIR` + `PI_SESSIONS_ROOT` 双隔离）载入用户那份
> 9.4MB / 3075 行、压缩过 6 次的真实会话。

## 三个 bug

| # | 用户原话 | 根因 |
|---|---|---|
| 1 | 出 bug 上面的对话现在看不了 | 前端拿的是 pi 的**模型上下文**，压缩后只剩 3 条 |
| 2 | 右侧的定位横线也显示不正确 | 同 #1：轨道按消息算，3 条里只有 1 条提问 → 1 根短线 |
| 3 | 中转的模型可以用，但没有推理强调的调节，只有 off | 中转端点的模型定义缺 `reasoning` |

## Slice A：会话文件历史 → 消息列表（纯函数）✅

- [x] Task A.1：新增 `server/history.ts`
  - `branchEntries(entries, leafId)`：会话是一棵树，`get_entries` 会把被抛弃的分叉一起带回来，
    所以沿 `parentId` 从 leaf 回溯，再 `reverse()` 成时间顺序。**认不出叶子就原样返回**（宁多勿少）。
  - `historyMessages(entries, leafId, liveTail)`：跳过 `compaction` 条目，在它的
    `firstKeptEntryId` **之前**插一张压缩分隔卡（文件里 compaction 追加在末尾，按文件顺序渲染会把它错放到结尾）；
    边界条目不在当前分支上时退回它自己的位置，不丢。
  - `liveTail`：流式进行中 `get_messages` 的 `state.messages` 里带着那条 partial，
    只用文件历史会在「流式中刷新页面」时丢掉当前回合，所以末尾要补一条。
    判重用 `role` + `timestamp`。
  - Files: `server/history.ts`
  - Verify: `server/history.test.ts` 10 项

## Slice B：桥接拦截 `get_messages`，回全量历史 ✅

- [x] Task B.1：`sendFullHistory(ws, lane)`
  - `Promise.all([get_entries, get_messages])` → `historyMessages(...)` → 合成一个
    `{type:'response', command:'get_messages', success:true, data:{messages}}` 发回前端。
  - 前端零改动：`rpcHandler` 本来就按 `command === 'get_messages'` 处理。
  - **失败/超时退回转发 pi 原包**（= 今天的行为），保证不劣化。
- [x] Task B.2：`requestFromPi` 加 `swallow` 选项
  - `get_entries` 是几 MB 的整段会话，转给前端纯属浪费。
  - Files: `server/bridge.ts`

## Slice C：前端渲染压缩分隔卡 ✅

- [x] Task C.1：`parseHistory` 补 `compactionSummary` 分支
  - 以前这个角色被静默丢弃 → 64 条原始消息只剩 3 条 PiMessage。
- [x] Task C.2：`PiMessageItem` 渲染「上下文已压缩 · 查看摘要」
  - 一条居中细线 + 按钮，默认收起；展开是 `rounded-lg border` 卡片里的摘要正文 +
    脚注「压缩前约 Nk token 的对话已折叠成上面的摘要」。
  - 分隔卡不画 `[data-answer-meta]`（它不是一条回答）。
- [x] Task C.3：`PiMessage.role` 加 `'compaction'`、`tokensBefore`
  - Files: `src/types/pi.ts`、`src/utils/messageParser.ts`、`src/components/PiMessageItem.tsx`
  - Verify: `messageParser.test.ts` +2、`PiMessageItem.test.tsx` +3

## Slice D：真机验证 ✅

- [x] 载入真实会话（9.4MB / 3075 行 / 6 次压缩）
  - 修前：`messages 3`、轨道 1 根线、压缩前的对话完全消失
  - 修后：`messages 157`、轨道 **73 根线**（= 会话里 73 条提问）、6 张压缩分隔卡、
    展开摘要能看到正文、点轨道能定位、向上滚动能一路加载到 `first = 0`
- [x] 顺带发现并修掉一个老 bug（Slice F）

## Slice E：#3 中转模型的推理档位 ✅

- [x] Task E.1：`mergeModelDefinitions` 跨全部 provider 目录按 id 兜底
  - 旧行为：上游目录里没有的 id 只给 `{ id, name: id, api: 'openai-completions' }`
    → 没有 `reasoning` → `getSupportedThinkingLevels` 返回 `["off"]`。
  - 新行为：从 pi 内置目录（**不按上游过滤**）按 id 找回完整定义，继承
    `reasoning` / `thinkingLevelMap` / `input` / `cost` / `contextWindow` / `maxTokens` / `compat`，
    **不**继承 `baseUrl` / `provider` / `headers`。同名 id 以上游自己那份为准。
  - **不做「家族前缀」猜测**：`deepseek-v4.1-flash` 与任何目录 id 都不构成前缀关系，
    乱猜思考格式有让上游 400 的风险，宁可让它保持 off（界面上诚实）。
- [x] Task E.2：`allCatalogModels(models)` 抽出「整份内置目录」
  - Files: `server/providerEndpoints.ts`、`server/bridge.ts`
  - Verify: `providerEndpoints.test.ts` +5（29 项全过）
- [ ] 用户侧：`deepseek-relay` / `api-slb.micuapi.ai` 是旧版本建的，需要在设置里
      **重新选中保存一次**，才会带上推理档位（不会擅自改用户的 `models.json`）。

## Slice F：向上补页卡住（老 bug，被本轮历史变长暴露）✅

- [x] Task F.1：`growWindow` 的上限改成按**体量**算
  - 旧代码：`Math.min(size + THREAD_PAGE, all.length - end)` —— `size` 是体量预算，
    上限却用了**条数**。一段工具调用很多的历史，一条抵二十条，于是窗口加到「条数」
    就再也长不动了；而那个数只够装七八条消息 → 用户往上滚两下就卡住，更早的对话永远翻不到。
  - 新代码：新增 `historyWeight(all, weight)`，上限用整段历史的体量。
  - 返回数字（不是数组）是为了让调用方能 `useMemo` 稳住补页回调：
    否则流式输出时每来一个 delta 都会把哨兵观察器重建一遍。
  - Files: `src/utils/threadWindow.ts`、`src/components/ConversationPane.tsx`
  - Verify: `threadWindow.test.ts` +2（先把上限改回条数看过红）

## 后续可做

- [ ] 历史分页：现在整段历史（7.5MB → 约 152 条消息）一次性进内存，
      再长就该按需拉（`get_entries` 支持 `offset`/`limit` 的话）。
- [ ] 压缩掉的正文（摘要之外的部分）确实找不回来了——模型也看不到，
      界面上只有摘要可展开，这点要不要在 UI 上说得更明白。
