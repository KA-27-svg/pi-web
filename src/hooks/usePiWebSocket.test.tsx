// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { usePiWebSocket } from './usePiWebSocket';
import { ADVISOR_LANE } from '../services/piBridge';
import { useEffect } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 最小可用的 WebSocket 替身：记下发出去的帧，并允许测试主动回一条。
 * 桥接请求（上传 / 列目录 / 读附件 / 弹选择框）全靠「按 id 配对」，值得单独锁住。
 */
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  static latest: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.latest = this;
  }

  send(raw: string) {
    this.sent.push(raw);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** 最近一条指定类型的指令 */
  lastRequest(type: string): any {
    const frames = this.sent.map(raw => JSON.parse(raw));
    return frames.filter(frame => frame.type === type).at(-1);
  }
}

let root: Root;
let host: HTMLElement;
let api: ReturnType<typeof usePiWebSocket>;
/** 这个用例要挂在哪条 lane 上（undefined = 默认的 main） */
let requestedLane: string | undefined;

function Probe() {
  const value = usePiWebSocket(requestedLane ? { lane: requestedLane } : {});
  // 在 effect 里取，而不是渲染期间给模块级变量赋值
  useEffect(() => {
    api = value;
  });
  return null;
}

const socket = () => FakeWebSocket.latest as FakeWebSocket;

/** 所有发出去的帧，按顺序 */
const frames = () => socket().sent.map(raw => JSON.parse(raw));

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  act(() => {
    root.render(<Probe />);
  });
  act(() => {
    socket().open();
  });
}

function unmount() {
  act(() => root.unmount());
  host.remove();
}

/** 丢掉当前实例，换一条 lane 重新挂一个 */
function remountOn(lane: string) {
  unmount();
  FakeWebSocket.latest = null;
  requestedLane = lane;
  mount();
}

beforeEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.latest = null;
  requestedLane = undefined;
  mount();
});

afterEach(() => {
  unmount();
});

describe('lane', () => {
  it('连上后第一件事是登记自己属于哪条 lane', () => {
    expect(frames()[0]).toMatchObject({ type: 'register_lane', lane: 'main' });
  });

  it('初始状态也带 lane（否则会拉到另一个窗口的历史）', () => {
    expect(frames().every(frame => frame.lane === 'main')).toBe(true);
    expect(frames().map(frame => frame.type)).toContain('get_messages');
    expect(frames().map(frame => frame.type)).toContain('get_state');
  });

  it('顾问实例：登记与指令都带顾问的 lane', () => {
    remountOn(ADVISOR_LANE);

    const all = frames();
    expect(all[0]).toMatchObject({ type: 'register_lane', lane: ADVISOR_LANE });
    expect(all.filter(frame => frame.type === 'get_messages')[0].lane).toBe(ADVISOR_LANE);
    expect(all.every(frame => frame.lane === ADVISOR_LANE)).toBe(true);
  });

  it('动作模块不必自己拼 lane', () => {
    act(() => {
      api.sendPrompt({ text: '问', images: [], files: [] });
    });

    expect(socket().lastRequest('prompt').lane).toBe('main');
  });

  it('旧版桥接不认识 register_lane 也不影响首屏', async () => {
    // 现实里最常见的原因：改了桥接没重启。
    // 首屏绝不依赖这条登记的回包——否则忘重启一次就白屏。
    const frame = socket().lastRequest('register_lane');

    await act(async () => {
      socket().emit({
        id: frame.id,
        type: 'response',
        command: 'register_lane',
        success: false,
        error: 'Unknown command: register_lane',
      });
    });

    expect(socket().lastRequest('get_messages')).toBeTruthy();
  });

  it('顾问窗口换模型走 set_lane_model，不走 set_model', async () => {
    // 走 set_model 的话，前端会在成功后发 set_default_model，
    // 那是写全局默认模型——从顾问窗口换一次，执行窗口的默认也跟着变
    remountOn(ADVISOR_LANE);

    act(() => {
      api.setLaneModel('anthropic/claude-sonnet-4');
    });

    expect(socket().lastRequest('set_lane_model')).toMatchObject({
      lane: ADVISOR_LANE,
      model: 'anthropic/claude-sonnet-4',
    });
    expect(socket().lastRequest('set_model')).toBeFalsy();
    expect(socket().lastRequest('set_default_model')).toBeFalsy();
  });
});

