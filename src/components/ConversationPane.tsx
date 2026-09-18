import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePiWebSocket } from '../hooks/usePiWebSocket';
import { useRubberBandScroll } from '../hooks/useRubberBandScroll';
import { ConversationScrollRail, type RailItem } from './ConversationScrollRail';
import { ConversationThread } from './ConversationThread';
import { ExecutionDismissContext } from './executionDismissContext';
import { ChatInput } from './ChatInput';
import type { HandoffMode } from '../types/pi';
import { composerLayout } from '../utils/composerLayout';
import { contextLevel, contextLevelText } from '../utils/contextUsage';
import { isSidebarDismissClick } from '../utils/sidebarDismiss';
import {
  growWindow,
  initialWindow,
  loadLater as loadLaterPage,
  messageWeight,
  visibleSlice,
  windowAround,
} from '../utils/threadWindow';

/** 上下文占用档位 → 提示条的配色 */
const CONTEXT_TONE: Record<string, string> = {
  ok: 'border-border bg-surface text-muted',
  half: 'border-border bg-surface text-muted',
  high: 'border-amber-400/40 bg-amber-500/5 text-amber-700',
  full: 'border-rose-400/40 bg-rose-500/5 text-rose-600',
};

type Session = ReturnType<typeof usePiWebSocket>;

interface ConversationPaneProps {
  /**
   * 一次对话要用到的全部东西：状态 + 动作。
   * 直接就是 `usePiWebSocket()` 的返回值，所以同一个页面挂两次就是两条独立的对话。
   */
  session: Session;
  /** 滚动容器的 id。页面上现在有两个 pane，id 不能同名 */
  scrollId?: string;
  /** 覆盖层侧栏开着时，点空白先收侧栏（侧栏属于执行窗口，但两个 pane 都判） */
  sidebarOpen?: boolean;
  onDismissSidebar?: () => void;
  /** 变一次就复位本 pane 的局部状态（新建会话用） */
  resetSignal?: number;
  /** 顾问窗口传它：```handoff 围栏块会渲染成可投递的卡片 */
  onHandoff?: (text: string, mode: HandoffMode) => Promise<string>;
  /** 开场形变。顾问窗口不要——它一出现就该是普通输入框 */
  animateOpening?: boolean;
  /** 输入区上方要插的东西（顾问窗口的模型选择条） */
  toolbar?: ReactNode;
}

/**
 * 一次对话：消息流 + 右侧轨道 + 底部输入区。
 *
 * 从 App 里整块搬出来的。搬的理由不只是「助手模式要两个窗口」：这些状态
 * （渲染窗口、开场图标、滚动位置、贴底时机）本来就是**属于某一次对话**的，
 * 之前混在外壳里，加第二个窗口时才发现分不开。
 */
