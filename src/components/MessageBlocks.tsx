/**
 * Rich blocks on a native screen — INTERACTIVE, unlike the agent app's.
 *
 * ── What makes this one different ──────────────────────────────────────
 *
 * `apps/mobile-agent`'s renderer draws every action as plain text, because an
 * agent on their phone has no visitor session to act as. This one is the
 * visitor's own app, so a button is a button: a `postback` sends a reply, a
 * `url` opens a link, a `step` asks for a canvas, and a `host_event` is handed
 * to the APP.
 *
 * `host_event` is the whole reason the spec asked for this package. A card
 * saying "Pay $48.20" has to run Stripe with the buyer's real session, and on
 * a phone that means a native payment sheet — not a WebView, not a browser
 * hop. So the action does nothing here and calls `onAction` from the
 * provider, which is the integrator's own code.
 *
 * ── A carousel is a horizontal ScrollView, a grid is a stack ───────────
 *
 * Never two columns. Two cards at 160px on a phone are narrower than the
 * images they carry, which is the same call `apps/mobile-agent` made. A
 * `carousel` layout is honoured because it is horizontal rather than narrow:
 * each card gets most of the width and the row scrolls.
 *
 * ── `status` is rendered here, and skipped in the agent app ────────────
 *
 * There it is "progress, not content" for somebody reading history. Here the
 * shopper is watching it happen — "Looking through the shop…" patched to
 * "Found 6" is the feedback that stops them tapping again.
 */
import React from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { formatMoney } from '../blocks/money';
import { readBlocksEnvelope } from '../blocks/read-envelope';
import { useChatly } from '../useChatly';

import type { Money } from '../blocks/money';
import type { WidgetAction, WidgetBlock, WidgetCard } from '../blocks/types';

export interface MessageBlocksProps {
  /** The stored envelope, straight off the message row. Unvalidated. */
  readonly blocks: unknown;
  /** The conversation the blocks belong to, for `reportAction` and postbacks. */
  readonly conversationId: string | null;
  /** The message they are on, for the same reason. */
  readonly messageId: string;
}

/**
 * The price.
 *
 * ONE line of text rather than a struck-through was-price beside it: React
 * Native has no `<s>`, and `textDecorationLine: 'line-through'` on a nested
 * `Text` is unreliable across the two platforms. "Was X" reads correctly in
 * both and in a screen reader, which the visual version does not — the same
 * call `apps/mobile-agent` made.
 */
function Price({ value }: { readonly value?: Money }): React.JSX.Element | null {
  const { theme } = useChatly();
  if (value === undefined) {
    return null;
  }
  const was =
    value.compareAt !== undefined && value.compareAt > value.amount
      ? formatMoney({ amount: value.compareAt, currency: value.currency })
      : null;
  const now = formatMoney(value);
  return (
    <Text style={{ color: theme.colors.foreground, fontSize: theme.typography.sizeBody }}>
      {was === null ? now : `${now} (was ${was})`}
    </Text>
  );
}

function ActionButton(props: {
  readonly action: WidgetAction;
  readonly onRun: (action: WidgetAction) => void;
}): React.JSX.Element {
  const { theme } = useChatly();
  const { action, onRun } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      onPress={() => onRun(action)}
      style={{
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        backgroundColor: action.style === 'primary' ? theme.colors.primary : theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: action.style === 'primary' ? 0 : 1,
      }}
    >
      <Text
        style={{
          color: action.style === 'primary' ? theme.colors.onPrimary : theme.colors.foreground,
          fontSize: theme.typography.sizeBody,
        }}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

function Card(props: {
  readonly card: WidgetCard;
  readonly onRun: (action: WidgetAction) => void;
  readonly width?: number;
}): React.JSX.Element {
  const { theme } = useChatly();
  const { card, width } = props;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.bubble,
        backgroundColor: theme.colors.surface,
        padding: theme.spacing.sm,
        gap: 4,
        ...(width === undefined ? {} : { width }),
      }}
    >
      {card.image !== undefined && (
        <Image
          source={{ uri: card.image }}
          accessibilityLabel={card.title}
          accessibilityIgnoresInvertColors
          style={{ width: '100%', height: 140, borderRadius: theme.radius.md }}
        />
      )}
      {card.badge !== undefined && (
        <Text style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}>
          {card.badge}
        </Text>
      )}
      <Text style={{ color: theme.colors.foreground, fontSize: theme.typography.sizeBody }}>
        {card.title}
      </Text>
      {card.subtitle !== undefined && (
        <Text style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}>
          {card.subtitle}
        </Text>
      )}
      <Price value={card.price} />
      {(card.fields ?? []).map((f, i) => (
        <Text
          key={`${f.label}-${String(i)}`}
          style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}
        >
          {`${f.label}: ${f.value}`}
        </Text>
      ))}
      {(card.actions ?? []).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {(card.actions ?? []).map((a, i) => (
            <ActionButton key={`${a.label}-${String(i)}`} action={a} onRun={props.onRun} />
          ))}
        </View>
      )}
    </View>
  );
}

