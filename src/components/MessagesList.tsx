import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, type ListRenderItemInfo, StyleSheet, View } from 'react-native';

import { MessageBubble } from './MessageBubble';
import { useChatly } from '../useChatly';

import type { MessageCreatedPayload, MessageRow, RealtimeEnvelope } from '../client/types';

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
        const row: MessageRow = {
          id: p.id,
          authorType: p.authorType,
          kind: 'text',
          body: p.body,
          createdAt: p.createdAt,
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