describe('桥接请求的配对', () => {
  it('列目录：发出的指令带上 path 与 id，回包按 id 兑现', async () => {
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = api.listDir('src');
    });

    const sent = socket().lastRequest('list_dir');
    expect(sent).toMatchObject({ type: 'list_dir', path: 'src' });
    expect(typeof sent.id).toBe('string');

    await act(async () => {
      socket().emit({
        id: sent.id,
        type: 'dir_listing',
        success: true,
        path: 'src',
        parent: '',
        entries: [],
      });
    });

    await expect(pending).resolves.toMatchObject({ path: 'src' });
  });

  it('桥接不认识这条指令时立刻报错，而不是干等到超时', async () => {
    // 现实里最常见的原因：桥接没重启，跑的还是旧代码，
    // 于是指令被原样转发给 pi，pi 回一条 "Unknown command"。
    // 如果按回包类型配对，这条就配不上号，界面会白等 60 秒。
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = api.pickFile();
    });

    const sent = socket().lastRequest('pick_file');
    // 先把断言挂上，再去触发拒绝，免得报 unhandled rejection
    const assertion = expect(pending).rejects.toThrow(/Unknown command: pick_file/);

    await act(async () => {
      socket().emit({
        id: sent.id,
        type: 'response',
        command: 'pick_file',
        success: false,
        error: 'Unknown command: pick_file',
      });
    });

    await assertion;
  });

  it('桥接回了失败时把原因带出来', async () => {
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = api.readAttachment('C:/a.ts');
    });

    const sent = socket().lastRequest('read_attachment');
    const assertion = expect(pending).rejects.toThrow(/文件选择框/);

    await act(async () => {
      socket().emit({
        id: sent.id,
        type: 'attachment_content',
        success: false,
        error: '只能读取你在文件选择框里选过的文件',
      });
    });

    await assertion;
  });

  it('不是我们的回包（没有 id）照样交给 rpcHandler，不会误吞', async () => {
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = api.pickFile();
    });

    // 一条和请求无关的事件：不该影响等待中的 Promise
    await act(async () => {
      socket().emit({ type: 'agent_start' });
    });

    let settled = false;
    void pending?.then(() => (settled = true)).catch(() => (settled = true));
    await act(async () => {});
    expect(settled).toBe(false);
  });

  it('上传会把文件名与 base64 一起发出去', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], '报告.docx');

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = api.uploadFile(file);
    });

    const sent = socket().lastRequest('upload_file');
    expect(sent.name).toBe('报告.docx');
    expect(sent.data).toBeTruthy();

    await act(async () => {
      socket().emit({
        id: sent.id,
        type: 'file_uploaded',
        success: true,
        path: 'C:/work/.pi-web-uploads/报告.docx',
        relativePath: '.pi-web-uploads/报告.docx',
        name: '报告.docx',
        bytes: 3,
      });
    });

    await expect(pending).resolves.toMatchObject({ relativePath: '.pi-web-uploads/报告.docx' });
  });
});

describe('生成中排队与中断', () => {
  it('排队发送带 streamingBehavior，并把消息标成 queued', () => {
    act(() => {
      api.sendPrompt({ text: '第二句', images: [], files: [] }, { queue: true });
    });

    const sent = socket().lastRequest('prompt');
    expect(sent.streamingBehavior).toBe('followUp');
    expect(sent.message).toBe('第二句');
    expect(api.messages.some((m: any) => m.queued)).toBe(true);
  });

  it('中断先 clear_queue 再 abort，并把排队消息从对话里收回输入栏', async () => {
    act(() => {
      api.sendPrompt({ text: '第二句', images: [], files: [] }, { queue: true });
    });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = api.interrupt();
    });

    const cleared = socket().lastRequest('clear_queue');
    expect(cleared).toBeTruthy();
    // 回包还没到，不能抢先 abort
    expect(socket().lastRequest('abort')).toBeFalsy();

    await act(async () => {
      socket().emit({
        id: cleared.id,
        type: 'response',
        command: 'clear_queue',
        success: true,
        data: { steering: [], followUp: ['第二句'] },
      });
    });
    await pending;

    expect(socket().lastRequest('abort')).toBeTruthy();
    expect(api.messages.some((m: any) => m.queued)).toBe(false);
    expect(api.status.restoredDraft?.text).toBe('第二句');
  });

  it('只收回排队的那条，正在回答的那条留在对话里', async () => {
    act(() => {
      api.sendPrompt({ text: '正在回答的', images: [], files: [] });
    });
    act(() => {
      api.sendPrompt({ text: '排队的', images: [], files: [] }, { queue: true });
    });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = api.interrupt();
    });

    const cleared = socket().lastRequest('clear_queue');
    await act(async () => {
      socket().emit({
        id: cleared.id,
        type: 'response',
        command: 'clear_queue',
        success: true,
        data: { followUp: ['排队的'] },
      });
    });
    await pending;

    const contents = api.messages.map((m: any) => m.content);
    expect(contents).toContain('正在回答的');
    expect(contents).not.toContain('排队的');
  });

  it('队列是空的时只打断，不改动对话', async () => {
    act(() => {
      api.sendPrompt({ text: '只有一个问题', images: [], files: [] });
    });
    const before = api.messages.length;

    let pending: Promise<void> | undefined;
    act(() => {
      pending = api.interrupt();
    });

    const cleared = socket().lastRequest('clear_queue');
    await act(async () => {
      socket().emit({
        id: cleared.id,
        type: 'response',
        command: 'clear_queue',
        success: true,
        data: { steering: [], followUp: [] },
      });
    });
    await pending;

    expect(socket().lastRequest('abort')).toBeTruthy();
    expect(api.messages.length).toBe(before);
    expect(api.status.restoredDraft).toBeUndefined();
  });
});

describe('连接断开', () => {
  it('收尾正在生成的回答，不把它永远留在「生成中」', async () => {
    act(() => {
      api.sendPrompt({ text: '问', images: [], files: [] });
    });
    expect(api.messages.find(m => m.role === 'assistant')?.status).toBe('streaming');

    await act(async () => {
      socket().onclose?.();
    });

    expect(api.messages.find(m => m.role === 'assistant')?.status).toBe('done');
    expect(api.status.isStreaming).toBe(false);
  });
});
