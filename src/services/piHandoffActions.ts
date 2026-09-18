import type { HandoffMode } from '../types/pi';
import type { PromptDraft } from '../utils/attachments';
import type { PiBridge } from './piBridge';

/**
 * 「把顾问的结论交给执行窗口」用到的桥接动作。
 *
 * 只有一件事：先把结论落成计划文件。之所以不直接把文字贴进执行窗口的输入框：
 * 计划成了一处**可回看、可改、可迭代**的东西，执行方用工具读全文，
 * 推理链也跟着过去了——而这正是分成两个窗口之后最容易丢掉的东西。
 */
export function createHandoffActions(bridge: PiBridge) {
  return {
    savePlanFile: (text: string) =>
      bridge.request<{ relative: string; absolute: string }>('save_plan_file', { text }),
  };
}

export interface HandoffDeliveryDeps {
  /** 把结论存成计划文件（走执行窗口那侧的桥接，所以落在它的工作目录里） */
  savePlanFile: (text: string) => Promise<{ relative: string }>;
  /** 往执行窗口发一条消息 */
  sendPrompt: (draft: PromptDraft, options?: { queue?: boolean }) => boolean;
  /** 执行窗口当前是否在生成中 */
  isStreaming: () => boolean;
}

/**
 * 投递动作本身（与 React 无关，所以能单独测）。
 *
 * `file`：先落成 `docs/plans/*.md`，再只投一句「按 `<路径>` 执行」——执行方用工具
 * 读全文，推理链不丢，而且这份计划后面还能接着改。这是默认路径。
 * `text`：把文字原样发过去，短指令用。
 *
 * 执行窗口在生成中时走**排队**（pi 的 followUp），不会把正在跑的那一轮打断——
 * 而这正是「边聊边盯」能不能成立的关键。
 */
export function createHandoffDelivery(deps: HandoffDeliveryDeps) {
  return async (text: string, mode: HandoffMode): Promise<string> => {
    const send = (message: string) => {
      const sent = deps.sendPrompt(
        { text: message, images: [], files: [] },
        { queue: deps.isStreaming() }
      );
      if (!sent) throw new Error('执行窗口没连上，稍后再试');
    };

    if (mode === 'file') {
      const { relative } = await deps.savePlanFile(text);
      send(`按 \`${relative}\` 执行\n\n> 来自顾问窗口`);
      return `已存为 ${relative}，并投递给执行窗口`;
    }

    send(`${text}\n\n> 来自顾问窗口`);
    return '已投递给执行窗口';
  };
}
