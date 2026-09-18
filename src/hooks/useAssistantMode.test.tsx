// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEffect } from 'react';
import { readStoredEnabled, readStoredRatio, useAssistantMode } from './useAssistantMode';
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from '../utils/paneRatio';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let api: ReturnType<typeof useAssistantMode>;

function Probe() {
  const value = useAssistantMode();
  useEffect(() => {
    api = value;
  });
  return null;
}

const mount = () => {
  act(() => {
    root.render(<Probe />);
  });
};

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('存下来的初始值', () => {
  it('什么都没存过时：关着、默认比例', () => {
    expect(readStoredEnabled()).toBe(false);
    expect(readStoredRatio()).toBe(DEFAULT_RATIO);
  });

  it('存过就照存的来', () => {
    window.localStorage.setItem('pi-web:assistant-mode', '1');
    window.localStorage.setItem('pi-web:assistant-ratio', '0.7');

    expect(readStoredEnabled()).toBe(true);
    expect(readStoredRatio()).toBe(0.7);
  });

  it('存坏了 / 越界了也能给出可用值', () => {
    window.localStorage.setItem('pi-web:assistant-ratio', '不是数字');
    expect(readStoredRatio()).toBe(DEFAULT_RATIO);

    window.localStorage.setItem('pi-web:assistant-ratio', '9');
    expect(readStoredRatio()).toBe(MAX_RATIO);

    window.localStorage.setItem('pi-web:assistant-ratio', '0');
    expect(readStoredRatio()).toBe(MIN_RATIO);
  });
});

describe('写入', () => {
  it('开关状态存下来（下次打开还记得）', () => {
    mount();

    act(() => {
      api.toggle();
    });

    expect(api.enabled).toBe(true);
    expect(window.localStorage.getItem('pi-web:assistant-mode')).toBe('1');

    act(() => {
      api.toggle();
    });
    expect(window.localStorage.getItem('pi-web:assistant-mode')).toBe('0');
  });

  it('比例写入前先夹住', () => {
    mount();

    act(() => {
      api.setRatio(5);
    });

    expect(api.ratio).toBe(MAX_RATIO);
    expect(window.localStorage.getItem('pi-web:assistant-ratio')).toBe(String(MAX_RATIO));
  });

  it('localStorage 用不了也不该让界面崩掉（无痕模式）', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    mount();

    expect(() => {
      act(() => {
        api.toggle();
      });
    }).not.toThrow();
    expect(api.enabled).toBe(true);

    window.localStorage.setItem = original;
  });
});
