/**
 * <ChatlyWidget /> — drop-in inbox surface. Renders the conversation list when
 * none is selected, the message view + composer when one is, and (optionally)
 * the help center via a tab toggle. Mirrors the "open the bubble, see your
 * conversations" UX of Tawk.to / Intercom mobile SDKs.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Composer } from './components/Composer';
import { HelpCenter } from './components/HelpCenter';
import { MessagesList } from './components/MessagesList';
import { useChatly } from './useChatly';

import type { ConversationSummary } from './client/types';

type Tab = 'messages' | 'help';

export interface ChatlyWidgetProps {
  /** Show the help-center tab. Defaults to true. */
  enableHelpCenter?: boolean;
  /** Pre-open a specific conversation. */
  initialConversationId?: string;
}

export function ChatlyWidget({
  enableHelpCenter = true,
  initialConversationId,
}: ChatlyWidgetProps): React.JSX.Element {
  const { isReady, error, conversations, theme, refresh, init, rest } = useChatly();
  const remove = useCallback(
    (id: string) => {
      void rest
        .dismiss(id)
        .then(refresh)
        .catch(() => undefined);
    },
    [rest, refresh],
  );
  const [tab, setTab] = useState<Tab>('messages');
  const [selected, setSelected] = useState<string | null>(initialConversationId ?? null);

  useEffect(() => {
    if (initialConversationId !== undefined) {
      setSelected(initialConversationId);
    }
  }, [initialConversationId]);

  const onSent = useCallback(
    (conversationId: string) => {
      setSelected(conversationId);
      void refresh();
    },
    [refresh],
  );

  if (error !== null) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: theme.colors.danger, padding: theme.spacing.lg }}>
            {`Couldn't load chat: ${error.message}`}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isReady) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <View
      style={[
        styles.header,
        {
          borderBottomColor: theme.colors.border,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.foreground,
          fontSize: theme.typography.sizeTitle,
          fontWeight: theme.typography.weightBold,
        }}
      >
        {init?.workspace.name ?? 'Support'}
      </Text>
      {enableHelpCenter && (
        <View style={styles.tabs}>
          <TabButton
            label="Messages"
            active={tab === 'messages'}
            onPress={() => setTab('messages')}
          />
          <TabButton label="Help" active={tab === 'help'} onPress={() => setTab('help')} />
        </View>
      )}
    </View>
  );

  if (tab === 'help') {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        {header}
        <HelpCenter />
      </SafeAreaView>
    );
  }

  if (selected !== null) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: theme.colors.border,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.background,
              flexDirection: 'row',
              alignItems: 'center',
            },
          ]}
        >
          <Pressable
            onPress={() => setSelected(null)}
            accessibilityRole="button"
            accessibilityLabel="Back to conversation list"
            style={{ paddingRight: theme.spacing.md }}
          >
            <Text style={{ color: theme.colors.primary, fontSize: theme.typography.sizeBody }}>
              ←
            </Text>
          </Pressable>
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: theme.typography.sizeTitle,
              fontWeight: theme.typography.weightBold,
            }}
          >
            Conversation
          </Text>
        </View>
        <MessagesList conversationId={selected} />
        <Composer conversationId={selected} onSent={onSent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {header}
      <ConversationList conversations={conversations} onOpen={setSelected} onRemove={remove} />
      <Composer conversationId={null} onSent={onSent} placeholder="Start a new conversation…" />
    </SafeAreaView>
  );
}

function ConversationList({
  conversations,
  onOpen,
  onRemove,
}: {
  conversations: ConversationSummary[];
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
}): React.JSX.Element {
  const { theme } = useChatly();
  const renderItem = ({ item }: ListRenderItemInfo<ConversationSummary>): React.JSX.Element => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable
        onPress={() => onOpen(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation ${item.subject ?? item.id}`}
        style={({ pressed }) => [
          {
            padding: theme.spacing.md,
            backgroundColor: pressed ? theme.colors.surface : theme.colors.background,
            borderBottomColor: theme.colors.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
            flexDirection: 'row',
            alignItems: 'center',
            flex: 1,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: theme.colors.foreground,
              fontWeight: theme.typography.weightMedium,
              fontSize: theme.typography.sizeBody,
            }}
          >
            {item.subject ?? 'Conversation'}
          </Text>
          <Text
            style={{
              color: theme.colors.mutedForeground,
              fontSize: theme.typography.sizeSmall,
              marginTop: 2,
            }}
            numberOfLines={1}
          >
            {item.lastMessagePreview ?? 'No messages yet.'}
          </Text>
        </View>
        {item.unreadContactCount > 0 && (
          <View
            style={{
              backgroundColor: theme.colors.primary,
              borderRadius: 999,
              minWidth: 22,
              paddingHorizontal: 6,
              paddingVertical: 2,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: theme.colors.onPrimary,
                fontSize: theme.typography.sizeSmall,
                fontWeight: theme.typography.weightBold,
              }}
            >
              {item.unreadContactCount}
            </Text>
          </View>
        )}
      </Pressable>
      <Pressable
        onPress={() => onRemove(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Remove conversation ${item.subject ?? item.id} from this list`}
        style={{ padding: theme.spacing.md }}
      >
        <Text style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}>
          Remove
        </Text>
      </Pressable>
    </View>
  );
  return (
    <FlatList
      data={conversations}
      keyExtractor={(c): string => c.id}
      renderItem={renderItem}
      ListEmptyComponent={
        <Text
          style={{
            color: theme.colors.mutedForeground,
            textAlign: 'center',
            padding: theme.spacing.lg,
          }}
        >
          No conversations yet. Send a message to get started.
        </Text>
      }
    />
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { theme } = useChatly();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
        borderBottomColor: active ? theme.colors.primary : 'transparent',
        borderBottomWidth: 2,
      }}
    >
      <Text
        style={{
          color: active ? theme.colors.primary : theme.colors.mutedForeground,
          fontWeight: active ? theme.typography.weightBold : theme.typography.weightRegular,
          fontSize: theme.typography.sizeBody,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', marginTop: 6 },
});