export function ConversationPane({
  session,
  scrollId = 'conversation-scroll',
  sidebarOpen = false,
  onDismissSidebar,
  resetSignal,
  onHandoff,
  animateOpening = true,
  toolbar,
}: ConversationPaneProps) {
  const {
    messages,
    status,
    sendPrompt,
    interrupt,
    compactContext,
    uploadFile,
    listDir,
    readAttachment,
    pickFile,
    openAttachment,
  } = session;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // 顾问窗口不开场形变：直接就是输入框贴着底
  const [composerEngaged, setComposerEngaged] = useState(!animateOpening);
  const [openingIcon, setOpeningIcon] = useState(animateOpening);

  const switching = status.switching ?? false;
  /**
   * 已经知道当前会话的内容。在此之前显示「空白界面」是错的：
   * 刷新一个已有对话时，会先演一遍开场形变再被历史替掉。
   */
  const sessionReady = status.sessionLoaded ?? false;
  // 切换会话时对话区不显示内容，但布局要按「有对话」算，
  // 否则底部输入区位置与开场图标都会跟着弹一次
  const isEmpty = messages.length === 0 && !switching;

  // 上下文占用：过半 / 快到上限 / 已满三档提示
  const context = status.stats?.contextUsage;
  const ctxLevel = contextLevel(context?.percent);
  const ctxText = contextLevelText(ctxLevel, context?.percent);

  // 只渲染最近一段消息（参考官方 pi-web：一次渲染整段历史会卡）
  const [threadWindow, setThreadWindow] = useState(initialWindow);
  // 历史每次加载都换一批 id，所以首条 id 能代表「这是哪一次加载」；
  // 换会话时窗口自动回到一页，不必额外写重置逻辑
  const historyKey = messages[0]?.id ?? '';
  const { visible: visibleMessages, startIndex, hasEarlier, hasLater } = useMemo(
    () => visibleSlice(messages, threadWindow, historyKey, messageWeight),
    [messages, threadWindow, historyKey]
  );

  const scrollAdjustRef = useRef<number | null>(null);

  // 往上补一页。补进来的内容会把视线推下去，所以先记下当前高度，
  // 渲染后补回同样的量——否则既会跳动，sentinel 也会一直可见而把整段历史拉完
  const loadEarlier = useCallback(() => {
    const el = scrollContainerRef.current;
    scrollAdjustRef.current = el ? el.scrollHeight : null;
    setThreadWindow(prev => growWindow(prev, historyKey, messages.length));
  }, [historyKey, messages.length]);

  // 往下补一页：窗口上沿不动，只在下面接一段，所以不用补偿滚动位置
  const loadLater = useCallback(() => {
    setThreadWindow(prev => loadLaterPage(prev, historyKey));
  }, [historyKey]);

  // 右侧轨道点了一个还没渲染的提问：把窗口滑到它，由轨道那边接手滚动
  const ensureMessageRendered = useCallback(
    (index: number) => {
      setThreadWindow(windowAround(historyKey, messages, index, messageWeight));
    },
    [historyKey, messages]
  );

  // 传给消息列表的回调必须是稳定的：它一路传到每条消息上，每次重渲染都换新的
  // 函数，memo 就全都失效了（开侧栏 / 设置面板会因此重渲染整个列表）
  const handleOpenAttachment = useCallback(
    (path: string) => {
      void openAttachment(path).catch(() => undefined);
    },
    [openAttachment]
  );

  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    const before = scrollAdjustRef.current;
    if (before === null || !el) return;
    scrollAdjustRef.current = null;
    el.scrollTop += el.scrollHeight - before;
  }, [visibleMessages.length]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // 贴底滚动：用瞬时定位而非平滑动画，避免流式输出时滚动动画被反复打断而抖动
  const pinToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // 输入框长高会把对话区压矮，贴底时得重新顶到底，否则最后一行会被切掉
  const handleComposerResize = useCallback(() => {
    if (!isAtBottomRef.current) return;
    requestAnimationFrame(pinToBottom);
  }, [pinToBottom]);

  // 点对话区的空白处收起侧栏；点交互元素或正在选字时不收
  const handleConversationClick = (event: React.MouseEvent<HTMLElement>) => {
    if (!sidebarOpen) return;
    const selectionCollapsed = window.getSelection()?.isCollapsed ?? true;
    if (!isSidebarDismissClick(event.target, selectionCollapsed)) return;
    onDismissSidebar?.();
  };

  // 贴底必须在**绘制之前**完成：切到有内容的会话时，对话区是先以 scrollTop=0
  // 挂载的，晚一帧再贴底就会先看到会话顶部一闪（顶部有图片时最明显）。
  // 所以用 useLayoutEffect 直接贴，不走 requestAnimationFrame。
  useLayoutEffect(() => {
    if (!isAtBottomRef.current) return;
    pinToBottom();
  }, [messages, pinToBottom]);

  // 切换完成后回到最新处：切换时内容只是被隐藏、并没有塌陷，
  // 所以滚动位置还停在旧会话那里，不重新贴底就会落在新对话中间
  useLayoutEffect(() => {
    if (switching) return;
    pinToBottom();
  }, [switching, pinToBottom]);

  // 新建会话：把本 pane 的局部状态复位（回开场图标、窗口回一页）。
  // 这些状态现在归 pane 所有，外壳碰不到，所以用一个递增的信号通知。
  const resetSeenRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSeenRef.current === resetSignal) return;
    resetSeenRef.current = resetSignal;
    setOpeningIcon(animateOpening);
    setComposerEngaged(!animateOpening);
    setThreadWindow(initialWindow);
  }, [resetSignal, animateOpening]);

  const { showIcon: showOpeningIcon, stickToBottom: shouldStickBottom } = composerLayout({
    sessionReady,
    openingIcon,
    isEmpty,
    composerEngaged,
  });

  // 到底/到顶后继续滚轮可以再拉出一段阻尼位移，松手回弹；拖滚动条不触发
  useRubberBandScroll(scrollContainerRef, contentRef, { enabled: !isEmpty });

  // 轨道的一条横线 = 一次提问：悬停预览用户输入原文，点击跳到那一次。
  // 基于**整段会话**而不是当前渲染窗口，否则长会话里只剩最近几条，看着对不上
  const railItems = useMemo<RailItem[]>(
    () =>
      messages.flatMap((message, index) =>
        message.role === 'user'
          ? [
              {
                // 绝对下标（在整段 messages 里），要跟消息上的 data-message-index 对得上
                index,
                // 先截断再压空白，避免对流式中的长文本反复做全文正则
                text:
                  message.content.slice(0, 400).replace(/\s+/g, ' ').trim().slice(0, 200) ||
                  '（空消息）',
              },
            ]
          : []
      ),
    [messages]
  );

  // 模型 id → 显示名：历史消息只存了 id，显示成 id 太长
  const modelNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const model of status.availableModels ?? []) {
      map[model.id] = model.name || model.id;
    }
    return map;
  }, [status.availableModels]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* 对话流：无框、无头像、无气泡边框 */}
        {/* 原生滚动条隐藏，改用右侧的短横线轨道（ConversationScrollRail） */}
        <main
          id={scrollId}
          data-conversation-scroll
          ref={scrollContainerRef}
          onScroll={handleScroll}
          onClick={handleConversationClick}
          className="scrollbar-none h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
        >
          {/* 侧栏开着时，点空白先归它（收起侧栏），执行块下一次再收 */}
          {!isEmpty && (
            <ExecutionDismissContext.Provider value={sidebarOpen}>
              <ConversationThread
                messages={visibleMessages}
                startIndex={startIndex}
                switching={switching}
                hasEarlier={hasEarlier}
                onLoadEarlier={loadEarlier}
                hasLater={hasLater}
                onLoadLater={loadLater}
                onOpenFile={handleOpenAttachment}
                fallbackModel={status.model?.name || status.model?.id}
                modelNames={modelNames}
                onHandoff={onHandoff}
                scrollRef={scrollContainerRef}
                contentRef={contentRef}
                endRef={messagesEndRef}
              />
            </ExecutionDismissContext.Provider>
          )}
        </main>

        {!isEmpty && (
          <ConversationScrollRail
            containerRef={scrollContainerRef}
            contentRef={contentRef}
            items={railItems}
            windowKey={`${startIndex}:${visibleMessages.length}`}
            onNeedRender={ensureMessageRendered}
            scrollId={scrollId}
          />
        )}
      </div>

      {/* 输入区：开场图标态与展开态是同一个元素，原地形变，无交接 */}
      <footer
        className={`w-full flex-shrink-0 transition-[padding] duration-500 ease-out ${
          shouldStickBottom ? 'pb-0' : 'pb-[calc(50vh-50.5px)] sm:pb-[calc(50vh-58.5px)]'
        }`}
      >
        {toolbar && (
          <div className="mx-auto w-full max-w-content px-5 pb-2 sm:px-6">{toolbar}</div>
        )}

        {/* 上下文过半 / 快到上限 / 已满时提示，并就地提供压缩 */}
        {(ctxLevel !== 'ok' || status.compacting || status.compactionNotice) && (
          <div className="mx-auto w-full max-w-content px-5 pb-2 sm:px-6">
            <div
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12px] ${CONTEXT_TONE[ctxLevel]}`}
            >
              <span className="min-w-0 truncate">
                {status.compacting ? '正在压缩上下文…' : status.compactionNotice || ctxText}
              </span>
              <button
                onClick={compactContext}
                disabled={status.compacting || status.isStreaming}
                className="shrink-0 rounded-full border border-current px-2.5 py-0.5 text-[11.5px] transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-40"
              >
                {status.compacting ? '压缩中…' : '压缩上下文'}
              </button>
            </div>
          </div>
        )}

        {/* 自动重试时明说一声，否则界面看起来就是卡死了 */}
        {status.retrying && (
          <div className="mx-auto w-full max-w-content px-5 pb-2 sm:px-6">
            <p className="text-[12px] text-amber-600">
              连接失败，正在重试
              {status.retrying.maxAttempts > 0
                ? `（${status.retrying.attempt}/${status.retrying.maxAttempts}）`
                : ''}
              …
            </p>
          </div>
        )}

        <ChatInput
          onSend={sendPrompt}
          onStop={() => void interrupt()}
          isLoading={status.isStreaming}
          onUploadFile={uploadFile}
          onListDir={listDir}
          onReadAttachment={readAttachment}
          onPickFile={pickFile}
          onFocusChange={focused => {
            if (focused) setComposerEngaged(true);
          }}
          autoFocus={false}
          showIcon={showOpeningIcon}
          onActivate={() => setOpeningIcon(false)}
          onResize={handleComposerResize}
          restoredDraft={status.restoredDraft}
        />
      </footer>
    </div>
  );
}
