/** 工具按用途分组，用来选标签配色 */
export type ToolKind = 'shell' | 'read' | 'write' | 'edit' | 'search' | 'other';

/**
 * 判断工具属于哪一类。
 *
 * pi 的内置工具是固定几个名字（bash / read / write / edit / grep / find / ls），
 * 但扩展和自定义工具的名字不可预知（比如 exa_search），所以这里既做精确匹配
 * 也做关键词判断，认不出来就归到 other。
 */
export function toolKind(name: string): ToolKind {
  const normalized = name.toLowerCase();

  if (normalized === 'bash' || normalized === 'powershell' || normalized === 'shell') {
    return 'shell';
  }
  if (normalized === 'read' || normalized === 'ls' || normalized === 'find') return 'read';
  if (normalized === 'write') return 'write';
  if (normalized === 'edit' || normalized === 'apply_patch' || normalized === 'multiedit') {
    return 'edit';
  }
  if (normalized.includes('search') || normalized.includes('grep') || normalized.includes('web')) {
    return 'search';
  }

  return 'other';
}
