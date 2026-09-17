import { describe, expect, it } from 'vitest';
import { deriveProviderId } from './customProvider';

describe('deriveProviderId', () => {
  it('取地址的域名', () => {
    expect(deriveProviderId('https://relay.example/v1')).toBe('relay.example');
    expect(deriveProviderId('https://api.deepseek.com')).toBe('api.deepseek.com');
    expect(deriveProviderId('http://localhost:11434/v1')).toBe('localhost');
  });

  it('结果一定符合桥接的限制（字母数字开头，只含字母数字和 . - _）', () => {
    // 标识是 models.json / auth.json 里的键，桥接会校验；这里推出来的必须过
    const allowed = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
    for (const input of [
      'https://relay.example/v1',
      'https://api.deepseek.com',
      'http://localhost:11434/v1',
      'https://192.168.1.10:8080/v1',
      'https://xn--fiqs8s.example/v1',
      '',
      '随便写的',
      'https://端口很奇怪/v1',
    ]) {
      expect(deriveProviderId(input), input).toMatch(allowed);
    }
  });

  it('端口不带进去（它不是标识的一部分）', () => {
    expect(deriveProviderId('http://localhost:11434/v1')).toBe('localhost');
  });

  it('填不成 URL 时给个兜底值', () => {
    expect(deriveProviderId('')).toBe('relay');
    expect(deriveProviderId('随便写的')).toBe('relay');
    expect(deriveProviderId('   ')).toBe('relay');
  });
});
