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

  const isEmpty = messages.length === 0;
  // 顶栏与控制图标：仅在输入框获得焦点或已有对话时淡入
  const showChrome = composerFocused || !isEmpty;

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
    <div className="flex flex-col h-screen w-full bg-background text-foreground selection:bg-accent/10 selection:text-foreground overflow-hidden">
      {/* 顶栏：初始隐藏，聚焦输入框后平滑浮现 */}
      <div
        className={`flex-shrink-0 transition-all duration-500 ease-out ${
          showChrome
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        <TopBar
          status={status}
          onNewSession={newSession}
          hasMessages={!isEmpty}
          onChangeCwd={changeCwd}
        />
      </div>

      {/* 对话消息区 */}
      <main
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0"
      >
        {!isEmpty && (
          <div className="max-w-3xl mx-auto py-6 px-2 sm:px-4 space-y-2 min-w-0">
            {messages.map(msg => (
              <PiMessageItem key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* 输入区：空白态时垂直居中，有对话后沉入底部 */}
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
