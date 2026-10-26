/**
 * ONE card, and everything that hangs off it, on a native screen.
 *
 * ── Why it is not in `MessageBlocks.tsx` ────────────────────────────────
 *
 * Because it does not fit. That file was 495 lines; the badge, reaction and
 * table work is about 230 more, against this repo's 650-line ceiling
 * (`scripts/check-file-size.mjs`). Splitting a file is never free — CLAUDE.md
 * has had to record that twice about the widget's byte budget — so the seam
 * was chosen rather than taken at the first convenient blank line.
 *
 * This is a real one: a CARD and the parts only a card has (its badges, its
 * reaction pair, its price, its buttons) against the BLOCK LIST and the
 * action runner that drives it. The switch in `MessageBlocks.tsx` keeps every
 * `case` and every block-type literal, so `check-block-renderer-parity.mjs`
 * still reads them where it expects to. `ActionButton` is exported alongside
 * `Card` because three of those cases — `actions`, a grid's `more` tile and
 * nothing else — need the same button, and a second copy of it is how two
 * buttons in one thread come to have different accessible names.
 *
 * Everything here is the VISITOR's own control and therefore live, unlike the
 * two agent renderers where every button is `disabled`. The one exception is
 * the reaction pair, and `Reactions` says at length why.
 */
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { formatMoney } from '../blocks/money';
import { useChatly } from '../useChatly';

import type { Money } from '../blocks/money';
import type { WidgetAction, WidgetCard, WidgetCardBadgeTone } from '../blocks/types';

/**
 * Availability in this surface's own words.
 *
 * The stored plain-text projection keeps the author's enum member verbatim
 * (`Stock: out_of_stock`) because it is generated on the server and read back
 * by a model; a surface rendering for a person writes its own label. English
 * literals because this package has no translation layer — a consumer who
 * needs another language renders the envelope themselves, which
 * `readBlocksEnvelope` is exported for.
 */
const STOCK_LABEL = {
  in_stock: 'In stock',
  low: 'Low stock',
  out_of_stock: 'Out of stock',
} as const;

/**
 * What each tone adds BESIDES a colour, and why it has to add something.
 *
 * The rule is not "pick a legible colour", it is that colour may never be the
 * only carrier of meaning: "Great price" and "Above typical" are both badges
 * and they say opposite things in one pill, which is the entire reason `tone`
 * exists. So a reader with no colour vision gets the glyph and a screen reader
 * gets the word. `neutral` is the ABSENCE of a claim and so gets neither — a
 * plain pill is the correct rendition of "Sale", which is what every badge
 * stored before tones existed is.
 */
const BADGE_TONE: Record<WidgetCardBadgeTone, { readonly glyph: string; readonly word: string }> = {
  success: { glyph: '\u2713', word: 'positive' },
  warning: { glyph: '!', word: 'caution' },
  danger: { glyph: '\u2715', word: 'negative' },
  neutral: { glyph: '', word: '' },
};

/**
 * The badges on a card, all of them.
 *
 * Both, never the first: the common pair is a fact and a verdict — "Sale"
 * beside "Above typical" — and drawing one shows the shopper half of what the
 * author wrote. `card.badge` is already an array of `{ text, tone }`:
 * `blocks/read-envelope.ts` collapsed the write format's three spellings,
 * which is why `WidgetCardBadge` is not a union and this renderer cannot get
 * one of three branches wrong.
 *
 * Only `danger` gets a COLOUR, and that gap is worth naming. `ChatlyTheme` is
 * this package's public theme contract and it carries `danger` but no
 * `success` and no `warning`; mapping those onto `primary`, or onto a
 * hard-coded green, would be this file deciding what a consumer's palette
 * means. They take the ordinary border and lean on the glyph and the
 * accessible word, which carry the meaning anyway. Colouring them means new
 * tokens in `ChatlyTheme` — a published interface, and that file's call.
 */
