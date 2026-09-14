import { useRef, useEffect, useState, useCallback } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { SettingsPanel } from './components/SettingsPanel';
import { PiMessageItem } from './components/PiMessageItem';
import { ChatInput } from './components/ChatInput';
import { Settings } from 'lucide-react';

export default function App() {
  const { messages, status, sendPrompt, abort, changeCwd, newSession, setModel, setThinkingLevel } =
    usePiWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isAtBottomRef = useRef(true);

  const [composerEngaged, setComposerEngaged] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openingIcon, setOpeningIcon] = useState(true);

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

  return (
    <div className="relative flex flex-col h-screen w-full bg-background text-foreground selection:bg-foreground/10 overflow-hidden">
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
          onNewSession={() => {
            newSession();
            // 回到与首次打开一致的开场态：Pi 图标居中，等待点击展开
            setOpeningIcon(true);
            setComposerEngaged(false);
          }}
          onSelectModel={setModel}
          onSelectThinkingLevel={setThinkingLevel}
        />
      )}

      {/* 对话流：无框、无头像、无气泡边框 */}
      {/* scrollbar-gutter both-edges：占位时两侧对称预留，正文不会因滚动条而偏离视口中心；
          窄屏滚动条为 overlay，不需要预留，否则白白压窄正文 */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 [scrollbar-gutter:stable_both-edges] max-sm:[scrollbar-gutter:auto]"
      >
        {!isEmpty && (
          <div className="max-w-content mx-auto px-5 sm:px-6 py-10 space-y-8">
            {messages.map(msg => (
              <PiMessageItem key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}
      </main>

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
  );
}
