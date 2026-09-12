import { useState, useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import Prism from 'prismjs';

// 常用语言高亮
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-css';

interface CodeBlockProps {
  language?: string;
  value: string;
}

export function CodeBlock({ language = 'text', value }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy code', e);
    }
  };

  const html = useMemo(() => {
    const lang = language.toLowerCase();
    const grammar = Prism.languages[lang];
    if (!grammar) return null;
    try {
      return Prism.highlight(value, grammar, lang);
    } catch {
      return null;
    }
  }, [language, value]);

  return (
    <div className="group/code my-4 rounded-lg overflow-hidden border border-[var(--code-border)] bg-[var(--code-bg)]">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[var(--code-header-bg)]">
        <span className="font-mono text-[11px] text-muted">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-muted opacity-0 group-hover/code:opacity-100 hover:text-foreground transition-all duration-150"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-500" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      <div className="px-3.5 py-3 overflow-x-auto text-[12.5px] leading-[1.7]">
        {html ? (
          <code
            className="font-mono text-[var(--code-fg)]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <code className="font-mono text-[var(--code-fg)] whitespace-pre">
            {value}
          </code>
        )}
      </div>
    </div>
  );
}
