import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useChatly } from '../useChatly';
import { MessageBlocks } from './MessageBlocks';
import { MessageCanvas } from './MessageCanvas';

import type { Attachment, MessageRow } from '../client/types';

export interface MessageBubbleProps {
  message: MessageRow;
  /**
   * The conversation the message is in, so a card action knows where to
   * report. Optional, because a consumer rendering a bubble outside a thread
   * (a preview, a notification) has no conversation — and then an action
   * renders and does nothing rather than posting to the wrong place.
   */
  conversationId?: string | null;
}

export function MessageBubble({ message, conversationId }: MessageBubbleProps): React.JSX.Element {
  const { theme } = useChatly();
  const isContact = message.authorType === 'contact';
  const isSystem = message.authorType === 'system' || message.kind === 'event';
  const attachments = message.attachments ?? [];

  if (isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text
          style={[
            styles.systemText,
            { color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall },
          ]}
        >
          {message.body}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, isContact ? styles.rowRight : styles.rowLeft]}>
      <View
        style={[
          styles.bubble,
          {
            borderRadius: theme.radius.bubble,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            backgroundColor: isContact ? theme.colors.primary : theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: isContact ? 0 : StyleSheet.hairlineWidth,
            maxWidth: '80%',
          },
        ]}
      >
        {message.body.length > 0 && (
          <Text
            style={{
              color: isContact ? theme.colors.onPrimary : theme.colors.foreground,
              fontSize: theme.typography.sizeBody,
            }}
          >
            {message.body}
          </Text>
        )}
        {attachments.map((a) => (
          <AttachmentView
            key={a.id}
            attachment={a}
            isContact={isContact}
            withCaption={message.body.length > 0}
          />
        ))}
        {/*
          Rich blocks and the canvas, INSIDE the bubble and after the body.
          Mounted on this branch — the only one a bot message reaches — and
          deliberately not on the `isSystem` branch above: a system line is a
          sentence about the conversation, never a card.

          `check-block-renderer-parity.mjs` asserts this mount exists and
          that this file's spec exercises it. It cannot tell whether a mount
          is on every branch a message can take, which is the defect that
          shipped in the agent inbox — so the spec is the half that reads
          the output.
        */}
        <MessageBlocks
          blocks={message.blocks}
          conversationId={conversationId ?? null}
          messageId={message.id}
        />
        <MessageCanvas
          canvas={message.canvas}
          conversationId={conversationId ?? null}
          messageId={message.id}
        />
      </View>
    </View>
  );
}

function AttachmentView(props: {
  attachment: Attachment;
  isContact: boolean;
  withCaption: boolean;
}): React.JSX.Element {
  const { theme } = useChatly();
  const { attachment, isContact, withCaption } = props;
  const isImage = attachment.mimeType.toLowerCase().startsWith('image/');
  const topMargin = withCaption ? 6 : 0;
  if (isImage) {
    return (
      <Image
        source={{ uri: attachment.url }}
        resizeMode="cover"
        accessibilityLabel={attachment.filename}
        style={{
          width: 220,
          height: 180,
          borderRadius: 10,
          marginTop: topMargin,
        }}
      />
    );
  }
  return (
    <View
      style={[
        styles.fileRow,
        {
          backgroundColor: isContact ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.04)',
          marginTop: topMargin,
        },
      ]}
    >
      <Text
        style={{
          color: isContact ? theme.colors.onPrimary : theme.colors.foreground,
          fontSize: 13,
          fontWeight: theme.typography.weightMedium,
          flexShrink: 1,
        }}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {attachment.filename}
      </Text>
      <Text
        style={{
          color: isContact ? 'rgba(255,255,255,0.75)' : theme.colors.mutedForeground,
          fontSize: 11,
          marginLeft: 8,
        }}
      >
        {formatSize(attachment.sizeBytes)}
      </Text>
    </View>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  row: { width: '100%', flexDirection: 'row', marginVertical: 4 },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: {},
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  systemRow: { width: '100%', alignItems: 'center', marginVertical: 6 },
  systemText: { fontStyle: 'italic' },
});
