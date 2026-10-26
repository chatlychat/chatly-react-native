/**
 * The rich-block vocabulary, restated for the published package.
 *
 * Mirrors `packages/shared/src/widget-blocks/schema.ts` (which is zod, and
 * zod is not a dependency of this package) and `types.ts` beside it. The
 * canonical definition is there; `read-envelope.parity.spec.ts` asserts this
 * reader accepts and refuses exactly what the shared one does, and
 * `check-block-renderer-parity.mjs` fails the build if a block type is added
 * to the schema and not handled here.
 *
 * Why not import: `@livechat/shared` is `private: true` — see the note at the
 * top of `blocks/money.ts`.
 */
import type { Money } from './money';

/** Bumped only on a breaking change to the envelope itself. */
export const BLOCK_PROTOCOL_VERSION = 1;

/**
 * What a button does.
 *
 * `host_event` is the one the native app exists for: it does nothing here and
 * is handed to the app's own `onAction`, which is what runs Stripe, opens a
 * native screen, or adds to a cart with the buyer's real session. See
 * `ChatlyProviderProps.onAction`.
 */
export type WidgetAction =
  | { readonly kind: 'url'; readonly label: string; readonly href: string; readonly style?: string }
  | {
      readonly kind: 'postback';
      readonly label: string;
      readonly value: string;
      readonly payload?: Record<string, unknown>;
      readonly silent?: boolean;
      readonly style?: string;
    }
  | {
      readonly kind: 'host_event';
      readonly label: string;
      readonly event: string;
      readonly data?: Record<string, unknown>;
      readonly id?: string;
      readonly style?: string;
    }
  | {
      readonly kind: 'step';
      readonly label: string;
      readonly canvasId: string;
      readonly params?: Record<string, unknown>;
      readonly style?: string;
    }
  | {
      readonly kind: 'copy';
      readonly label: string;
      readonly text: string;
      readonly style?: string;
    }
  /**
   * Go to a page of the integrator's own site, by path (ADR 0082). Handed to
   * the app's `onNavigate`; with none, opens `config.siteOrigin + path`.
   */
  | {
      readonly kind: 'navigate';
      readonly label: string;
      readonly path: string;
      readonly id?: string;
      readonly style?: string;
    };

/**
 * What a badge MEANS, not what colour it is.
 *
 * "Great price" and "Above typical" are both badges and they say opposite
 * things, which is the one case a single pill cannot express. The four map to
 * the theme's success / warning / danger colours plus the default surface.
 */
export type WidgetCardBadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

/**
 * A badge as the READER hands it over, which is not what the server accepts.
 *
 * The write vocabulary takes three spellings — a bare string (which is what
 * every stored row holds), an object with a `tone`, or an array of up to two
 * of either — and `read-envelope.ts` collapses all three to an array of this,
 * with a bare string becoming `tone: 'neutral'`. That is why the field below
 * is typed as an array and nothing else: a renderer in this package never
 * sees the union, so it cannot get one of its three branches wrong. The
 * shared reader does exactly the same, and `read-envelope.parity.spec.ts`
 * compares the two byte for byte.
 */
export interface WidgetCardBadge {
  readonly text: string;
  readonly tone: WidgetCardBadgeTone;
}

/**
 * A reaction a card offers.
 *
 * An enum rather than free text because the value travels to a bot, which
 * switches on it. A press delivers a SILENT postback under the reserved
 * `card.reaction` key, so pressing one writes no visitor message — which is
 * why `blocksToPlainText` leaves the pair out of a transcript. The toggle is
 * viewer-relative presentation held for the life of the view and
 * deliberately not stored.
 */
export type WidgetCardReaction = 'like' | 'dislike';

/**
 * One purchasable option on a card — a size, a colour, a plan tier.
 *
 * `label` is what the shopper reads and `value` is what a program receives,
 * exactly as on a quick reply. `inStock` is OPTIONAL and tri-state on
 * purpose: absent means the author did not say, which is not the same as
 * `false`, so a renderer greys out a `false` and leaves an absent one alone.
 * The reader normalises anything non-boolean away, because the string
 * `"false"` is truthy and `!inStock` and `inStock === false` would disagree.
 */
export interface WidgetCardVariant {
  readonly label: string;
  readonly value: string;
  readonly inStock?: boolean;
}

/** Whether the thing on the card can be bought right now. Three states, no count. */
export type WidgetCardStock = 'in_stock' | 'low' | 'out_of_stock';

