import type { BridgeStatus } from '../types/pi';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface SetupWizardProps {
  status: BridgeStatus;
  /** 重新探测环境；安装与写配置的能力在后续切片接入 */
  onRecheck: () => void;
}

/**
 * 首次运行向导。
 *
 * 这一版只做一件事：把「这台机器缺什么」说清楚。
 * 在此之前，缺 pi 时界面照常显示输入框，用户打完字等不到任何回复，
 * 只能以为程序坏了——这是新手最难自己诊断的一步，所以先解决它。
 */
export function SetupWizard({ status, onRecheck }: SetupWizardProps) {
  const setup = status.setup;
  const issues = setup?.issues ?? [];

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background px-6 text-foreground overflow-y-auto">
      <div className="w-full max-w-content py-10">
        <h1 className="text-[15px] font-medium">还差一点就能开始</h1>
        <p className="mt-2 text-[13px] leading-[1.7] text-muted">
          Pi Web 只是 pi 的界面，需要本机的 pi 才能工作。下面这些还没就绪：
        </p>

        <ul className="mt-5 space-y-2.5">
          {issues.map(issue => (
            <li
              key={issue.code}
              className="flex gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="text-[12.5px] leading-[1.7]">{issue.message}</span>
            </li>
          ))}
        </ul>

        {/*
          把探测到的真实版本摊开：出问题时这两行是用户唯一能提供的信息，
          也让「明明装了却说没装」这类情况能当场看出来。
        */}
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] text-muted">
          <div className="flex gap-1.5">
            <dt>Node</dt>
            <dd className="font-mono">
              {setup?.node.version ?? '未找到'}
              <span className="ml-1.5 text-muted/70">需要 ≥ {setup?.node.minimum}</span>
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>pi</dt>
            <dd className="font-mono">{setup?.pi.version ?? '未找到'}</dd>
          </div>
          {setup?.gitBash.required && (
            <div className="flex gap-1.5">
              <dt>Git Bash</dt>
              <dd className="font-mono">{setup.gitBash.available ? '已找到' : '未找到'}</dd>
            </div>
          )}
        </dl>

        <button
          onClick={onRecheck}
          className="mt-6 flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[12px] text-foreground/90 transition-colors hover:bg-surface"
        >
          <RefreshCw className="h-3 w-3" />
          重新检测
        </button>
      </div>
    </div>
  );
}
