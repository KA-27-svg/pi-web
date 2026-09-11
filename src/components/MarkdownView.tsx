import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

interface MarkdownViewProps {
  content: string;
}

export function MarkdownView({ content }: MarkdownViewProps) {
  return (
    <div className="text-[14px] leading-relaxed text-foreground select-text overflow-hidden">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 代码与内联代码
          code(props) {
            const { className, children } = props;
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !String(children).includes('\n');
            const codeText = String(children).replace(/\n$/, '');

            if (!isInline) {
              return (
                <CodeBlock
                  language={match ? match[1] : 'text'}
                  value={codeText}
                />
              );
            }

            return (
              <code className="px-1.5 py-0.5 mx-0.5 rounded text-[12px] bg-surface-hover text-foreground font-mono border border-border/80">
                {children}
              </code>
            );
          },

          // 表格支持与美化排版
          table({ children }) {
            return (
              <div className="my-3 w-full overflow-x-auto rounded-lg border border-border/80 bg-surface/50">
                <table className="w-full text-left text-xs border-collapse">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-surface-hover/80 text-foreground font-semibold border-b border-border/80">
                {children}
              </thead>
            );
          },
          tbody({ children }) {
            return (
              <tbody className="divide-y divide-border/50">
                {children}
              </tbody>
            );
          },
          tr({ children }) {
            return (
              <tr className="hover:bg-surface-hover/40 transition-colors">
                {children}
              </tr>
            );
          },
          th({ children }) {
            return (
              <th className="px-3.5 py-2.5 font-medium text-foreground tracking-wide whitespace-nowrap">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3.5 py-2 text-foreground/90 align-top leading-normal">
                {children}
              </td>
            );
          },

          // 标题层级美化
          h1({ children }) {
            return (
              <h1 className="text-lg font-bold text-foreground mt-4 mb-2 pb-1 border-b border-border/60">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-base font-semibold text-foreground mt-3.5 mb-2">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-sm font-semibold text-foreground mt-3 mb-1.5">
                {children}
              </h3>
            );
          },

          // 段落与列表
          p({ children }) {
            return <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 mb-2.5 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 mb-2.5 space-y-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>;
          },

          // 引用块
          blockquote({ children }) {
            return (
              <blockquote className="border-l-3 border-accent/40 bg-surface/40 px-3 py-1.5 rounded-r-md my-2.5 text-muted text-xs italic">
                {children}
              </blockquote>
            );
          },

          // 分割线
          hr() {
            return <hr className="my-4 border-border/60" />;
          },

          // 超链接
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-2 hover:opacity-80 transition-opacity font-medium"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
