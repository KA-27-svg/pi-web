import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { HandoffCard } from './HandoffCard';
import type { HandoffMode } from '../types/pi';

interface MarkdownViewProps {
  content: string;
  /**
   * 能把结论交给执行窗口时传它：```handoff 围栏块会渲染成可投递的卡片，
   * 而不是一段代码。不传（执行窗口自己）时就是普通代码块。
   */
  onHandoff?: (text: string, mode: HandoffMode) => Promise<string>;
}

export function MarkdownView({ content, onHandoff }: MarkdownViewProps) {
  return (
    <div className="text-[13.5px] leading-[1.75] text-foreground break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props;
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !String(children).includes('\n');
            const codeText = String(children).replace(/\n$/, '');

            if (!isInline && match && onHandoff && match[1].toLowerCase() === 'handoff') {
              return <HandoffCard text={codeText} onDeliver={onHandoff} />;
            }

            if (!isInline) {
              return (
                <CodeBlock language={match ? match[1] : 'text'} value={codeText} />
              );
            }
            return (
              <code className="rounded bg-[var(--code-inline-bg)] px-1.5 py-[1px] font-mono text-[12.5px] text-[var(--code-inline-fg)]">
                {children}
              </code>
            );
          },

          p({ children }) {
            return <p className="my-3 first:mt-0 last:mb-0">{children}</p>;
          },

          ul({ children }) {
            return <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>;
          },
          ol({ children }) {
            return (
              <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>
            );
          },
          li({ children }) {
            return <li className="leading-[1.75]">{children}</li>;
          },

          h1({ children }) {
            return (
              <h1 className="mt-6 mb-3 text-[17.5px] font-semibold tracking-tight">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="mt-5 mb-2.5 text-[15.5px] font-semibold tracking-tight">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="mt-4 mb-2 text-[14px] font-semibold">{children}</h3>
            );
          },

          blockquote({ children }) {
            return (
              <blockquote className="my-4 border-l border-border pl-4 text-muted italic">
                {children}
              </blockquote>
            );
          },

          hr() {
            return <hr className="my-6 border-border" />;
          },

          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-[3px] decoration-muted/40 hover:decoration-foreground transition-colors"
              >
                {children}
              </a>
            );
          },

          // 表格：只有横向细线，无外框
          table({ children }) {
            return (
              <div className="my-4 w-full overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead>{children}</thead>;
          },
          tbody({ children }) {
            return <tbody>{children}</tbody>;
          },
          tr({ children }) {
            return <tr className="border-b border-border last:border-0">{children}</tr>;
          },
          th({ children }) {
            return (
              <th className="py-2 pr-4 text-left text-[12px] font-medium uppercase tracking-wide text-muted whitespace-nowrap">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="py-2 pr-4 align-top leading-[1.7]">{children}</td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
