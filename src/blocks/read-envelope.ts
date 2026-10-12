/**
 * Read a stored block envelope, refusing what cannot be drawn.
 *
 * Mirrors `packages/shared/src/widget-blocks/read-envelope.ts` exactly, and
 * `read-envelope.parity.spec.ts` asserts that over a table of accepted and
 * refused shapes. See `blocks/money.ts` for why this package restates rather
 * than imports.
 *
 * ── The contract, which is the same on every renderer ──────────────────
 *
 * Never throw, never render a hole. A row written before a field was
 * validated — or by a future server this client does not know about — must
 * produce the most of the message that CAN be drawn, not an exception and not
 * a blank space. So:
 *
 *   an unreadable BLOCK is dropped, the rest of the message renders;
 *   an unsafe card image drops the IMAGE, not the card;
 *   an unreadable price drops the PRICE, because `formatMoney` handed a
 *     string renders `NaN` at a shopper;
 *   an unknown `type` is expected rather than exceptional — an old app meets
 *     a newer server — and is dropped silently.
 *
 * ── The media guard ────────────────────────────────────────────────────
 *
 * `https:` only, no control characters, no untrimmed string, length capped.
 * React Native's `Image` will happily fetch `http:` and `data:`, and a card
 * is authored by whoever holds an API key — so the same refusal the widget
 * applies in a browser applies here. There is no `javascript:` hazard in an
 * `Image` source, but `http:` on a phone is a downgrade a shopper cannot see
 * and `file:` is the device's own disk.
 */
import { readMoney } from './money';
import { BLOCK_PROTOCOL_VERSION } from './types';

import type { WidgetAction, WidgetBlock, WidgetBlocksEnvelope, WidgetCanvas } from './types';

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** `https:` and nothing else. Mirrors `isSafeMediaSrc` in the shared guard. */
export function isSafeMediaSrc(src: string): boolean {
  if (src.length === 0 || src.length > 2000) {
    return false;
  }
  // eslint-disable-next-line no-control-regex -- matching control characters IS the check
  if (/[\u0000-\u001F\u007F]/.test(src) || src !== src.trim()) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:';
}

function readAction(raw: unknown): WidgetAction | null {
  if (!isBag(raw) || !str(raw['label'])) {
    return null;
  }
  switch (raw['kind']) {
    case 'url':
      // An `href` is opened with `Linking.openURL`, which will launch any
      // scheme the OS has a handler for — so the same https-only rule.
      return str(raw['href']) && isSafeMediaSrc(raw['href'])
        ? (raw as unknown as WidgetAction)
        : null;
    case 'postback':
      return str(raw['value']) ? (raw as unknown as WidgetAction) : null;
    case 'host_event':
      return str(raw['event']) ? (raw as unknown as WidgetAction) : null;
    case 'step':
      return str(raw['canvasId']) ? (raw as unknown as WidgetAction) : null;
    case 'copy':
      return str(raw['text']) ? (raw as unknown as WidgetAction) : null;
    default:
      return null;
  }
}

function readActions(raw: unknown): WidgetAction[] {
  return Array.isArray(raw) ? raw.map(readAction).filter((a): a is WidgetAction => a !== null) : [];
}

function readPairs(raw: unknown): Array<{ label: string; value: string }> {
  return Array.isArray(raw)
    ? raw.filter(
        (f): f is { label: string; value: string } =>
          isBag(f) && str(f['label']) && str(f['value']),
      )
    : [];
}

function readCard(raw: unknown): Bag | null {
  if (!isBag(raw) || !str(raw['title'])) {
    return null;
  }
  const card: Bag = {
    ...raw,
    actions: readActions(raw['actions']),
    fields: readPairs(raw['fields']),
  };
  if (card['image'] !== undefined && !(str(card['image']) && isSafeMediaSrc(card['image']))) {
    delete card['image'];
  }
  if (card['price'] !== undefined) {
    const price = readMoney(card['price']);
    if (price === null) {
      delete card['price'];
    } else {
      card['price'] = price;
    }
  }
  return card;
}