/**
 * The trailing "show me more" tile on a grid.
 *
 * NARROWED to the three action kinds that can page. The other three are a tile
 * that silently shows no more cards: `copy` writes the clipboard,
 * `host_event` goes to the host app, `step` opens a form. The reader drops a
 * tile carrying one of them and keeps the grid.
 */
export interface WidgetGridMore {
  readonly label: string;
  readonly action: Extract<WidgetAction, { readonly kind: 'postback' | 'url' | 'navigate' }>;
}

/**
 * One milestone on an `order_status` timeline.
 *
 * `at` is optional — a `pending` step has not happened — and the reader drops
 * one that `Date.parse` refuses, because a date formatter handed it prints
 * the words "Invalid Date" beside a fulfilment milestone.
 */
export interface WidgetOrderStatusStep {
  readonly label: string;
  readonly at?: string;
  readonly state: 'done' | 'current' | 'pending';
}

/**
 * A 3D model for a world surface. This package draws nothing from it: the
 * reader keeps it (https url only) so an app embedding a world can read it.
 */
export interface WidgetCardModel {
  readonly url: string;
  readonly format?: 'gltf' | 'usdz';
  /** A multiplier on the file's own size, 0.01 to 100. */
  readonly scale?: number;
  readonly anchor?: 'center' | 'base' | 'top' | 'back';
}

export interface WidgetCard {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly image?: string;
  /** Collapsed from three accepted spellings. See `WidgetCardBadge`. */
  readonly badge?: readonly WidgetCardBadge[];
  readonly price?: Money;
  readonly fields?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** Pickable options, rendered as a select by a surface that can pick. */
  readonly variants?: readonly WidgetCardVariant[];
  readonly stock?: WidgetCardStock;
  /** Spatial hint; unread by every 2D surface. */
  readonly model?: WidgetCardModel;
  readonly actions?: readonly WidgetAction[];
  /**
   * A like/dislike pair, filtered to the two members and deduped by the
   * reader — the write schema's `.max(2)` over a two-member enum cannot say
   * "distinct", and two identical thumbs is a duplicate list key.
   */
  readonly reactions?: readonly WidgetCardReaction[];
  /**
   * The reaction the AUTHOR says is currently chosen.
   *
   * `reactions` is what the card offers; this is what it is set to. The bot
   * sets it, which is what makes a visitor's verdict survive a reload — the
   * widget and this SDK never write it.
   *
   * The reader DROPS a value the card does not offer, so a surface can render
   * this without re-checking membership: a chosen thumb with no control
   * behind it is something the shopper cannot un-press.
   */
  readonly reaction?: WidgetCardReaction;
  /**
   * Fired by tapping the card's image or title.
   *
   * `url`, `host_event`, `step` or `navigate` only — the reader drops anything else, so a
   * surface can render this without re-checking the kind. `postback` is
   * excluded on purpose: a silent message sent by tapping a photo is
   * indistinguishable from a mis-tap.
   *
   * The CARD does not become pressable; the image and title become one
   * pressable. Nesting pressables makes a card's buttons unreachable.
   */
  readonly action?: WidgetAction;
}

/**
 * One thing being compared, across the top of a `table`.
 *
 * `label` is REQUIRED by the write schema and the reader coerces an
 * unreadable one to the empty string rather than dropping the column —
 * dropping it shifts every row's cells left and draws a value under the wrong
 * heading, which is a wrong answer rather than a missing one. So a blank
 * label here means "the author sent something we could not read", not "the
 * author left it out".
 */
export interface WidgetTableColumn {
  readonly label: string;
  readonly image?: string;
}

/**
 * One attribute, down the side of a `table`.
 *
 * `cells` may be SHORTER than the table's columns and the trailing ones
 * render blank — an author assembling a comparison from a catalogue will have
 * gaps, and the write boundary deliberately allows it. It is never longer:
 * the envelope refuses that, and the reader truncates it.
 */
export interface WidgetTableRow {
  readonly label: string;
  readonly cells: readonly string[];
}

