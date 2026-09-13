import { useRef, useEffect, useState, useCallback } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { SettingsPanel } from './components/SettingsPanel';
import { PiMessageItem } from './components/PiMessageItem';
import { ChatInput } from './components/ChatInput';
import { OpeningTransition } from './components/OpeningTransition';
import { Settings } from 'lucide-react';

export default function App() {
  const { messages, status, sendPrompt, abort, changeCwd, newSession } =
    usePiWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isAtBottomRef = useRef(true);

  const [panelOpen, setPanelOpen] = useState(false);
  const [openingComplete, setOpeningComplete] = useState(false);

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

  return (
    <div className="relative flex flex-col h-screen w-full bg-background text-foreground selection:bg-foreground/10 overflow-hidden">
      {!openingComplete && (
        <OpeningTransition
          hasConversation={!isEmpty}
          onComplete={() => setOpeningComplete(true)}
        />
      )}

      {/* 常驻控件：齿轮（始终可见，不随聚焦/悬停隐现） */}
      <button
        onClick={() => setPanelOpen(o => !o)}
        className={`absolute right-4 top-3 z-50 rounded-full p-2 transition-colors duration-200 ${
          panelOpen
            ? 'bg-surface text-foreground'
            : 'text-muted hover:text-foreground hover:bg-surface'
        }`}
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
          onNewSession={newSession}
        />
      )}

      {/* 对话流：无框、无头像、无气泡边框 */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0"
      >
        {!isEmpty && (
          <div className="max-w-2xl mx-auto px-5 sm:px-6 py-10 space-y-8">
            {messages.map(msg => (
              <PiMessageItem key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}
      </main>

      {/* 输入区：开场终帧落定后，在同一位置接管交互与焦点 */}
      {openingComplete && (
        <footer
          className={`w-full flex-shrink-0 transition-all duration-500 ease-out opening-content-in ${
            isEmpty ? 'pb-[32vh]' : 'pb-0'
          }`}
        >
          <ChatInput
            onSend={sendPrompt}
            onStop={abort}
            isLoading={status.isStreaming}
            autoFocus={isEmpty}
          />
        </footer>
      )}
    </div>
  );
}
