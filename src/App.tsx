import { useRef, useEffect, useState } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { TopBar } from './components/TopBar';
import { PiMessageItem } from './components/PiMessageItem';
import { ChatInput } from './components/ChatInput';

export default function App() {
  const { messages, status, sendPrompt, abort, changeCwd, newSession } =
    usePiWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement>(null);
  const isAtBottomRef = useRef(true);
  const [composerFocused, setComposerFocused] = useState(false);
  const [topHover, setTopHover] = useState(false);

  const isEmpty = messages.length === 0;
  // 白纸原则：顶栏默认隐去，仅在聚焦输入框或鼠标触到顶部时才淡入
  const revealed = composerFocused || topHover;

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceToBottom < 80;
  };

  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground selection:bg-foreground/10 overflow-hidden">
      {/* 顶栏：仅一行灰色小字，默认透明 */}
      <div
        onMouseEnter={() => setTopHover(true)}
        onMouseLeave={() => setTopHover(false)}
        className={`flex-shrink-0 transition-opacity duration-300 ease-out ${
          revealed ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className={revealed ? 'block' : 'pointer-events-none'}>
          <TopBar
            status={status}
            onNewSession={newSession}
            onChangeCwd={changeCwd}
          />
        </div>
      </div>

      {/* 对话流：无框、无头像、无气泡边框 */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0"
      >
        {!isEmpty && (
          <div className="max-w-2xl mx-auto px-5 sm:px-6 py-8 space-y-8">
            {messages.map(msg => (
              <PiMessageItem key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}
      </main>

      {/* 输入区：空白态悬浮居中，有对话后沉底 */}
      <footer
        className={`w-full flex-shrink-0 transition-all duration-500 ease-out ${
          isEmpty ? 'pb-[32vh]' : 'pb-0'
        }`}
      >
        <ChatInput
          onSend={sendPrompt}
          onStop={abort}
          isLoading={status.isStreaming}
          onFocusChange={setComposerFocused}
          autoFocus={isEmpty}
        />
      </footer>
    </div>
  );
}
