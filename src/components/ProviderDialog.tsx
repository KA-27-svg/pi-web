import { useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { providerLabel } from '../utils/providerLabel';
import { Modal } from './Modal';
import { ProviderSetup } from './ProviderSetup';
import { X } from 'lucide-react';

interface ProviderDialogProps {
  status: BridgeStatus;
  onClose: () => void;
  onSaveProvider: (provider: string, key: string, baseUrl?: string) => void;
  /** 删除一个已配供应商的凭证 */
  onDeleteProvider: (provider: string) => void;
  /** 存好了：关掉弹窗并报一声成功 */
  onSaved: () => void;
}

/**
 * 模型供应商。
 *
 * 以前这块在设置面板里，跟模型、思考强度、花费、环境自检挤在一个下拉里，又长又乱。
 * 挪到侧栏一个图标加几个字，点开就是这个弹窗。
 *
 * 为什么需要一个常驻入口：首次运行的向导只在「一个凭证都没有」时显示
 * （SetupWizard 里的 needsCredentials），配完第一个它就永远消失了——想再加一个
 * 供应商只能去终端改 pi 的 auth.json。
 */
export function ProviderDialog({
  status,
  onClose,
  onSaveProvider,
  onDeleteProvider,
  onSaved,
}: ProviderDialogProps) {
  const configured = status.setup?.credentials.providers ?? [];
  /** 只有 auth.json 里的供应商能删：只设了环境变量的删不掉 */
  const deletable = new Set(status.deletableProviders ?? []);
  const [managing, setManaging] = useState(false);

  return (
    <Modal title="模型供应商" onClose={onClose}>
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">已经配好的</span>
          {configured.length > 0 && (
            <button
              onClick={() => setManaging(m => !m)}
              className="text-[11px] text-muted transition-colors hover:text-foreground"
            >
              {managing ? '完成' : '管理'}
            </button>
          )}
        </div>
        {configured.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {configured.map(id => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded bg-surface px-2 py-0.5 font-mono text-[11px] text-foreground/80"
              >
                {providerLabel(status, id)}
                {managing && deletable.has(id) && (
                  <button
                    data-delete={id}
                    onClick={() => onDeleteProvider(id)}
                    aria-label={`删除 ${providerLabel(status, id)}`}
                    title="删除（会移除已保存的密钥）"
                    className="-mr-0.5 rounded p-0.5 text-muted transition-colors hover:text-rose-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-[1.7] text-muted">
            还没有配置，先添加一个才能对话。
          </p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-[11px] text-muted">添加 / 更换</div>
        <ProviderSetup
          status={status}
          variant="settings"
          onSave={onSaveProvider}
          onSaved={onSaved}
        />
      </div>

      <p className="mt-3 text-[10.5px] leading-[1.6] text-muted/80">
        写进 pi 自己的 auth.json。加完在设置里选模型。
      </p>
    </Modal>
  );
}
