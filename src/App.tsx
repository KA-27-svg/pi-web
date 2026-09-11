import { useRef, useEffect } from 'react';
import { usePiWebSocket } from './hooks/usePiWebSocket';
import { TopBar } from './components/TopBar';
import { PiMessageItem } from './components/PiMessageItem';
import { ChatInput } from './components/ChatInput';
import { Sparkles, ArrowRight } from 'lucide-react';

export default function App() {
  const { messages, status, sendPrompt, abort, changeCwd, clearMessages } =
    usePiWebSocket();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const agentActions = [
    { title: '查看当前项目结构并总结', prompt: '请列出当前项目目录下的所有文件并简要总结架构' },
    { title: '检查 package.json 依赖健康度', prompt: '读取当前目录下的 package.json，分析依赖是否合理' },
    { title: '运行一次构建并查看结果', prompt: '在当前目录下执行 npm run build，分析构建是否成功' },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground selection:bg-accent/10 selection:text-foreground">
      {/* 极简顶栏 */}
      <TopBar
        status={status}
        onClearChat={clearMessages}
        hasMessages={messages.length > 0}
        onChangeCwd={changeCwd}
      />

      {/* 主对话消息区 */}
      <main className="flex-1 overflow-y-auto px-2 sm:px-4">
        <div className="max-w-3xl mx-auto py-6 space-y-2">
          {messages.length === 0 ? (
            /* 极简空白首屏状态 - Pi Agent 工作台模式 */
            <div className="h-[65vh] flex flex-col items-center justify-center text-center px-4">
              <div className="w-12 h-12 rounded-2xl bg-surface border border-border flex items-center justify-center text-foreground font-mono text-2xl font-bold shadow-xs mb-4">
                π
              </div>
              <h1 className="text-xl font-medium text-foreground tracking-tight mb-2">
                Pi Coding Agent 可视化工作台
              </h1>
              <p className="text-xs text-muted max-w-md mb-6 leading-relaxed">
                已通过原生 RPC 协议深度映射本地 Pi Agent 运行时。<br />
                支持实时可视化观测：文件读写 (<span className="font-mono text-blue-400">read</span>/<span className="font-mono text-emerald-400">write</span>)、代码补丁 (<span className="font-mono text-amber-400">edit</span>)、终端执行 (<span className="font-mono text-purple-400">bash</span>) 与深度思考。
              </p>

              {/* 快捷推荐指令 */}
              <div className="w-full max-w-md space-y-2">
                {agentActions.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendPrompt(action.prompt)}
                    className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-border/80 bg-surface/60 hover:bg-surface-hover hover:border-accent/30 text-xs text-muted hover:text-foreground text-left transition-all duration-150 group"
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-muted group-hover:text-accent" />
                      {action.title}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => <PiMessageItem key={msg.id} message={msg} />)
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 底部自适应输入框 */}
      <footer className="w-full">
        <ChatInput
          onSend={sendPrompt}
          onStop={abort}
          isLoading={status.isStreaming}
        />
      </footer>
    </div>
  );
}
