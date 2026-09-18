import { describe, expect, it, vi } from 'vitest';
import { createHandoffDelivery, type HandoffDeliveryDeps } from './piHandoffActions';

function harness(over: Partial<HandoffDeliveryDeps> = {}) {
  const deps: HandoffDeliveryDeps = {
    savePlanFile: vi.fn().mockResolvedValue({ relative: 'docs/plans/20250901-0430-方案.md' }),
    sendPrompt: vi.fn().mockReturnValue(true),
    isStreaming: () => false,
    ...over,
  };
  return { deps, deliver: createHandoffDelivery(deps) };
}

/** 只看发出去的那条消息 */
const sentText = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls[0][0] as { text: string }).text;

describe('投递结论', () => {
  it('存为计划：先落文件，再只投一句「按路径执行」', async () => {
    const { deps, deliver } = harness();

    const note = await deliver('# 方案\n就这么干', 'file');

    expect(deps.savePlanFile).toHaveBeenCalledWith('# 方案\n就这么干');
    expect(sentText(deps.sendPrompt as ReturnType<typeof vi.fn>)).toContain(
      '按 `docs/plans/20250901-0430-方案.md` 执行'
    );
    expect(note).toContain('docs/plans/20250901-0430-方案.md');
  });

  it('投出去的消息标明来源，执行窗口里看得出这不是用户自己打的', async () => {
    const { deps, deliver } = harness();

    await deliver('做 A', 'file');
    expect(sentText(deps.sendPrompt as ReturnType<typeof vi.fn>)).toContain('来自顾问窗口');
  });

  it('直接投递：文字原样过去，不落文件', async () => {
    const { deps, deliver } = harness();

    const note = await deliver('删掉那个开关', 'text');

    expect(deps.savePlanFile).not.toHaveBeenCalled();
    expect(sentText(deps.sendPrompt as ReturnType<typeof vi.fn>)).toContain('删掉那个开关');
    expect(note).toContain('已投递');
  });

  it('执行窗口正在生成时走排队，不打断那一轮', async () => {
    const { deps, deliver } = harness({ isStreaming: () => true });

    await deliver('做 A', 'text');

    expect(deps.sendPrompt).toHaveBeenCalledWith(expect.anything(), { queue: true });
  });

  it('空闲时直接发，不必排队', async () => {
    const { deps, deliver } = harness();

    await deliver('做 A', 'text');

    expect(deps.sendPrompt).toHaveBeenCalledWith(expect.anything(), { queue: false });
  });

  it('计划文件没写成时把原因抛出来，不假装投递成功', async () => {
    const { deps, deliver } = harness({
      savePlanFile: vi.fn().mockRejectedValue(new Error('计划内容为空')),
    });

    await expect(deliver('   ', 'file')).rejects.toThrow('计划内容为空');
    expect(deps.sendPrompt).not.toHaveBeenCalled();
  });

  it('执行窗口没连上时报错，而不是静默丢弃', async () => {
    const { deliver } = harness({ sendPrompt: vi.fn().mockReturnValue(false) });

    await expect(deliver('做 A', 'text')).rejects.toThrow(/没连上/);
  });
});
