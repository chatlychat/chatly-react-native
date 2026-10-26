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

import { resolveAttachment, type PickedAttachment } from '../attachments';
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
  /**
   * Controlled text. Pass `value` with `onChangeText` to own the draft (speech
   * recognition, a tapped starter); the composer still clears it after a send
   * by calling `onChangeText('')`. Omit both and it keeps its own.
   */
  value?: string;
  onChangeText?: (text: string) => void;
  /**
   * Pick an attachment. Return `{ bytes }`, `{ uri }` or `{ base64 }` — the
   * SDK reads the file — with `filename` and `mimeType` optional. `null`
   * means the visitor cancelled.
   *
   * Preferred over `globalThis.__chatlyPicker`, which is still read when this
   * is absent: a global is set once per app, where which picker a screen
   * wants (camera on a product screen, documents in support) is per screen.
   */
  pickAttachment?: () => Promise<PickedAttachment | null>;
}

/**
 * Bottom composer with a paperclip attachment button, multi-line text input,
 * and a send button.
 *
 * Attachment picking takes no dependency on any picker package — this
 * package has no native dependencies, and a consumer adding one has to
 * rebuild. The host supplies the picker:
 *
 *   <Composer pickAttachment={async () => { … }} />
 *
 * and may return `{ bytes }`, `{ uri }` or `{ base64 }`, with `filename` and
 * `mimeType` optional. `resolveAttachment` reads the file. That matters
 * because no Expo picker returns bytes — `expo-image-picker` and
 * `expo-document-picker` both give a `uri` — so the old bytes-only contract
 * made every Expo app write a `fetch(uri)` read or a base64 decoder first
 * (Crossly reported it, and noted some engines have no `atob`).
 *
 * `globalThis.__chatlyPicker` still works and is still read when no prop is
 * given: it is the documented contract of 0.9.0 through 0.11.0 and apps are
 * on it. The prop is preferred because a global is set once per app, where
 * the picker a screen wants is a per-screen decision — a buyer app offering
 * the camera on a product screen and a document picker in support is the case
 * that made it awkward.
 *
 * With neither, the button degrades gracefully: still visible, with a
 * "Pick disabled" hint.
 */
declare global {
  // eslint-disable-next-line no-var
  var __chatlyPicker: (() => Promise<PickedAttachment | null>) | undefined;
}

export function Composer({
  conversationId,
  onSent,
  placeholder = 'Type a message…',
  value: controlled,
  onChangeText,
  pickAttachment,
}: ComposerProps): React.JSX.Element {
  const { rest, theme } = useChatly();
  const [own, setOwn] = useState('');
  const value = controlled ?? own;
  const setValue = (text: string): void => {
    setOwn(text);
    onChangeText?.(text);
  };
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
    // The prop wins; the global is the 0.9-0.11 contract and still honoured.
    const picker = pickAttachment ?? globalThis.__chatlyPicker;
    if (picker === undefined) {
      // No picker supplied — silently no-op so the host doesn't crash. Hosts
      // can detect this by checking the same two places.
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
      // Reads the file when the picker gave a uri or base64 — see
      // `resolveAttachment`. A thrown error lands in the catch below and
      // reaches the visitor as upload copy, which is what it is.
      const attachment = await rest.uploadAttachment(await resolveAttachment(picked));
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
