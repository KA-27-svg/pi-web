import { useState, useRef, useEffect } from 'react';
import { useSettings } from './hooks/useSettings';
import { useChat } from './hooks/useChat';
import { TopBar } from './components/TopBar';
import { MessageItem } from './components/MessageItem';
import { ChatInput } from './components/ChatInput';
import { SettingsModal } from './components/SettingsModal';
import { Sparkles, ArrowRight } from 'lucide-react';

export default function App() {
  const { settings, updateSettings, resetSettings } = useSettings();
  const { messages, isLoading, sendMessage, stopGeneration, clearHistory } =
    useChat(settings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动平滑触底滚屏
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const starterPrompts = [
    '帮我审查一段代码并提出重构建议',
    '解释一下 React 19 的新特性',
    '写一个轻量的防抖 (debounce) 函数',
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground selection:bg-accent/10 selection:text-foreground">
      {/* 极简顶栏 */}
      <TopBar
        settings={settings}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onClearChat={clearHistory}
        hasMessages={messages.length > 0}
      />

      {/* 主对话消息区 */}
      <main className="flex-1 overflow-y-auto px-2 sm:px-4">
        <div className="max-w-3xl mx-auto py-6 space-y-2">
          {messages.length === 0 ? (
            /* 极简空白首屏状态 */
            <div className="h-[60vh] flex flex-col items-center justify-center text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center text-foreground font-mono text-xl shadow-xs mb-4">
                π
              </div>
              <h1 className="text-lg font-medium text-foreground tracking-tight mb-1">
                与 Pi 开始一段对话
              </h1>
              <p className="text-xs text-muted max-w-sm mb-8 leading-relaxed">
                极简、克制、沉浸式的本地对话界面。支持流式渲染与思考过程折叠。
              </p>

              {/* 快捷推荐提示词 */}
              <div className="w-full max-w-md space-y-2">
                {starterPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendMessage(prompt)}
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-border/80 bg-surface/60 hover:bg-surface-hover hover:border-accent/30 text-xs text-muted hover:text-foreground text-left transition-all duration-150 group"
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-muted group-hover:text-accent" />
                      {prompt}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => <MessageItem key={msg.id} message={msg} />)
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 底部自适应输入框 */}
      <footer className="w-full">
        <ChatInput
          onSend={sendMessage}
          onStop={stopGeneration}
          isLoading={isLoading}
        />
      </footer>

      {/* 渐进式设置抽屉 / 弹窗 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
        onClearChat={clearHistory}
      />
    </div>
  );
}
