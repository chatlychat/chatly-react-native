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

export interface WidgetCard {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly image?: string;
  readonly badge?: string;
  readonly price?: Money;
  readonly fields?: ReadonlyArray<{ readonly label: string; readonly value: string }>;
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
