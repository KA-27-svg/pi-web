import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * 顾问窗口的 lane id。带这个 lane 的连接会连到一个**独立的 pi 进程**：
 * 没有工具（碰不到项目）、独立会话目录（不污染项目会话列表）、独立人格。
 */
export const ADVISOR_LANE = 'advisor';

/**
 * 顾问人格。
 *
 * 这里只是一份**默认值**：真正生效的是 `advisorPersonaPath()` 那个文件，
 * 用户想改成什么样直接编辑它即可（下次拉起顾问进程时生效）。
 */
export const ADVISOR_PERSONA = [
  '你是用户的「思考搭子」，不是执行者：这个窗口没有工具，你碰不到代码，也改不了文件。',
  '你的活是帮他把事情想清楚——追问、拆解、挑毛病、给可选方案，然后把结论交出去。',
  '',
  '怎么聊：',
  '- 先弄清「真正要解决的到底是什么」。需求含糊就一次问一个问题，别急着铺方案。',
  '- 给方案就给两三个方向，说清各自的代价，而不是只给一个「最优解」。',
  '- 该泼冷水就泼：指出被忽略的假设、没算到的风险、可能白干的部分。',
  '- 别写大段代码。写清「让执行窗口做什么」比写实现有用。',
  '',
  '要交给执行窗口时，把结论单独放进一个 handoff 围栏块，像这样：',
  '',
  '```handoff',
  '（这里写要执行窗口做什么，以及为什么这么做）',
  '```',
  '',
  '规矩：块里要说清「做什么」和「为什么」——执行方看不到我们这边的讨论过程，',
  '只看到这个块。一个块讲一件事，需要交两件事就给两个块。',
  '没有结论要交时就别用这个块，正常说话。',
].join('\n');

/** 顾问的会话目录。与项目会话目录分开：两个 pi 进程抢同一份转录会毁掉历史 */
export function advisorSessionDir(homedir: string = os.homedir()): string {
  return path.join(homedir, '.pi', 'agent', 'pi-web-advisor-sessions');
}

/**
 * 人格文件路径。
 *
 * pi 的 `--system-prompt` 拿到一个**存在的路径**时读文件、否则当字面量，
 * 所以人格走文件有三个好处：多行文本不必进命令行（cmd 下的引号会出事）、
 * 用户能直接编辑、以后做人格编辑器也不必再碰 shell 拼接。
 */
export function advisorPersonaPath(homedir: string = os.homedir()): string {
  return path.join(homedir, '.pi', 'agent', 'pi-web-advisor-persona.md');
}

/**
 * 顾问进程的参数。
 *
 * 全部是桥接自己拼出来的静态值；`--model` 来自用户选择，但会过 `quoteIfNeeded`，
 * 且只可能是模型 id（不含空格以外的 shell 元字符也会被引号包住）。
 */
export function advisorPiArgs(options: {
  personaPath: string;
  sessionDir: string;
  /** 上次聊过就接着聊（`--continue` 在空目录里没有会话可续） */
  resume: boolean;
  model?: string;
}): string[] {
  const args = [
    // 顾问不碰项目：没有工具，从构造上就做不到
    '--no-tools',
    '--system-prompt',
    options.personaPath,
    '--session-dir',
    options.sessionDir,
  ];

  if (options.model) args.push('--model', options.model);
  if (options.resume) args.push('--continue');

  return args;
}

/** 人格文件不存在就写一份默认的。**已存在绝不覆盖**，那是用户改过的 */
export function ensureAdvisorPersona(personaPath: string = advisorPersonaPath()): boolean {
  try {
    if (fs.existsSync(personaPath)) return false;
    fs.mkdirSync(path.dirname(personaPath), { recursive: true });
    fs.writeFileSync(personaPath, `${ADVISOR_PERSONA}\n`, 'utf-8');
    return true;
  } catch (err) {
    // 写不进去（只读目录之类）不该拦住整个功能：人格文件缺失时 pi 会把
    // 路径当成字面量系统提示词，顾问照样能聊，只是没有这层设定
    console.error('[Pi Bridge] 写顾问人格文件失败:', err);
    return false;
  }
}

/**
 * 顾问会话目录里有没有可续的会话。
 * `--continue` 在没有会话时会失败，所以先看有没有 `.jsonl`。
 */
export function hasAdvisorSessions(
  dir: string,
  readdir: (dir: string) => string[] = d => fs.readdirSync(d)
): boolean {
  try {
    return readdir(dir).some(name => name.endsWith('.jsonl'));
  } catch {
    return false;
  }
}
