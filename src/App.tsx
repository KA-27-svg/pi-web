import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { useRubberBandScroll } from './hooks/useRubberBandScroll';
import { ConversationScrollRail, type RailItem } from './components/ConversationScrollRail';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { PiMessageItem } from './components/PiMessageItem';
import { ChatInput } from './components/ChatInput';
import { Settings, PanelLeftOpen } from 'lucide-react';

export default function App() {
  const { messages, status, sendPrompt, abort, changeCwd, newSession, setModel, setThinkingLevel, requestSessions, switchSession, renameSession, deleteSession } =
    usePiWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const [composerEngaged, setComposerEngaged] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openingIcon, setOpeningIcon] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isEmpty = messages.length === 0;

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

  useEffect(() => {
    if (!isAtBottomRef.current) return;
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [messages, pinToBottom]);

  const shouldStickBottom = !isEmpty || composerEngaged;

  // 到底/到顶后继续滚轮可以再拉出一段阻尼位移，松手回弹；拖滚动条不触发
  useRubberBandScroll(scrollContainerRef, contentRef, { enabled: !isEmpty });

  // 轨道的一条横线 = 一次提问：悬停预览用户输入原文，点击跳到那一次
  const railItems = useMemo<RailItem[]>(
    () =>
      messages.flatMap((message, index) =>
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
    [messages]
  );

  // 展开侧栏时刷新一次，保证顺序与最新改动一致（首次拉取在连接建立时完成）
  useEffect(() => {
    if (sidebarOpen) requestSessions();
  }, [sidebarOpen, requestSessions]);

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
          setSidebarOpen(false);
        }}
        onRenameSession={renameSession}
        onDeleteSession={deleteSession}
        onRefreshSessions={requestSessions}
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
            className="scrollbar-none h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
          >
            {!isEmpty && (
              <div ref={contentRef} className="max-w-content mx-auto px-5 sm:px-6 py-10 space-y-8">
                {messages.map(msg => (
                  <PiMessageItem key={msg.id} message={msg} />
                ))}
                <div ref={messagesEndRef} className="h-1" />
              </div>
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
          <ChatInput
            onSend={sendPrompt}
            onStop={abort}
            isLoading={status.isStreaming}
            onFocusChange={focused => {
              if (focused) setComposerEngaged(true);
            }}
            autoFocus={false}
            showIcon={openingIcon && isEmpty}
            onActivate={() => setOpeningIcon(false)}
          />
        </footer>
      </div>
    </div>
  );
}
