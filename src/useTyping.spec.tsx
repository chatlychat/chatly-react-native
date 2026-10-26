/**
 * Typing: the realtime `typing.start` / `typing.stop` payload (`actorType`,
 * `displayName`, `label`, `kind: 'viewing'` for presence frames), rendered in
 * `MessagesList` and exposed by `useTyping`.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from './ChatlyProvider';
import { MessagesList } from './components/MessagesList';
import { defaultTheme } from './theme/defaultTheme';
import { readTyping, TYPING_STOP_AFTER_MS, useTyping } from './useTyping';

import type { ChatlyContextValue } from './ChatlyProvider';

afterEach(cleanup);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fake() {
  const listeners = new Map<string, Set<(e: { payload: unknown }) => void>>();
  const realtime = {
    on: (type: string, fn: (e: { payload: unknown }) => void) => {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(fn);
      return () => set.delete(fn);
    },
  };
  const emit = (type: string, payload: unknown) =>
    act(() => {
      listeners.get(type)?.forEach((fn) => fn({ payload }));
    });
  const value = {
    theme: defaultTheme,
    realtime,
    setActiveConversation: () => undefined,
    rest: { listMessages: vi.fn().mockResolvedValue({ messages: [] }) },
  } as unknown as ChatlyContextValue;
  return { emit, value };
}

const bot = (over: Record<string, unknown> = {}) => ({
  conversationId: 'c1',
  actorType: 'bot',
  actorId: 'b1',
  displayName: 'Ada',
  ...over,
});

describe('MessagesList typing line', () => {
  it("shows the bot's label in place of 'is typing', then clears on stop", () => {
    const f = fake();
    render(
      <ChatlyContext.Provider value={f.value}>
        <MessagesList conversationId="c1" />
      </ChatlyContext.Provider>,
    );
    f.emit('typing.start', bot({ label: 'Looking at your photo…' }));
    expect(screen.getByText('Looking at your photo…')).toBeDefined();
    f.emit('typing.stop', bot());
    expect(screen.queryByText('Looking at your photo…')).toBeNull();
  });

  it('falls back to the name, and to a bare Typing…', () => {
    const f = fake();
    render(
      <ChatlyContext.Provider value={f.value}>
        <MessagesList conversationId="c1" />
      </ChatlyContext.Provider>,
    );
    f.emit('typing.start', bot());
    expect(screen.getByText('Ada is typing…')).toBeDefined();
    f.emit('typing.start', bot({ displayName: null }));
    expect(screen.getByText('Typing…')).toBeDefined();
  });
});

describe('useTyping', () => {
  function Probe({ id }: { id: string }) {
    const t = useTyping(id);
    return <span>{t === null ? 'idle' : `${t.actorType}:${t.label ?? '-'}`}</span>;
  }
  const mount = (f: ReturnType<typeof fake>) =>
    render(
      <ChatlyContext.Provider value={f.value}>
        <Probe id="c1" />
      </ChatlyContext.Provider>,
    );

  it('ignores another conversation and presence frames', () => {
    const f = fake();
    mount(f);
    f.emit('typing.start', bot({ conversationId: 'other' }));
    f.emit('typing.start', bot({ kind: 'viewing' }));
    f.emit('typing.start', bot({ actorType: 'visitor' }));
    expect(screen.getByText('idle')).toBeDefined();
  });

  it('expires on its own when no stop arrives', () => {
    const f = fake();
    mount(f);
    f.emit('typing.start', bot({ label: 'x' }));
    expect(screen.getByText('bot:x')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(TYPING_STOP_AFTER_MS + 1);
    });
    expect(screen.getByText('idle')).toBeDefined();
  });

  it('clears when the bot or agent posts its message', () => {
    const f = fake();
    mount(f);
    f.emit('typing.start', bot());
    f.emit('message.created', { conversationId: 'c1', authorType: 'bot' });
    expect(screen.getByText('idle')).toBeDefined();
  });
});

describe('readTyping', () => {
  it('matches the core on its specimens', () => {
    expect(readTyping({ actorType: 'agent' })).toEqual({
      actorType: 'agent',
      actorId: '',
      displayName: null,
      label: null,
    });
    expect(readTyping({ actorType: 'agent', kind: 'viewing' })).toBeNull();
    expect(readTyping({ actorType: 'contact' })).toBeNull();
    expect(readTyping(null)).toBeNull();
  });
});
