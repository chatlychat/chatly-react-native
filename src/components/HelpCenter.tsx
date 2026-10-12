import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useChatly } from '../useChatly';

import type { KbArticle, KbResult } from '../client/types';

export interface HelpCenterProps {
  /** Initial query to seed the search box. */
  initialQuery?: string;
}

/**
 * Renders a KB search box, a result list, and an article reader. We do not
 * pull in a markdown renderer (would add a non-RN-primitive dep); instead we
 * display the plaintext `body` field. Consumers who want rich rendering can
 * embed their own renderer by re-using `useChatly().rest.getKbArticle`.
 */
export function HelpCenter({ initialQuery = '' }: HelpCenterProps): React.JSX.Element {
  const { rest, theme } = useChatly();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<KbResult[]>([]);
  const [article, setArticle] = useState<KbArticle | null>(null);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(
    async (q: string): Promise<void> => {
      if (q.trim().length === 0) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await rest.searchKb(q.trim());
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [rest],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(query);
    }, 200);
    return (): void => clearTimeout(handle);
  }, [query, runSearch]);

  const openArticle = useCallback(
    async (slug: string): Promise<void> => {
      setLoading(true);
      try {
        const res = await rest.getKbArticle(slug);
        setArticle(res.article);
      } finally {
        setLoading(false);
      }
    },
    [rest],
  );

  if (article !== null) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Pressable
          onPress={() => setArticle(null)}
          accessibilityRole="button"
          accessibilityLabel="Back to results"
          style={{ padding: theme.spacing.md }}
        >
          <Text style={{ color: theme.colors.primary, fontSize: theme.typography.sizeBody }}>
            ← Back
          </Text>
        </Pressable>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: theme.typography.sizeTitle,
              fontWeight: theme.typography.weightBold,
              marginBottom: theme.spacing.md,
            }}
          >
            {article.title}
          </Text>
          <Text
            style={{
              color: theme.colors.foreground,
              fontSize: theme.typography.sizeBody,
              lineHeight: theme.typography.sizeBody * 1.5,
            }}
          >
            {article.body}
          </Text>
        </ScrollView>
      </View>
    );
  }

  const renderItem = ({ item }: ListRenderItemInfo<KbResult>): React.JSX.Element => (
    <Pressable
      onPress={() => void openArticle(item.slug)}
      accessibilityRole="button"
      accessibilityLabel={`Open article ${item.title}`}
      style={({ pressed }) => [
        {
          padding: theme.spacing.md,
          backgroundColor: pressed ? theme.colors.surface : theme.colors.background,
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.foreground,
          fontWeight: theme.typography.weightMedium,
          fontSize: theme.typography.sizeBody,
        }}
      >
        {item.title}
      </Text>
      <Text
        style={{
          color: theme.colors.mutedForeground,
          fontSize: theme.typography.sizeSmall,
          marginTop: 2,
        }}
        numberOfLines={2}
      >
        {item.excerpt}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={{ padding: theme.spacing.md }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search help articles…"
          placeholderTextColor={theme.colors.mutedForeground}
          style={{
            color: theme.colors.foreground,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            fontSize: theme.typography.sizeBody,
          }}
        />
      </View>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginTop: theme.spacing.lg }} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r): string => r.id}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text
              style={{
                color: theme.colors.mutedForeground,
                textAlign: 'center',
                padding: theme.spacing.lg,
              }}
            >
              {query.trim().length === 0 ? 'Type to search.' : 'No results.'}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