export type WidgetBlock =
  | { readonly type: 'text'; readonly markdown: string; readonly id?: string }
  | {
      readonly type: 'media';
      readonly kind: 'image' | 'video';
      readonly url: string;
      readonly alt: string;
      readonly id?: string;
    }
  | {
      readonly type: 'fields';
      readonly items: ReadonlyArray<{ readonly label: string; readonly value: string }>;
      readonly id?: string;
    }
  | ({ readonly type: 'card' } & WidgetCard)
  | {
      readonly type: 'card_grid';
      readonly cards: readonly WidgetCard[];
      readonly layout?: 'grid' | 'carousel';
      /**
       * A trailing tile, so a grid at its cap is not a dead end. NOT counted
       * against the 24-card cap, so a full grid can still offer the next page.
       */
      readonly more?: WidgetGridMore;
      /** How a world arranges the cards; a 2D surface draws `layout`. */
      readonly placement?: 'arc' | 'shelf' | 'wall' | 'table';
      readonly id?: string;
    }
  | { readonly type: 'actions'; readonly actions: readonly WidgetAction[]; readonly id?: string }
  | {
      readonly type: 'quick_replies';
      readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
      readonly id?: string;
    }
  | {
      readonly type: 'status';
      readonly id: string;
      readonly text: string;
      readonly state?: 'running' | 'done' | 'failed';
    }
  /**
   * A read-only fulfilment timeline. Display only — there is no money here.
   *
   * The half of a checkout block that a support conversation actually needs:
   * "where is my order" answered in the thread. Nothing in it is a control —
   * no action, no amount, no payment reference — and the write schema is
   * `.strict()`, so a `total` or an `actions` array on it is a 400.
   */
  | {
      readonly type: 'order_status';
      readonly steps: readonly WidgetOrderStatusStep[];
      readonly id?: string;
    }
  /**
   * A comparison table: the things across, their attributes down.
   *
   * Not a `layout` on `fields`, which is one axis. "Which of these three
   * should I buy" needs a heading per thing, each with its own optional
   * image, and a cell per (thing, attribute).
   *
   * The reader drops the block when no column has a readable heading — the
   * headings are what make it a comparison rather than a list — and when no
   * row survives, the `quick_replies` rule.
   */
  | {
      readonly type: 'table';
      readonly columns: readonly WidgetTableColumn[];
      readonly rows: readonly WidgetTableRow[];
      readonly caption?: string;
      readonly id?: string;
    }
  /**
   * A named destination, in words. Never coordinates: a `place` is intent,
   * and each world resolves it in its own scene. `ref` is that world's own id.
   */
  | {
      readonly type: 'place';
      readonly label: string;
      readonly detail?: string;
      readonly ref?: string;
      readonly id?: string;
    }
  | { readonly type: 'divider'; readonly id?: string };

export interface WidgetBlocksEnvelope {
  readonly v: 1;
  readonly blocks: readonly WidgetBlock[];
}

/* ── Canvas (Tier 2) ──────────────────────────────────────────────────── */

export type CanvasField =
  | {
      readonly type: 'text' | 'email' | 'tel' | 'number';
      readonly name: string;
      readonly label: string;
      readonly required?: boolean;
      readonly placeholder?: string;
      readonly value?: string;
    }
  | {
      readonly type: 'select';
      readonly name: string;
      readonly label: string;
      readonly required?: boolean;
      readonly options: ReadonlyArray<{ readonly label: string; readonly value: string }>;
      readonly value?: string;
    }
  | {
      readonly type: 'checkbox';
      readonly name: string;
      readonly label: string;
      readonly required?: boolean;
      readonly value?: boolean;
    };

export interface CanvasAction {
  readonly id: string;
  readonly kind: 'submit' | 'cancel';
  readonly label: string;
  readonly style?: 'primary' | 'secondary' | 'danger';
}

export interface WidgetCanvas {
  readonly v: 1;
  readonly canvasId: string;
  readonly title?: string;
  readonly blocks?: readonly WidgetBlock[];
  readonly fields?: readonly CanvasField[];
  readonly actions?: readonly CanvasAction[];
  readonly state?: string;
  /**
   * Tier 3 — an integrator's own page in a sandboxed frame.
   *
   * Deliberately NOT rendered by this package. A WebView inside a native chat
   * is the thing the spec asked to avoid ("without a WebView"), and a sandbox
   * attribute is a browser concept with no React Native equivalent — so an
   * app frame here would be an iframe's security model re-implemented by
   * hand. The renderer shows the app's `title` and a note instead, and the
   * integrator handles it natively if they want it.
   */
  readonly app?: { readonly url: string; readonly title?: string; readonly height?: number };
}
