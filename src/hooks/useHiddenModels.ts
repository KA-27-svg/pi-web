import { useCallback, useState } from 'react';

const STORAGE_KEY = 'pi-web:hidden-models';

function read(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string => typeof item === 'string'))
      : new Set();
  } catch {
    // 存的东西坏了、或者 localStorage 用不了（无痕模式）：当作没藏过
    return new Set();
  }
}

/**
 * 不显示的模型。
 *
 * pi 那边**没有**「隐藏模型」这个概念——模型清单一律来自它的内置目录和 models.json。
 * 所以这份清单只存在浏览器里：pi 照旧列出它们，只是网页这边不显示。
 *
 * 也没有写进 pi 的配置文件：那份 models.json 是用户手写的，每个模型上带着 cost /
 * compat / reasoning 那些细节，我们写回一次就会全丢掉。藏起来是纯显示层的事。
 *
 * 代价是换台机器、换个浏览器就没了——可以接受，反正随时能重新藏。
 */
export function useHiddenModels() {
  const [hidden, setHidden] = useState<Set<string>>(read);

  const persist = useCallback((next: Set<string>) => {
    setHidden(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // 写不进去就算了：这次会话里仍然生效，不该因此报错
    }
  }, []);

  const hide = useCallback(
    (key: string) => persist(new Set([...hidden, key])),
    [hidden, persist]
  );

  const show = useCallback(
    (key: string) => {
      const next = new Set(hidden);
      next.delete(key);
      persist(next);
    },
    [hidden, persist]
  );

  return { hidden, isHidden: (key: string) => hidden.has(key), hide, show };
}
