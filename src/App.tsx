import { useRef, useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { useRubberBandScroll } from './hooks/useRubberBandScroll';
import { ConversationScrollRail, type RailItem } from './components/ConversationScrollRail';
import { ConversationThread } from './components/ConversationThread';
import { ExecutionDismissContext } from './components/executionDismissContext';
import { isSidebarDismissClick } from './utils/sidebarDismiss';
import { growWindow, initialWindow, loadLater as loadLaterPage, messageWeight, visibleSlice, windowAround } from './utils/threadWindow';
import { composerLayout } from './utils/composerLayout';
import { contextLevel, contextLevelText } from './utils/contextUsage';
import type { ApiProbeResult } from './types/pi';

/** 与 Tailwind 的 sm 断点一致：窄屏时侧栏是覆盖层，而不是并排的一栏 */
const NARROW_VIEWPORT = '(max-width: 640px)';
const isOverlaySidebar = () => window.matchMedia(NARROW_VIEWPORT).matches;

/** 上下文占用档位 → 提示条的配色 */
const CONTEXT_TONE: Record<string, string> = {
  ok: 'border-border bg-surface text-muted',
  half: 'border-border bg-surface text-muted',
  high: 'border-amber-400/40 bg-amber-500/5 text-amber-700',
  full: 'border-rose-400/40 bg-rose-500/5 text-rose-600',
};
import { SettingsPanel } from './components/SettingsPanel';
import { SetupWizard } from './components/SetupWizard';
import { ProviderDialog } from './components/ProviderDialog';
import { CwdDialog } from './components/CwdDialog';
import { Sidebar } from './components/Sidebar';
import { ChatInput } from './components/ChatInput';
import { Settings, PanelLeftOpen } from 'lucide-react';

export default function App() {
  const { messages, status, sendPrompt, interrupt, changeCwd, newSession, setModel, setThinkingLevel, compactContext, requestSessions, requestStats, uploadFile, listDir, readAttachment, pickFile, openAttachment, switchSession, renameSession, deleteSession, requestTrash, restoreSession, purgeSession, emptyTrash, requestSetupStatus, installPi, saveProviderKey, deleteProvider, probeApi } =
    usePiWebSocket();  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const [composerEngaged, setComposerEngaged] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openingIcon, setOpeningIcon] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** 侧栏那两个弹窗。同时只开一个，所以用一个 state 而不是两个 boolean */
  const [dialog, setDialog] = useState<'provider' | 'cwd' | null>(null);
  /** 一次性提示（配好了、切会话失败之类）。自己会淡掉 */
  const [toast, setToast] = useState<string>();

  /**
   * 环境从「没就绪」变成「就绪」时说一声。
   * 首次运行向导配完最后一样东西就是这样：那一整页直接消失、换上对话界面，
   * 不说一句用户会愣一下。
   */
  const readyRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const ready = status.setup?.ready;
    if (ready === undefined) return;
    const was = readyRef.current;
    readyRef.current = ready;
    // 只在「刚变成就绪」时报。启动时本来就绪不该报
    if (was === false && ready) setToast('已经配置完成，可以开始项目了');
  }, [status.setup?.ready]);

  // 提示自己淡掉，不用用户去关
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  // 上游探针的结果放在这里而不是设置面板里：面板关了再开数字还在，
  // 只有下一次「重新检测」才会刷新。
  const [upstream, setUpstream] = useState<{
    phase: 'idle' | 'pending' | 'done';
    result?: ApiProbeResult;
  }>({ phase: 'idle' });

  const probeUpstream = useCallback(() => {
    const model = status.model;
    if (!model?.baseUrl) {
      setUpstream({ phase: 'idle' });
      return;
    }

    setUpstream({ phase: 'pending' });
    probeApi({
      provider: model.provider,
      modelId: model.id,
      baseUrl: model.baseUrl,
      api: model.api,
    })
      .then(result => setUpstream({ phase: 'done', result }))
      .catch((error: Error) =>
        setUpstream({
          phase: 'done',
          result: { ok: false, keyUsed: false, error: error.message || '检测失败' },
        })
      );
  }, [status.model, probeApi]);

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

  // 传给消息列表的回调必须是稳定的：它一路传到每条消息上，每次 App 重渲染都换新的
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

  /**
   * 环境没就绪不进对话界面。
   * 缺 pi 时继续显示输入框，用户打完字永远等不到回复，只会以为程序坏了——
   * 不如直接把「缺什么」摆在他面前。
   */
  if (status.setup && !status.setup.ready) {
    return (
      <SetupWizard
        status={status}
        onRecheck={requestSetupStatus}
        onInstall={installPi}
        onSaveProvider={saveProviderKey}
      />
    );
  }

  return (
    <div className="relative flex h-screen w-full bg-background text-foreground selection:bg-foreground/10 overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        status={status}
        onToggle={() => setSidebarOpen(false)}
        onNewSession={startNewSession}
        onOpenProviders={() => setDialog('provider')}
        onOpenCwd={() => setDialog('cwd')}
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
            onSelectModel={setModel}
            onSelectThinkingLevel={setThinkingLevel}
            onRecheckSetup={requestSetupStatus}
            onCompact={compactContext}
            upstream={upstream}
            onProbeUpstream={probeUpstream}
          />
        )}

        {dialog === 'provider' && (
          <ProviderDialog
            status={status}
            onClose={() => setDialog(null)}
            onSaveProvider={saveProviderKey}
            onDeleteProvider={deleteProvider}
            onSaved={() => {
              // 直接转回对话，并在上面报一声——不然用户不知道配完没、下一步干什么
              setDialog(null);
              setToast('已经配置完成，可以开始项目了');
            }}
          />
        )}

        {dialog === 'cwd' && (
          <CwdDialog cwd={status.cwd} onClose={() => setDialog(null)} onChangeCwd={changeCwd} />
        )}

        {/* 一次性提示。浮在对话区上方，不挡操作 */}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-[130] flex justify-center px-4">
            <div className="paper-in rounded-full border border-border bg-background px-4 py-2 text-[12.5px] text-foreground shadow-[0_4px_24px_-8px_rgba(0,0,0,0.2)]">
              {toast}
            </div>
          </div>
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
          {/* 上下文过半 / 快到上限 / 已满时提示，并就地提供压缩 */}
          {(ctxLevel !== 'ok' || status.compacting || status.compactionNotice) && (
            <div className="mx-auto w-full max-w-content px-5 pb-2 sm:px-6">
              <div
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12px] ${CONTEXT_TONE[ctxLevel]}`}
              >
                <span className="min-w-0 truncate">
                  {status.compacting
                    ? '正在压缩上下文…'
                    : status.compactionNotice || ctxText}
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
    </div>
  );
}
