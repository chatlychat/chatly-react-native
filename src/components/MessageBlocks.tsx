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
 *
 * ── Three rulings a later reader will want to "fix" ─────────────────────
 *
 *  1. EVERY card action renders, all thirteen, with no overflow menu.
 *     `MAX_CARD_ACTIONS_VISIBLE` is five because five buttons are what a 380px
 *     WEB panel fits before they start a third row and push the composer off
 *     screen; here they wrap in a `flexWrap` row inside a scrolling list with
 *     no composer pinned under the card. A popover would also be a whole new
 *     interaction surface in a published package — modal, backdrop, focus,
 *     a second accessible name — built to hide buttons that already fit.
 *  2. The reaction pair is drawn and is NOT pressable: the one deliberately
 *     unfinished thing here. `Reactions` below argues it.
 *  3. A `table` lives in `BlockTable.tsx`, because this file is at the
 *     650-line ceiling. Its header argues the seam; the `case` stays here.
 */
import React from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton, Card } from './BlockCard';
import { BlockTable } from './BlockTable';
import { isSafeNavigatePath, navigateTarget, ownSitePath } from '../blocks/navigate';
import { readBlocksEnvelope } from '../blocks/read-envelope';
import { useChatly } from '../useChatly';

import type { WidgetAction, WidgetBlock } from '../blocks/types';

/**
 * The timeline states, in words.
 *
 * The stored plain-text projection keeps the author's enum member verbatim
 * because it is generated on the server and read back by a model; a surface
 * rendering for a person writes its own label. English literals because this
 * package has no translation layer — a consumer who needs another language
 * renders the envelope themselves, which `readBlocksEnvelope` is exported for.
 * `STOCK_LABEL`, which was beside this, moved to `BlockCard.tsx` with its only
 * reader.
 */
const STEP_LABEL = { done: 'Done', current: 'In progress', pending: 'Pending' } as const;

/**
 * A milestone's timestamp, or '' if this engine cannot format one.
 *
 * `Intl.DateTimeFormat` rather than `new Date(at).toLocaleString()`, for the
 * reason `blocks/money.ts` gives about `Intl.NumberFormat`: React Native
 * ships a full ICU on iOS and, since 0.73 with Hermes `intl` enabled, on
 * Android — and the `catch` is what covers an engine without it, so a
 * timeline still renders its labels rather than taking the thread down.
 *
 * The reader has already dropped an `at` that `Date.parse` refuses, so the
 * words "Invalid Date" cannot reach here from a malformed row; the guard
 * below is about the FORMATTER being absent, not the value being bad.
 */
function formatStepTime(at: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(at),
    );
  } catch {
    return '';
  }
}

