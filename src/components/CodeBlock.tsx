import { useState, useMemo } from 'react';
import { Check, Copy } from 'lucide-react';
import Prism from 'prismjs';

// 载入常用编程语言的高亮支持
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

  const highlightedHtml = useMemo(() => {
    const lang = language.toLowerCase();
    const grammar = Prism.languages[lang] || Prism.languages.text;
    if (!grammar) return value;
    try {
      return Prism.highlight(value, grammar, lang);
    } catch {
      return value;
    }
  }, [language, value]);

  return (
    <div className="relative my-3 rounded-lg overflow-hidden border border-border/80 bg-[#121318] text-gray-100 font-mono text-sm shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1a1c23] border-b border-white/5 text-xs text-gray-400 select-none">
        <span className="font-sans uppercase tracking-wider text-[11px] font-medium text-gray-300">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] text-emerald-400">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="text-[11px]">复制</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto text-[13px] leading-relaxed">
        <code
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          className={`language-${language}`}
        />
      </div>
    </div>
  );
}
