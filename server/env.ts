import { execFile } from 'child_process';
import { listConfiguredProviders } from './setupConfig.js';

/**
 * 环境探测：这台机器能不能跑 pi。
 *
 * 单独成模块的理由和 PiSupervisor 一样——探测要跑外部命令，而命令执行必须可注入，
 * 否则测试会真的去调 node / npm / pi，既慢又依赖宿主环境。
 *
 * 版本门槛以 pi 官方安装器为准（install.sh 与 install.ps1 都是 22.19.0）。
 * 注意本项目自己只需要 Node ^20.19 || >=22.12 就能跑起来，所以**「网页能打开」
 * 并不代表「能装 pi」**，这个空档必须显式探测出来，不能默认放行。
 */

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

/** pi 要求的最低 Node 版本；与官方安装器的 preflight 保持一致 */
export const MINIMUM_NODE: NodeVersion = { major: 22, minor: 19, patch: 0 };

export const MINIMUM_NODE_TEXT = `${MINIMUM_NODE.major}.${MINIMUM_NODE.minor}.${MINIMUM_NODE.patch}`;

/**
 * 解析 `node --version` 的输出。
 * 容忍 v 前缀与缺失的 minor/patch（官方脚本也是这么宽松），识别不了返回 null。
 */
export function parseNodeVersion(raw: string): NodeVersion | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw.trim().replace(/^v/i, ''));
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

/** 是否达到 pi 的最低 Node 要求 */
export function meetsMinimumNode(version: NodeVersion | null): boolean {
  if (!version) return false;

  const { major, minor, patch } = MINIMUM_NODE;
  if (version.major !== major) return version.major > major;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
}

/**
 * 执行一条命令并拿回 stdout。
 *
 * 命令不存在、启动失败、超时或退出码非零一律返回 null——探测只关心「能不能用」，
 * 失败原因由调用方按场景组织成人话，这里不抛错。
 */
export type RunCommand = (command: string, args: string[]) => Promise<string | null>;

/**
 * 默认执行器：用 execFile 而不是 shell 拼接。
 *
 * Windows 上 pi / npm 是 .cmd，CreateProcess 不能直接执行批处理文件，必须过 shell
 * （与 PiSupervisor 里同样的理由）。命令名与参数都是静态字面量，没有任何用户输入
 * 参与拼接，所以这条路上没有注入面。
 */
export const defaultRunCommand: RunCommand = (command, args) =>
  new Promise(resolve => {
    execFile(
      command,
      args,
      { timeout: 10_000, windowsHide: true, shell: true },
      (error, stdout) => resolve(error ? null : String(stdout))
    );
  });

export type SetupIssueCode =
  | 'node-missing'
  | 'node-too-old'
  | 'npm-missing'
  | 'pi-missing'
  | 'git-bash-missing'
  | 'no-credentials';

export interface SetupIssue {
  code: SetupIssueCode;
  /** 给用户看的一句话：说清现状与下一步，不暴露内部细节 */
  message: string;
}

export interface SetupStatus {
  platform: string;
  node: { version: string | null; ok: boolean; minimum: string };
  npm: { available: boolean };
  pi: { installed: boolean; version: string | null };
  /** Git Bash 只在 Windows 上必需（pi 的 bash 工具用它） */
  gitBash: { required: boolean; available: boolean };
  /**
   * 已配好凭证的供应商（来自 auth.json 与环境变量）。
   * 只看有没有，不读凭证内容——key 不进这个进程之外的任何地方。
   */
  credentials: { providers: string[] };
  /** 环境和凭证都就绪，可以开始对话 */
  ready: boolean;
  issues: SetupIssue[];
}

export interface ProbeOptions {
  /** 默认取 process.platform；测试里固定住，避免结果随宿主环境漂移 */
  platform?: NodeJS.Platform;
  /** 查已配凭证的供应商。必须可注入，否则测试结果会随宿主机上真实配置漂移 */
  listCredentials?: () => Promise<string[]>;
}

export async function probeEnvironment(
  run: RunCommand,
  options: ProbeOptions = {}
): Promise<SetupStatus> {
  const platform = options.platform ?? process.platform;
  const gitBashRequired = platform === 'win32';

  // 互相独立，并行探测；Git Bash 只在 Windows 上问
  const [nodeRaw, npmRaw, piRaw, bashRaw, providers] = await Promise.all([
    run('node', ['--version']),
    run('npm', ['--version']),
    run('pi', ['--version']),
    gitBashRequired ? run('bash', ['--version']) : Promise.resolve(null),
    (options.listCredentials ?? listConfiguredProviders)(),
  ]);

  const parsedNode = nodeRaw === null ? null : parseNodeVersion(nodeRaw);
  const nodeOk = meetsMinimumNode(parsedNode);
  const npmAvailable = npmRaw !== null;
  const piInstalled = piRaw !== null;
  const gitBashAvailable = !gitBashRequired || bashRaw !== null;

  // 顺序固定：界面按这个顺序展示，测试也据此断言
  const issues: SetupIssue[] = [];
  if (nodeRaw === null) {
    issues.push({
      code: 'node-missing',
      message: `没找到 Node.js。pi 需要 ${MINIMUM_NODE_TEXT} 或更新版本。`,
    });
  } else if (!nodeOk) {
    issues.push({
      code: 'node-too-old',
      message: `Node.js 版本过低（当前 ${nodeRaw.trim()}，pi 需要 ${MINIMUM_NODE_TEXT} 或更新版本）。`,
    });
  }
  if (!npmAvailable) {
    issues.push({ code: 'npm-missing', message: '没找到 npm。官方安装器用 npm 安装 pi。' });
  }
  if (!piInstalled) {
    issues.push({ code: 'pi-missing', message: '这台机器上还没安装 pi。' });
  }
  if (!gitBashAvailable) {
    issues.push({
      code: 'git-bash-missing',
      message: '没找到 Git Bash。pi 的 bash 工具需要它（也可以改用 powershell 工具）。',
    });
  }
  // 装了 pi 却没配凭证，和没装 pi 是同一种结局：发消息不会有任何回复
  if (piInstalled && providers.length === 0) {
    issues.push({
      code: 'no-credentials',
      message: '还没有配置任何模型凭证，pi 不知道用哪个模型。',
    });
  }

  const nodeReady = nodeOk && piInstalled;

  return {
    platform,
    node: {
      version: nodeRaw === null ? null : nodeRaw.trim(),
      ok: nodeOk,
      minimum: MINIMUM_NODE_TEXT,
    },
    npm: { available: npmAvailable },
    pi: { installed: piInstalled, version: piRaw === null ? null : piRaw.trim() },
    gitBash: { required: gitBashRequired, available: gitBashAvailable },
    credentials: { providers },
    // Git Bash 缺失不阻断对话（只影响 shell 工具）；凭证缺失则阻断，因为对话根本进行不了
    ready: nodeReady && providers.length > 0,
    issues,
  };
}
