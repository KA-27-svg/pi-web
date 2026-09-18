import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ADVISOR_LANE,
  ADVISOR_PERSONA,
  advisorPersonaPath,
  advisorPiArgs,
  advisorSessionDir,
  ensureAdvisorPersona,
  hasAdvisorSessions,
} from './advisor';

describe('顾问的路径约定', () => {
  it('会话目录与人格文件都在 ~/.pi/agent 下（与 pi-web 自己的持久化文件放一起）', () => {
    expect(advisorSessionDir('/home/u')).toBe(
      path.join('/home/u', '.pi', 'agent', 'pi-web-advisor-sessions')
    );
    expect(advisorPersonaPath('/home/u')).toBe(
      path.join('/home/u', '.pi', 'agent', 'pi-web-advisor-persona.md')
    );
  });

  it('lane id 不是 main', () => {
    expect(ADVISOR_LANE).toBe('advisor');
    expect(ADVISOR_LANE).not.toBe('main');
  });

  it('人格文案里写了 handoff 围栏块的约定（否则顾问不知道该往哪写结论）', () => {
    expect(ADVISOR_PERSONA).toContain('```handoff');
    expect(ADVISOR_PERSONA).toContain('没有工具');
  });
});

describe('顾问进程的参数', () => {
  const base = { personaPath: 'C:/p/persona.md', sessionDir: 'C:/p/sessions', resume: false };

  it('没有工具、指定人格与独立会话目录', () => {
    const args = advisorPiArgs(base);

    expect(args).toContain('--no-tools');
    expect(args).toEqual([
      '--no-tools',
      '--system-prompt',
      'C:/p/persona.md',
      '--session-dir',
      'C:/p/sessions',
    ]);
  });

  it('不传 model 时不写 --model（否则会覆盖用户的默认模型设置）', () => {
    expect(advisorPiArgs(base)).not.toContain('--model');
  });

  it('传了 model 才追加 --model', () => {
    expect(advisorPiArgs({ ...base, model: 'anthropic/claude-sonnet-4' })).toEqual([
      '--no-tools',
      '--system-prompt',
      'C:/p/persona.md',
      '--session-dir',
      'C:/p/sessions',
      '--model',
      'anthropic/claude-sonnet-4',
    ]);
  });

  it('--continue 只在要接着上次聊时给（空目录里它没有会话可续）', () => {
    expect(advisorPiArgs(base)).not.toContain('--continue');
    expect(advisorPiArgs({ ...base, resume: true })).toContain('--continue');
  });
});

describe('人格文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-web-advisor-'));

  it('文件不存在就写一份默认的', () => {
    const target = path.join(dir, 'a', 'persona.md');

    expect(ensureAdvisorPersona(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toContain('思考搭子');
  });

  it('已存在就绝不覆盖（那是用户改过的）', () => {
    const target = path.join(dir, 'persona.md');
    fs.writeFileSync(target, '我自己写的', 'utf-8');

    expect(ensureAdvisorPersona(target)).toBe(false);
    expect(fs.readFileSync(target, 'utf-8')).toBe('我自己写的');
  });
});

describe('有没有可续的会话', () => {
  it('有 .jsonl 才算有', () => {
    expect(hasAdvisorSessions('x', () => ['a.jsonl'])).toBe(true);
    expect(hasAdvisorSessions('x', () => ['persona.md', 'notes.txt'])).toBe(false);
    expect(hasAdvisorSessions('x', () => [])).toBe(false);
  });

  it('目录不存在时当作没有，而不是抛错', () => {
    expect(
      hasAdvisorSessions('x', () => {
        throw new Error('ENOENT');
      })
    ).toBe(false);
  });
});