function Block(props: {
  readonly block: WidgetBlock;
  readonly onRun: (action: WidgetAction) => void;
  readonly onReply: (value: string) => void;
}): React.JSX.Element | null {
  const { theme } = useChatly();
  const { block, onRun, onReply } = props;
  const muted = { color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall };
  const body = { color: theme.colors.foreground, fontSize: theme.typography.sizeBody };

  switch (block.type) {
    case 'text':
      /*
       * The markdown is rendered as PLAIN TEXT, deliberately.
       *
       * A markdown renderer on React Native is a dependency, and this package
       * has exactly one (`socket.io-client`). The characters a bot actually
       * emits — `**bold**`, a bullet, a link — read acceptably raw, and the
       * alternative a consumer has is to render the block themselves from the
       * envelope, which `readBlocksEnvelope` is exported for.
       */
      return <Text style={body}>{block.markdown}</Text>;
    case 'media':
      return block.kind === 'image' ? (
        <Image
          source={{ uri: block.url }}
          accessibilityLabel={block.alt}
          accessibilityIgnoresInvertColors
          style={{ width: '100%', height: 180, borderRadius: theme.radius.md }}
        />
      ) : (
        // No video element without a dependency. The alt text plus a tappable
        // link is strictly better than a blank space.
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(block.url)}>
          <Text style={body}>{block.alt}</Text>
        </Pressable>
      );
    case 'fields':
      return (
        <View style={{ gap: 2 }}>
          {block.items.map((f, i) => (
            <Text key={`${f.label}-${String(i)}`} style={muted}>{`${f.label}: ${f.value}`}</Text>
          ))}
        </View>
      );
    case 'card':
      return <Card card={block} onRun={onRun} />;
    case 'card_grid':
      return block.layout === 'carousel' ? (
        <ScrollView horizontal accessibilityLabel="Scrollable options">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {block.cards.map((c, i) => (
              <Card key={c.id ?? String(i)} card={c} onRun={onRun} width={240} />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={{ gap: 8 }}>
          {block.cards.map((c, i) => (
            <Card key={c.id ?? String(i)} card={c} onRun={onRun} />
          ))}
        </View>
      );
    case 'actions':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {block.actions.map((a, i) => (
            <ActionButton key={`${a.label}-${String(i)}`} action={a} onRun={onRun} />
          ))}
        </View>
      );
    case 'quick_replies':
      return (
        <View
          accessibilityLabel="Quick replies"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
        >
          {block.options.map((o, i) => (
            <Pressable
              key={`${o.value}-${String(i)}`}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              onPress={() => onReply(o.value)}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.colors.border,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: 6,
              }}
            >
              <Text style={body}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      );
    case 'status':
      return (
        <Text accessibilityRole="text" style={muted}>
          {block.state === 'failed' ? `${block.text} — failed` : block.text}
        </Text>
      );
    case 'divider':
      return (
        <View
          style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }}
          accessibilityLabel="divider"
        />
      );
    default:
      // Unreachable: `readBlocksEnvelope` drops an unknown type. Present so
      // adding one to the schema is a compile error here rather than a blank
      // space on a shopper's screen — which is what
      // `check-block-renderer-parity.mjs` is also watching for.
      return null;
  }
}

export function MessageBlocks(props: MessageBlocksProps): React.JSX.Element | null {
  const { rest, onAction } = useChatly();
  const envelope = readBlocksEnvelope(props.blocks);
  if (envelope === null) {
    return null;
  }

  /**
   * Run one action.
   *
   * `host_event` is handed to the app and nothing else happens here — the app
   * reports the outcome back with `rest.reportAction`, which is what appends
   * "Added to your cart" under the card and tells the owning bot. Everything
   * else is a call this package can make itself.
   */
  const onRun = (action: WidgetAction): void => {
    const conversationId = props.conversationId;
    switch (action.kind) {
      case 'host_event':
        onAction?.({
          event: action.event,
          data: action.data ?? {},
          conversationId,
          messageId: props.messageId,
          actionId: action.id ?? action.event,
        });
        return;
      case 'url':
        void Linking.openURL(action.href);
        return;
      case 'postback':
        if (conversationId !== null) {
          void rest.postback(conversationId, {
            value: action.value,
            ...(action.payload === undefined ? {} : { payload: action.payload }),
            silent: action.silent === true,
          });
        }
        return;
      case 'step':
        if (conversationId !== null) {
          void rest.requestCanvasStep(conversationId, action.canvasId, action.params);
        }
        return;
      case 'copy':
        /*
         * No clipboard. `@react-native-clipboard/clipboard` is a native
         * module and this package has no native dependencies by design — a
         * consumer adding one would have to rebuild. The text is shown
         * instead, which is selectable, and an integrator who wants a real
         * copy button renders the envelope themselves.
         */
        return;
      default:
        return;
    }
  };

  const onReply = (value: string): void => {
    if (props.conversationId !== null) {
      void rest.reply(props.conversationId, value);
    }
  };

  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      {envelope.blocks.map((b, i) => (
        <Block key={b.id ?? `${b.type}-${String(i)}`} block={b} onRun={onRun} onReply={onReply} />
      ))}
    </View>
  );
}