/** One timeline row's text. Absent or unformattable time leaves no dangling separator. */
function stepLine(step: {
  readonly label: string;
  readonly at?: string;
  readonly state: keyof typeof STEP_LABEL;
}): string {
  const when = step.at === undefined ? '' : formatStepTime(step.at);
  return `${step.label} — ${STEP_LABEL[step.state]}${when === '' ? '' : ` · ${when}`}`;
}

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
       *
       * The dashboard inbox DOES render it now, through the shared
       * `renderMarkdown` and the allow-listed HTML walk it already has.
       * Neither is reusable here: that renderer emits HTML and there is no
       * HTML in React Native, so the only native option is a second inline
       * parser mapping a subset onto nested `Text` styles — a parser in a
       * published package, for asterisks that are already legible.
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
    case 'card_grid': {
      /*
       * The trailing tile, and here it WORKS — unlike on the two agent
       * surfaces, where it is inert because an agent has no visitor session.
       * This is the shopper's own app, so the thing the tile exists for (ask
       * the bot for the next page, or open the full catalogue) is a tap. Its
       * action is already narrowed to `postback | url` by the reader, which
       * is the whole point of that narrowing: the other three kinds would be
       * a button that shows no more cards.
       *
       * `ActionButton` and not a bespoke control, so the tile obeys the same
       * `onRun` path, the same theme and the same accessible name as every
       * other button in the thread.
       */
      /*
       * The TILE's label is what renders, not the action's.
       *
       * `more` carries both — `{ label: 'Show all 60', action: { label:
       * 'More', … } }` — and the tile is the thing the shopper reads. The
       * override only touches the label, so the postback's `value` and the
       * url's `href` reach `onRun` exactly as authored.
       */
      const more =
        block.more === undefined ? null : (
          <ActionButton action={{ ...block.more.action, label: block.more.label }} onRun={onRun} />
        );
      return block.layout === 'carousel' ? (
        <ScrollView horizontal accessibilityLabel="Scrollable options">
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {block.cards.map((c, i) => (
              <Card key={c.id ?? String(i)} card={c} onRun={onRun} width={240} />
            ))}
            {more}
          </View>
        </ScrollView>
      ) : (
        <View style={{ gap: 8 }}>
          {block.cards.map((c, i) => (
            <Card key={c.id ?? String(i)} card={c} onRun={onRun} />
          ))}
          {more}
        </View>
      );
    }
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
    case 'order_status':
      /*
       * The fulfilment timeline — "where is my order", answered in the thread
       * instead of a link out to a tracking page the shopper has to find an
       * order number for.
       *
       * Nothing in it is a control, and that is the block's design rather
       * than this renderer's restraint: there is no action, no amount and no
       * payment reference, because a `checkout` block would have put this
       * package in the payment path. The state is written out in words beside
       * the label — a coloured dot alone says nothing to a screen reader, and
       * this surface has no dot.
       */
      return (
        <View accessibilityLabel="Order status" style={{ gap: 2 }}>
          {block.steps.map((step, i) => (
            <Text
              key={`${step.label}-${String(i)}`}
              style={step.state === 'pending' ? muted : body}
            >
              {stepLine(step)}
            </Text>
          ))}
        </View>
      );
    case 'table':
      // In `BlockTable.tsx` — ruling 3 in the header says why, and the `case`
      // stays here so `check-block-renderer-parity.mjs` sees the literal.
      return <BlockTable block={block} />;
    case 'place': {
      /*
       * A destination in words. There is no world in a phone app, so the label
       * IS the block (see `spatial-schema.ts` in `@livechat/shared`), and there
       * is no button for the same reason: a world host owns "take me there".
       * The `Place:` prefix is in the accessible name so a screen reader says
       * what kind of line it is.
       */
      const line = block.detail === undefined ? block.label : `${block.label} — ${block.detail}`;
      return (
        <Text accessibilityRole="text" accessibilityLabel={`Place: ${line}`} style={body}>
          {line}
        </Text>
      );
    }
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
  const { rest, config, onAction, onOpenUrl, onNavigate } = useChatly();
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
  /** `navigate`'s behaviour, shared with an own-site `url` action. */
  const runNavigate = (path: string, label: string, actionId: string): void => {
    if (!isSafeNavigatePath(path)) {
      return;
    }
    const handled = onNavigate?.({
      path,
      label,
      conversationId: props.conversationId,
      messageId: props.messageId,
      actionId,
    });
    const target = navigateTarget(config.siteOrigin, path);
    if (handled !== true && target !== null) {
      void Linking.openURL(target);
    }
  };

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
      case 'url': {
        /*
         * An href on the app's OWN site routes like `navigate`, through the
         * same guard and the same hook — Crossly's round 2. An older card, an
         * agent who typed a full link and a help article all arrive as `url`,
         * and sending the buyer to the system browser for a screen the app
         * owns loses their place. `ownSitePath` returns null for every other
         * origin, so this cannot capture a third-party link.
         *
         * Before `onOpenUrl`, deliberately: a host that set BOTH hooks means
         * `onNavigate` for its own pages and `onOpenUrl` for the rest, which
         * is the split the two hooks exist to express.
         */
        const own = ownSitePath(config.siteOrigin, action.href);
        if (own !== null) {
          runNavigate(own, action.label, action.href);
          return;
        }
        /*
         * The app gets first refusal. `onOpenUrl` returning true means it
         * routed this itself — a listing, a cart, a watchlist screen the app
         * already has — and leaving to the browser would lose the buyer's
         * place for a destination the app owns.
         *
         * Anything else falls through to `Linking.openURL`, so an integration
         * with no hook behaves exactly as before and an href the app does not
         * recognise still reaches the browser rather than being swallowed.
         */
        if (onOpenUrl?.(action.href) === true) {
          return;
        }
        void Linking.openURL(action.href);
        return;
      }
      case 'navigate':
        /*
         * Re-checked at the sink, like the web widget: the app's router gets
         * this string, and `//evil.example` handed to a router leaves the app.
         */
        runNavigate(action.path, action.label, action.id ?? action.path);
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