export function Badges({
  badges,
}: {
  readonly badges: WidgetCard['badge'];
}): React.JSX.Element | null {
  const { theme } = useChatly();
  if (badges === undefined || badges.length === 0) {
    return null;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
      {badges.map((badge, i) => {
        const tone = BADGE_TONE[badge.tone];
        return (
          <View
            key={`${badge.text}-${String(i)}`}
            style={{
              borderWidth: 1,
              borderColor: badge.tone === 'danger' ? theme.colors.danger : theme.colors.border,
              backgroundColor: theme.colors.background,
              borderRadius: 999,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 1,
            }}
          >
            <Text
              accessibilityLabel={tone.word === '' ? badge.text : `${badge.text} (${tone.word})`}
              style={{ color: theme.colors.foreground, fontSize: theme.typography.sizeSmall }}
            >
              {tone.glyph === '' ? badge.text : `${tone.glyph} ${badge.text}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The pair in words. A lone thumb glyph says nothing to a screen reader. */
const REACTION_LABEL = { like: 'Helpful', dislike: 'Not helpful' } as const;

/**
 * The reaction pair, now PRESSABLE.
 *
 * It was drawn-and-inert on purpose until the contract existed: this package
 * is installed in other people's apps, and inventing a wire name here that
 * the widget later spelled differently would have been a silent no-op (zod
 * strips an unknown key and the server answers 200) plus a breaking release
 * to correct. Both open questions are now answered and PINNED, as golden
 * literals rather than as references to a constant, in the widget's
 * `blocks/reaction-wire.spec.ts`:
 *
 *  - `card.reaction` is the postback's `value`; `{ card, reaction }` is its
 *    `payload`.
 *  - a card with no `id` sends no `card` key at all. No positional fallback:
 *    a card's index in a grid changes when the grid is patched, so the same
 *    key would later mean a different product.
 *
 * `reaction: null` on clearing is explicit, not absent, so a bot can tell
 * "took it back" from "never rated it".
 *
 * ── The one place this surface differs from the web, deliberately ───────
 *
 * It dims the card it rated. The two AGENT renderers must not and say so:
 * an agent looking at a transcript is reading what the shopper was shown,
 * and fading a card there would misrepresent the conversation. This is the
 * shopper's own screen and their own verdict, so the feedback belongs.
 *
 * State is held for the life of the view and stored nowhere, which is what
 * the schema says: `messages.blocks` is the author's content, replaced
 * wholesale by a patch, so a viewer's tap written there would race the
 * author and be attributed to the wrong actor.
 */
function Reactions({
  card,
  onRun,
}: {
  readonly card: WidgetCard;
  readonly onRun: (action: WidgetAction) => void;
}): React.JSX.Element | null {
  const { theme } = useChatly();
  /*
   * Seeded from the AUTHOR's `card.reaction`, so reopening the app shows the
   * verdict the bot is still ranking on rather than an un-pressed thumb on a
   * card that is being held against the shopper. Local state sits ON TOP, so
   * the tap lands instantly while the silent postback is in flight.
   */
  const [picked, setPicked] = React.useState<'like' | 'dislike' | null>(card.reaction ?? null);
  const reactions = card.reactions;
  if (reactions === undefined || reactions.length === 0) {
    return null;
  }
  return (
    /*
     * A plain View, with NO `accessible` prop. The inert version had
     * `accessible` plus a label naming the pair, which is right when the
     * children are two words of prose — it collapses them into one node a
     * screen reader reads once. It is WRONG now they are buttons: that
     * collapse makes the children unreachable, so the thumbs would be
     * invisible to the very readers the label was for.
     *
     * And `button` with `accessibilityState.selected`, not `radio`: pressing
     * the active thumb CLEARS it, and a radio group cannot return to
     * none-selected. It is the same semantics the web sets with
     * `aria-pressed`.
     */
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: 4 }}>
      {reactions.map((reaction) => {
        const active = picked === reaction;
        return (
          <Pressable
            key={reaction}
            accessibilityRole="button"
            accessibilityLabel={REACTION_LABEL[reaction]}
            accessibilityState={{ selected: active }}
            onPress={() => {
              const next = active ? null : reaction;
              setPicked(next);
              onRun({
                kind: 'postback',
                label: REACTION_LABEL[reaction],
                value: 'card.reaction',
                // Absent, not present-and-undefined. See the widget's copy.
                payload: {
                  ...(card.id === undefined ? {} : { card: card.id }),
                  reaction: next,
                },
                silent: true,
              });
            }}
            style={{
              minWidth: 44,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              borderRadius: theme.radius.sm,
            }}
          >
            {/*
              The word, not a glyph. An emoji thumb is announced by its own
              unicode name by some screen readers and by nothing at all by
              others, and the accessible label above is the only thing that
              makes either reliable — so the visible text says it too, and a
              44pt box is the platform's own touch-target floor rather than
              the web's 32px.
            */}
            <Text
              style={{
                color: active ? theme.colors.primary : theme.colors.mutedForeground,
                fontSize: theme.typography.sizeSmall,
              }}
            >
              {REACTION_LABEL[reaction]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The card's image and title, wrapped in one pressable when `card.action` is
 * set and in a plain view when it is not.
 *
 * A `Pressable` with `accessibilityRole="link"` for a `url` action and
 * `"button"` for the other two, so a screen reader says which it is. The
 * title is the accessible name by being inside it.
 *
 * A `url` action goes through the SAME `onRun` path as a button, so the app's
 * `onOpenUrl` hook gets first refusal on it. Calling `Linking.openURL` here
 * would have been a second route to the same place, and the hook would have
 * worked for buttons and silently not for photos.
 */
function CardTapTarget({
  card,
  onRun,
  children,
}: {
  readonly card: WidgetCard;
  readonly onRun: (action: WidgetAction) => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const action = card.action;
  if (action === undefined) {
    return <>{children}</>;
  }
  return (
    <Pressable
      accessibilityRole={action.kind === 'url' ? 'link' : 'button'}
      onPress={() => {
        onRun(action);
      }}
      style={{ gap: 4 }}
    >
      {children}
    </Pressable>
  );
}

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

export function ActionButton(props: {
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

export function Card(props: {
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
      {/*
        The image and title as ONE tap target when the card carries an
        `action`, and as plain views when it does not.
        `card-head.tsx` in the widget argues the constraint at length and it
        is the same here: the CARD does not become pressable, because a card
        contains buttons (its actions, its reaction pair) and nesting
        pressables makes the inner ones unreachable or double-activating, and
        a screen reader announce one control containing others.
        The image's `accessibilityLabel` is dropped when it is inside the tap
        target: the title is in the same control and is its name, so keeping
        both makes a product link announce twice.
      */}
      <CardTapTarget card={card} onRun={props.onRun}>
        {card.image !== undefined && (
          <Image
            source={{ uri: card.image }}
            {...(card.action === undefined ? { accessibilityLabel: card.title } : {})}
            accessibilityIgnoresInvertColors
            style={{ width: '100%', height: 140, borderRadius: theme.radius.md }}
          />
        )}
        <Text style={{ color: theme.colors.foreground, fontSize: theme.typography.sizeBody }}>
          {card.title}
        </Text>
      </CardTapTarget>
      <Badges badges={card.badge} />
      {card.subtitle !== undefined && (
        <Text style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}>
          {card.subtitle}
        </Text>
      )}
      {card.stock !== undefined && (
        <Text style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}>
          {STOCK_LABEL[card.stock]}
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
      {/*
        The options the shopper was offered, as a READOUT and not a picker.

        Deliberate, and not a budget decision: nothing in the protocol carries
        a chosen variant. A variant's `value` is "what a program receives",
        but no action references it — a card's own `actions` carry their own
        `value`, and there is no field on a postback for the option that was
        selected. A tappable option would therefore have to invent a wire
        contract here, in a published package, ahead of the widget that owns
        the picking UX. Shown instead, so the shopper can read the run of
        sizes and ask; `inStock === false` is marked and an ABSENT `inStock`
        is not, because the author not saying is not the same as sold out.
      */}
      {card.variants !== undefined && card.variants.length > 0 && (
        <Text
          accessibilityLabel="Options"
          style={{ color: theme.colors.mutedForeground, fontSize: theme.typography.sizeSmall }}
        >
          {`Options: ${card.variants
            .map((v) => (v.inStock === false ? `${v.label} (unavailable)` : v.label))
            .join(', ')}`}
        </Text>
      )}
      {/* All thirteen if the author sent thirteen — ruling 1 in the header. */}
      {(card.actions ?? []).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {(card.actions ?? []).map((a, i) => (
            <ActionButton key={`${a.label}-${String(i)}`} action={a} onRun={props.onRun} />
          ))}
        </View>
      )}
      {/*
        KEYED on the author's value: `useState`'s initial argument is read
        once, so a later block patch would leave the old thumb on screen while
        the bot ranked on the new one. Remounting discards a local tap the
        author has overruled, which is the right precedence — the bot's belief
        is what steers the results.
      */}
      <Reactions key={`r:${card.reaction ?? ''}`} card={card} onRun={props.onRun} />
    </View>
  );
}
