import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, type ListRenderItemInfo, StyleSheet, Text, View } from 'react-native';

import { MessageBubble } from './MessageBubble';
import { useChatly } from '../useChatly';
import { useTyping } from '../useTyping';

import type {
  Attachment,
  MessageCreatedPayload,
  MessageRow,
  RealtimeEnvelope,
} from '../client/types';

export interface MessagesListProps {
  conversationId: string;
  /** Number of messages to load on mount. Defaults to 50. */
  pageSize?: number;
}

export function MessagesList({
  conversationId,
  pageSize = 50,
}: MessagesListProps): React.JSX.Element {
  const { rest, realtime, theme, setActiveConversation } = useChatly();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const typing = useTyping(conversationId);
  const listRef = useRef<FlatList<MessageRow>>(null);

  /**
   * Scope the visitor socket to this thread.
   *
   * A visitor's realtime token names one conversation, so the thread on
   * screen is what decides which socket is open. Clearing it on unmount is
   * deliberate: a socket for a thread nobody is looking at is a connection
   * and a 1h token for nothing.
   */
  useEffect(() => {
    setActiveConversation(conversationId);
    return (): void => {
      setActiveConversation(null);
    };
  }, [conversationId, setActiveConversation]);

  useEffect(() => {
    let cancelled = false;
    void rest
      .listMessages(conversationId, pageSize)
      .then((res) => {
        if (!cancelled) {
          setMessages(res.messages);
        }
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [rest, conversationId, pageSize]);

  useEffect(() => {
    const off = realtime.on(
      'message.created',
      (envelope: RealtimeEnvelope<MessageCreatedPayload>) => {
        const p = envelope.payload;
        if (p.conversationId !== conversationId) {
          return;
        }
        /*
         * Every field the envelope carries, not the five this once copied.
         *
         * It hand-built `{ id, authorType, kind: 'text', body, createdAt }`,
         * so a card, a canvas step or an attachment delivered LIVE rendered
         * as a bare text bubble — and then came out correctly after a reload,
         * because the REST page carries the same fields this drops. A bug
         * that fixes itself on refresh is the hardest kind to be told about.
         *
         * `kind: 'text'` was the worst of it: a `rich` message announced
         * itself as plain, so `MessageBubble` took the plain-text path for a
         * body that is not the message. The envelope's own `kind` is the only
         * authority on that.
         *
         * `blocks` and `canvas` were ALSO undeclared on
         * `messageCreatedPayloadSchema` until 2026-10-23 while being
         * published all along, so reading the contract to find out what
         * arrives gave the wrong answer. They are declared now; this reads
         * them.
         *
         * Left `unknown` and handed to `readBlocksEnvelope` at render time,
         * exactly as `MessageRow` documents: a server newer than this app
         * sends block types it has never heard of, and the row must render
         * what CAN be drawn rather than fail a type check.
         */
        const row: MessageRow = {
          id: p.id,
          authorType: p.authorType,
          kind: p.kind ?? 'text',
          body: p.body,
          createdAt: p.createdAt,
          ...(p.attachments === undefined ? {} : { attachments: p.attachments as Attachment[] }),
          ...(p.blocks === undefined ? {} : { blocks: p.blocks }),
          ...(p.canvas === undefined ? {} : { canvas: p.canvas }),
        };
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
      },
    );
    return off;
  }, [realtime, conversationId]);

  const data = useMemo(
    () => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages],
  );

  useEffect(() => {
    if (data.length > 0) {
      // Defer until after layout to ensure offset is valid.
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [data.length]);

  const renderItem = useCallback(
    // `conversationId` passed down so a card action knows where to report —
    // without it a `host_event` tap would reach the app with a null
    // conversation and `reportAction` would have nowhere to go.
    ({ item }: ListRenderItemInfo<MessageRow>) => (
      <MessageBubble message={item} conversationId={conversationId} />
    ),
    [conversationId],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(m): string => m.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: theme.spacing.md }}
      />
      {typing !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: theme.colors.mutedForeground,
            fontSize: theme.typography.sizeSmall,
            paddingHorizontal: theme.spacing.md,
            paddingBottom: theme.spacing.sm,
          }}
        >
          {/* The label is author text: a Text child, never markup. */}
          {typing.label ??
            (typing.displayName === null ? 'Typing…' : `${typing.displayName} is typing…`)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
