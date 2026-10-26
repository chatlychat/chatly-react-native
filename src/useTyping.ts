import { useEffect, useState } from 'react';

import { useChatly } from './useChatly';

import type { TypingState } from './client/types';

/** The core's window (`TYPING_STOP_AFTER_MS`): `typing.stop` is best-effort, so the state expires itself. */
export const TYPING_STOP_AFTER_MS = 3_500;

/**
 * An agent or a bot typing payload, or null. `kind: 'viewing'` frames are
 * room presence published AS `typing.start`, not typing. Hand copy of
 * `readTyping` in `packages/core/src/message.ts`.
 */
export function readTyping(p: unknown): TypingState | null {
  if (typeof p !== 'object' || p === null) {
    return null;
  }
  const r = p as Record<string, unknown>;
  if (r['kind'] === 'viewing' || (r['actorType'] !== 'agent' && r['actorType'] !== 'bot')) {
    return null;
  }
  return {
    actorType: r['actorType'],
    actorId: typeof r['actorId'] === 'string' ? r['actorId'] : '',
    displayName: typeof r['displayName'] === 'string' ? r['displayName'] : null,
    label: typeof r['label'] === 'string' && r['label'] !== '' ? r['label'] : null,
  };
}

/**
 * Who is typing in a conversation, or null. Set by `typing.start`, cleared by
 * `typing.stop`, by the agent's or bot's next message, and after
 * `TYPING_STOP_AFTER_MS` without another `start`. Needs the socket scoped to
 * this conversation (`<MessagesList>` does that; call `setActiveConversation`
 * yourself for a custom thread).
 */
export function useTyping(conversationId: string | null): TypingState | null {
  const { realtime } = useChatly();
  const [typing, setTyping] = useState<TypingState | null>(null);

  useEffect(() => {
    setTyping(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      setTyping(null);
    };
    const mine = (p: unknown): boolean =>
      conversationId !== null &&
      (p as { conversationId?: unknown } | null)?.conversationId === conversationId;
    const offStart = realtime.on('typing.start', (e) => {
      const t = mine(e.payload) ? readTyping(e.payload) : null;
      if (t === null) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      setTyping(t);
      timer = setTimeout(clear, TYPING_STOP_AFTER_MS);
    });
    const offStop = realtime.on('typing.stop', (e) => {
      if (mine(e.payload) && readTyping(e.payload) !== null) {
        clear();
      }
    });
    const offMsg = realtime.on('message.created', (e) => {
      const a = (e.payload as { authorType?: unknown } | null)?.authorType;
      if (mine(e.payload) && (a === 'agent' || a === 'bot')) {
        clear();
      }
    });
    return (): void => {
      offStart();
      offStop();
      offMsg();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [realtime, conversationId]);

  return typing;
}
