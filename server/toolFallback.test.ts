import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOLS,
  POWERSHELL_TOOLS,
  effectiveShellMode,
  isSameTools,
  planToolFallback,
} from './toolFallback';

describe('planToolFallback', () => {
  it('找到 Git Bash 且用户没动过工具集时什么都不写', () => {
    const plan = planToolFallback({ bashAvailable: true, defaultTools: null });

    expect(plan.write).toBeUndefined();
    expect(plan.mode).toBe('bash');
  });

  it('没有 Git Bash、用户也没配过 defaultTools 时换成 PowerShell', () => {
    // 这是主路径：纯小白的机器上没装 Git，pi 的 bash 工具本来就会失败。
    // 换掉它不需要下载任何东西
    const plan = planToolFallback({ bashAvailable: false, defaultTools: null });

    expect(plan.write).toEqual(POWERSHELL_TOOLS);
    expect(plan.mode).toBe('powershell');
    expect(plan.reason).toContain('PowerShell');
  });

  it('已经换成 PowerShell 时不重复写（幂等）', () => {
    const plan = planToolFallback({ bashAvailable: false, defaultTools: POWERSHELL_TOOLS });

    expect(plan.write).toBeUndefined();
    expect(plan.mode).toBe('powershell');
  });

  it('用户自己配过别的工具集时不动它', () => {
    // settings.json 是用户的文件。他只写了 read/edit 是他自己的选择，
    // 我们凭「没有 bash」就去覆盖，等于替他做决定
    const custom = ['read', 'edit', 'write'];

    const plan = planToolFallback({ bashAvailable: false, defaultTools: custom });

    expect(plan.write).toBeUndefined();
    expect(plan.reason).toContain('不动');
  });

  it('用户自己配的那份里本来就有 bash 时，mode 仍然报 bash', () => {
    // 没动配置就不能说「已经改用 PowerShell」——那是假话
    const plan = planToolFallback({ bashAvailable: false, defaultTools: ['read', 'bash'] });

    expect(plan.write).toBeUndefined();
    expect(plan.mode).toBe('bash');
  });

  it('后来装了 Git Bash 时把上次顶上的 PowerShell 换回默认（自愈）', () => {
    // 没有额外状态位也能认出「这份是我们写的」：正好等于我们写的那一套就说明是
    const plan = planToolFallback({ bashAvailable: true, defaultTools: POWERSHELL_TOOLS });

    expect(plan.write).toEqual(DEFAULT_TOOLS);
    expect(plan.mode).toBe('bash');
    expect(plan.reason).toContain('换回');
  });

  it('用户显式写的就是 pi 的默认那一套时，缺 bash 仍然会换（等价于没配过）', () => {
    const plan = planToolFallback({ bashAvailable: false, defaultTools: DEFAULT_TOOLS });

    expect(plan.write).toEqual(POWERSHELL_TOOLS);
  });
});

describe('effectiveShellMode', () => {
  it('有 bash 时就是 bash，哪怕 powershell 也在', () => {
    expect(effectiveShellMode(['read', 'bash', 'powershell', 'edit'])).toBe('bash');
  });

  it('只有 powershell 时才是 powershell', () => {
    expect(effectiveShellMode(['read', 'powershell', 'edit', 'write'])).toBe('powershell');
  });

  it('两个都没有时按 pi 的默认算作 bash', () => {
    expect(effectiveShellMode(null)).toBe('bash');
    expect(effectiveShellMode(['read', 'edit'])).toBe('bash');
  });
});

describe('isSameTools', () => {
  it('元素和顺序都一样才算一样', () => {
    expect(isSameTools(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSameTools(['b', 'a'], ['a', 'b'])).toBe(false);
    expect(isSameTools(['a'], ['a', 'b'])).toBe(false);
  });

  it('没设过时永远是 false（不等同于任何一套）', () => {
    expect(isSameTools(null, ['a'])).toBe(false);
    expect(isSameTools(undefined, ['a'])).toBe(false);
  });
});
