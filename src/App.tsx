import { useRef, useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { useRubberBandScroll } from './hooks/useRubberBandScroll';
import { ConversationScrollRail, type RailItem } from './components/ConversationScrollRail';
import { ConversationThread } from './components/ConversationThread';
import { isSidebarDismissClick } from './utils/sidebarDismiss';
import { growWindow, initialWindow, visibleSlice } from './utils/threadWindow';
import { composerLayout } from './utils/composerLayout';

/** 与 Tailwind 的 sm 断点一致：窄屏时侧栏是覆盖层，而不是并排的一栏 */
const NARROW_VIEWPORT = '(max-width: 640px)';
const isOverlaySidebar = () => window.matchMedia(NARROW_VIEWPORT).matches;
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { Settings, PanelLeftOpen } from 'lucide-react';

export default function App() {
  const { messages, status, sendPrompt, interrupt, changeCwd, newSession, setModel, setThinkingLevel, requestSessions, requestStats, uploadFile, listDir, readAttachment, pickFile, openAttachment, switchSession, renameSession, deleteSession, requestTrash, restoreSession, purgeSession, emptyTrash } =
    usePiWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const [composerEngaged, setComposerEngaged] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openingIcon, setOpeningIcon] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const switching = status.switching ?? false;
  /**
   * 已经知道当前会话的内容。在此之前显示「空白界面」是错的：
   * 刷新一个已有对话时，会先演一遍开场形变再被历史替掉。
   */
  const sessionReady = status.sessionLoaded ?? false;
  // 切换会话时对话区不显示内容，但布局要按「有对话」算，
  // 否则底部输入区位置与开场图标都会跟着弹一次
  const isEmpty = messages.length === 0 && !switching;

  // 只渲染最近一段消息（参考官方 pi-web：一次渲染整段历史会卡）
  const [threadWindow, setThreadWindow] = useState(initialWindow);
  // 历史每次加载都换一批 id，所以首条 id 能代表「这是哪一次加载」；
  // 换会话时窗口自动回到一页，不必额外写重置逻辑
  const historyKey = messages[0]?.id ?? '';
  const { visible: visibleMessages, hasEarlier } = useMemo(
    () => visibleSlice(messages, threadWindow, historyKey),
    [messages, threadWindow, historyKey]
  );

  const scrollAdjustRef = useRef<number | null>(null);

  // 往上补一页。补进来的内容会把视线推下去，所以先记下当前高度，
  // 渲染后补回同样的量——否则既会跳动，sеntinel 也会一直可见而把整段历史拉完
  const loadEarlier = useCallback(() => {
    const el = scrollContainerRef.current;
    scrollAdjustRef.current = el ? el.scrollHeight : null;
    setThreadWindow(prev => growWindow(prev, historyKey, messages.length));
  }, [historyKey, messages.length]);

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
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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
    setSidebarOpen(false);
  };

  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [messages, pinToBottom]);

  // 切换完成后回到最新处：切换时内容只是被隐藏、并没有塌陷，
  // 所以滚动位置还停在旧会话那里，不重新贴底就会落在新对话中间
  useEffect(() => {
    if (switching) return;
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [switching, pinToBottom]);

  const { showIcon: showOpeningIcon, stickToBottom: shouldStickBottom } = composerLayout({
    sessionReady,
    openingIcon,
    isEmpty,
    composerEngaged,
  });

  // 到底/到顶后继续滚轮可以再拉出一段阻尼位移，松手回弹；拖滚动条不触发
  useRubberBandScroll(scrollContainerRef, contentRef, { enabled: !isEmpty });

  // 轨道的一条横线 = 一次提问：悬停预览用户输入原文，点击跳到那一次
  const railItems = useMemo<RailItem[]>(
    () =>
      // 轨道只能反映已经渲染出来的那段：没渲染的消息没有 DOM 锚点，跳不过去
      visibleMessages.flatMap((message, index) =>
        message.role === 'user'
          ? [
              {
                index,
                // 先截断再压空白，避免对流式中的长文本反复做全文正则
                text:
                  message.content.slice(0, 400).replace(/\s+/g, ' ').trim().slice(0, 200) ||
                  '（空消息）',
              },
            ]
          : []
      ),
    [visibleMessages]
  );

  // 展开侧栏时刷新一次，保证顺序与最新改动一致（首次拉取在连接建立时完成）
  useEffect(() => {
    if (!sidebarOpen) return;
    requestSessions();
    // 回收箱数量显示在侧栏底部，一并拉一下
    requestTrash();
  }, [sidebarOpen, requestSessions, requestTrash]);

  // 模型 id → 显示名：历史消息只存了 id，显示成 id 太长
  const modelNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const model of status.availableModels ?? []) {
      map[model.id] = model.name || model.id;
    }
    return map;
  }, [status.availableModels]);

  // 打开设置面板时拉一次用量，保证花费是刚发生的（而不是上次收尾时的）
  useEffect(() => {
    if (!panelOpen) return;
    requestStats();
  }, [panelOpen, requestStats]);

  const startNewSession = () => {
    newSession();
    // 回到与首次打开一致的开场态：Pi 图标居中，等待点击展开
    setOpeningIcon(true);
    setComposerEngaged(false);
  };

  return (
    <div className="relative flex h-screen w-full bg-background text-foreground selection:bg-foreground/10 overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        status={status}
        onToggle={() => setSidebarOpen(false)}
        onNewSession={startNewSession}
        onSwitchSession={sessionPath => {
          switchSession(sessionPath);
          // 侧栏保持展开，便于继续挑别的会话；
          // 但窄屏时它是覆盖层，不收起来会挡住刚打开的对话
          if (isOverlaySidebar()) setSidebarOpen(false);
        }}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onRefreshSessions={requestSessions}
        onRequestTrash={requestTrash}
        onRestoreSession={restoreSession}
        onPurgeSession={purgeSession}
        onEmptyTrash={emptyTrash}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* 侧栏收起时的展开入口，与右上角设置对称 */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-4 top-3 z-[110] rounded-full p-2 text-muted hover:text-foreground hover:bg-surface transition-colors duration-200"
            aria-label="展开侧栏"
            title="历史对话"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* 设置入口：常驻可见，不随焦点或点击位置隐藏 */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          className="absolute right-4 top-3 z-[110] rounded-full p-2 text-muted hover:text-foreground hover:bg-surface transition-colors duration-200"
          aria-label="设置"
          title="设置"
        >
          <Settings className="w-4 h-4" />
        </button>

        {panelOpen && (
          <SettingsPanel
            status={status}
            onClose={() => setPanelOpen(false)}
            onChangeCwd={changeCwd}
            onNewSession={startNewSession}
            onSelectModel={setModel}
            onSelectThinkingLevel={setThinkingLevel}
          />
        )}

        <div className="relative min-h-0 min-w-0 flex-1">
          {/* 对话流：无框、无头像、无气泡边框 */}
          {/* 原生滚动条隐藏，改用右侧的短横线轨道（ConversationScrollRail） */}
          <main
            id="conversation-scroll"
            ref={scrollContainerRef}
            onScroll={handleScroll}
            onClick={handleConversationClick}
            className="scrollbar-none h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
          >
            {!isEmpty && (
              <ConversationThread
                messages={visibleMessages}
                switching={switching}
                hasEarlier={hasEarlier}
                onLoadEarlier={loadEarlier}
                onOpenFile={path => void openAttachment(path).catch(() => undefined)}
                fallbackModel={status.model?.name || status.model?.id}
                modelNames={modelNames}
                scrollRef={scrollContainerRef}
                contentRef={contentRef}
                endRef={messagesEndRef}
              />
            )}
          </main>

          {!isEmpty && (
            <ConversationScrollRail
              containerRef={scrollContainerRef}
              contentRef={contentRef}
              items={railItems}
            />
          )}
        </div>

        {/* 输入区：开场图标态与展开态是同一个元素，原地形变，无交接 */}
        <footer
          className={`w-full flex-shrink-0 transition-[padding] duration-500 ease-out ${
            shouldStickBottom
              ? 'pb-0'
              : 'pb-[calc(50vh-50.5px)] sm:pb-[calc(50vh-58.5px)]'
          }`}
        >
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
    </div>
  );
}
