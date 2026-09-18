import { useCallback, useEffect, useState } from 'react';
import { clampRatio, DEFAULT_RATIO } from '../utils/paneRatio';

const ENABLED_KEY = 'pi-web:assistant-mode';
const RATIO_KEY = 'pi-web:assistant-ratio';

/** localStorage 可能用不了（无痕模式）或者存着上次的垃圾，全部当作「没存过」 */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 存不了就算了：这只是下一次打开时的初始值
  }
}

export function readStoredEnabled(): boolean {
  return read(ENABLED_KEY) === '1';
}

export function readStoredRatio(): number {
  const raw = read(RATIO_KEY);
  if (raw === null) return DEFAULT_RATIO;
  return clampRatio(Number(raw));
}

/**
 * 助手模式的开关与分栏比例。
 *
 * 存 localStorage：这是个「随手切一下」的开关，每次打开都reset 回关着
 * 反而会让人以为功能没了。
 */
export function useAssistantMode() {
  const [enabled, setEnabled] = useState(readStoredEnabled);
  const [ratio, setRatio] = useState(readStoredRatio);

  useEffect(() => {
    write(ENABLED_KEY, enabled ? '1' : '0');
  }, [enabled]);

  useEffect(() => {
    write(RATIO_KEY, String(ratio));
  }, [ratio]);

  const toggle = useCallback(() => setEnabled(value => !value), []);
  const setRatioClamped = useCallback((value: number) => setRatio(clampRatio(value)), []);

  return { enabled, toggle, ratio, setRatio: setRatioClamped };
}
