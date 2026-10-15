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
    };

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
 * NARROWED to the two action kinds that can page. The other three are a tile
 * that silently shows no more cards: `copy` writes the clipboard,
 * `host_event` goes to the host app, `step` opens a form. The reader drops a
 * tile carrying one of them and keeps the grid.
 */
export interface WidgetGridMore {
  readonly label: string;
  readonly action: Extract<WidgetAction, { readonly kind: 'postback' | 'url' }>;
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

export interface WidgetCard {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly image?: string;
  readonly badge?: string;
  readonly price?: Money;
  readonly fields?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  /** Pickable options, rendered as a select by a surface that can pick. */
  readonly variants?: readonly WidgetCardVariant[];
  readonly stock?: WidgetCardStock;
  readonly actions?: readonly WidgetAction[];
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
