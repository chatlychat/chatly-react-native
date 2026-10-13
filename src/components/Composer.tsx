import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useChatly } from '../useChatly';

import type { Attachment } from '../client/types';

export interface ComposerProps {
  conversationId: string | null;
  /**
   * Called after a message is successfully sent. When `conversationId` is
   * null, the composer starts a new conversation and the returned id is
   * delivered here.
   */
  onSent?: (conversationId: string) => void;
  placeholder?: string;
}

/**
 * Bottom composer with a paperclip attachment button, multi-line text input,
 * and a send button.
 *
 * Attachment picking depends on a document-picker module being available at
 * runtime. We do NOT take a hard dependency on any picker package — instead
 * the picker is resolved lazily via `globalThis.__chatlyPicker`. Hosts that
 * want native attachment picking install one of:
 *   - `expo-document-picker`
 *   - `@react-native-documents/picker`
 *   - `react-native-document-picker`
 * and assign a small shim that returns `{ bytes, filename, mimeType }`. When
 * no picker is present the button degrades gracefully (still visible, but
 * surfaces a "Pick disabled" hint).
 */
declare global {
  // eslint-disable-next-line no-var
  var __chatlyPicker:
    | (() => Promise<{ bytes: Uint8Array; filename: string; mimeType: string } | null>)
    | undefined;
}

export function Composer({
  conversationId,
  onSent,
  placeholder = 'Type a message…',
}: ComposerProps): React.JSX.Element {
  const { rest, theme } = useChatly();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [staged, setStaged] = useState<Attachment[]>([]);
  /**
   * Why the last attachment did not attach.
   *
   * The presign route refuses on three conditions and each one's copy is
   * written for the VISITOR to read: "File uploads are turned off for this
   * chat", "That file type is not accepted: …", "Files must be under 10 MB".
   * This used to be a silent no-op — a paperclip tap where nothing appeared
   * and nothing was said, which reads as a broken app rather than a refused
   * file.
   */
  const [uploadError, setUploadError] = useState<string | null>(null);

  const send = async (): Promise<void> => {
    const trimmed = value.trim();
    if ((trimmed.length === 0 && staged.length === 0) || sending) {
      return;
    }
    setSending(true);
    try {
      const attachments = staged.length > 0 ? staged : undefined;
      if (conversationId === null) {
        const res = await rest.start(trimmed, attachments);
        onSent?.(res.conversation.id);
      } else {
        await rest.reply(conversationId, trimmed, attachments);
        onSent?.(conversationId);
      }
      setValue('');
      setStaged([]);
    } catch {
      // Non-fatal: leave the input populated so the user can retry.
    } finally {
      setSending(false);
    }
  };

  const attach = async (): Promise<void> => {
    const picker = globalThis.__chatlyPicker;
    if (picker === undefined) {
      // No picker installed — silently no-op so the host doesn't crash. Hosts
      // can detect this by checking `globalThis.__chatlyPicker` themselves.
      return;
    }
    if (uploading) {
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const picked = await picker();
      if (picked === null) {
        return;
      }
      const attachment = await rest.uploadAttachment({
        bytes: picked.bytes,
        filename: picked.filename,
        mimeType: picked.mimeType,
      });
      setStaged((prev) => [...prev, attachment]);
    } catch (err: unknown) {
      // `ChatlyRequestError.message` is the server's own copy when it sent
      // any — see RestClient. The fallback is for a transport failure, where
      // there is nothing from the server to show.
      setUploadError(err instanceof Error ? err.message : 'Could not attach that file');
    } finally {
      setUploading(false);
    }
  };

  const removeStaged = (id: string): void => {
    setStaged((prev) => prev.filter((a) => a.id !== id));
    setUploadError(null);
  };

  const sendDisabled = sending || (value.trim().length === 0 && staged.length === 0);

  return (
    <View
      style={[
        styles.column,
        {
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.background,
          padding: theme.spacing.sm,
        },
      ]}
    >
      {(staged.length > 0 || uploading) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {uploading && (
            <View
              style={[
                styles.chip,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <ActivityIndicator color={theme.colors.primary} size="small" />
              <Text
                style={{
                  color: theme.colors.foreground,
                  fontSize: theme.typography.sizeSmall,
                  marginLeft: 6,
                }}
              >
                Uploading…
              </Text>
            </View>
          )}
          {staged.map((a) => (
            <View
              key={a.id}
              style={[
                styles.chip,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                },
              ]}
            >
              <Text
                style={{
                  color: theme.colors.foreground,
                  fontSize: theme.typography.sizeSmall,
                  maxWidth: 140,
                }}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {a.filename}
              </Text>
              <Pressable
                onPress={() => removeStaged(a.id)}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
                style={styles.removeBtn}
              >
                <Text style={{ color: theme.colors.mutedForeground }}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {uploadError !== null && (
        <Text
          accessibilityRole="alert"
          style={{
            color: theme.colors.danger,
            fontSize: theme.typography.sizeSmall,
            paddingHorizontal: 2,
            paddingBottom: 6,
          }}
        >
          {uploadError}
        </Text>
      )}
      <View style={styles.row}>
        <Pressable
          onPress={attach}
          disabled={uploading || sending}
          accessibilityRole="button"
          accessibilityLabel="Attach a file"
          style={({ pressed }) => [
            styles.attach,
            {
              opacity: pressed || uploading ? 0.6 : 1,
              marginRight: theme.spacing.sm,
            },
          ]}
        >
          {uploading ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text
              style={{
                color: theme.colors.primary,
                fontSize: theme.typography.sizeBody + 6,
                fontWeight: theme.typography.weightMedium,
              }}
            >
              +
            </Text>
          )}
        </Pressable>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.mutedForeground}
          multiline
          editable={!sending}
          style={[
            styles.input,
            {
              color: theme.colors.foreground,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              fontSize: theme.typography.sizeBody,
            },
          ]}
        />
        <Pressable
          onPress={send}
          disabled={sendDisabled}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              opacity: pressed || sendDisabled ? 0.6 : 1,
              marginLeft: theme.spacing.sm,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color={theme.colors.onPrimary} />
          ) : (
            <Text
              style={{
                color: theme.colors.onPrimary,
                fontWeight: theme.typography.weightMedium,
                fontSize: theme.typography.sizeBody,
              }}
            >
              Send
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flexDirection: 'column',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  chipScroll: { marginBottom: 6 },
  chipRow: { alignItems: 'center', paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 6,
  },
  removeBtn: {
    marginLeft: 6,
    paddingHorizontal: 4,
    minWidth: 16,
    alignItems: 'center',
  },
  attach: {
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
  },
  send: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
});