function readBlock(raw: unknown): WidgetBlock | null {
  if (!isBag(raw)) {
    return null;
  }
  switch (raw['type']) {
    case 'text':
      return str(raw['markdown']) ? (raw as unknown as WidgetBlock) : null;
    case 'media':
      // Unlike a card's image, a media block IS its image: nothing is left to
      // render once the src is refused, so the block goes.
      return str(raw['url']) &&
        isSafeMediaSrc(raw['url']) &&
        str(raw['alt']) &&
        (raw['kind'] === 'image' || raw['kind'] === 'video')
        ? (raw as unknown as WidgetBlock)
        : null;
    case 'fields': {
      const items = readPairs(raw['items']);
      return items.length > 0 ? ({ ...raw, items } as unknown as WidgetBlock) : null;
    }
    case 'card': {
      const card = readCard(raw);
      return card === null ? null : (card as unknown as WidgetBlock);
    }
    case 'card_grid': {
      const cards = Array.isArray(raw['cards'])
        ? raw['cards'].map(readCard).filter((c): c is Bag => c !== null)
        : [];
      if (cards.length === 0) {
        return null;
      }
      const grid: Bag = { ...raw, cards };
      if (grid['layout'] !== 'grid' && grid['layout'] !== 'carousel') {
        delete grid['layout'];
      }
      return grid as unknown as WidgetBlock;
    }
    case 'actions': {
      const actions = readActions(raw['actions']);
      return actions.length > 0 ? ({ ...raw, actions } as unknown as WidgetBlock) : null;
    }
    case 'quick_replies': {
      const options = readPairs(raw['options']);
      return options.length > 0 ? ({ ...raw, options } as unknown as WidgetBlock) : null;
    }
    case 'status':
      // `id` is required: a status block exists to be patched.
      return str(raw['id']) && str(raw['text']) ? (raw as unknown as WidgetBlock) : null;
    case 'divider':
      return raw as unknown as WidgetBlock;
    default:
      return null;
  }
}

export function readBlocksEnvelope(raw: unknown): WidgetBlocksEnvelope | null {
  if (!isBag(raw) || raw['v'] !== BLOCK_PROTOCOL_VERSION || !Array.isArray(raw['blocks'])) {
    return null;
  }
  const blocks = raw['blocks'].map(readBlock).filter((b): b is WidgetBlock => b !== null);
  return blocks.length > 0 ? { v: BLOCK_PROTOCOL_VERSION, blocks } : null;
}

/**
 * Read a stored canvas.
 *
 * Looser than the block reader on one point and stricter on another. Looser:
 * a canvas with no fields and no actions still renders, because a step can be
 * a read-only confirmation. Stricter: `canvasId` is required, because it is
 * what a submission is posted against — a canvas without one is a form with
 * nowhere to go, which is worse than no form.
 */
export function readCanvas(raw: unknown): WidgetCanvas | null {
  if (!isBag(raw) || raw['v'] !== BLOCK_PROTOCOL_VERSION || !str(raw['canvasId'])) {
    return null;
  }
  const fields = Array.isArray(raw['fields'])
    ? raw['fields'].filter((f) => isBag(f) && str(f['name']) && str(f['label']) && str(f['type']))
    : [];
  const actions = Array.isArray(raw['actions'])
    ? raw['actions'].filter(
        (a) =>
          isBag(a) &&
          str(a['id']) &&
          str(a['label']) &&
          (a['kind'] === 'submit' || a['kind'] === 'cancel'),
      )
    : [];
  const blocks = Array.isArray(raw['blocks'])
    ? raw['blocks'].map(readBlock).filter((b): b is WidgetBlock => b !== null)
    : [];
  return { ...(raw as object), fields, actions, blocks } as unknown as WidgetCanvas;
}
