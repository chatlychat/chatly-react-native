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

import type { WidgetAction, WidgetBlock, WidgetBlocksEnvelope } from './types';

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

/**
 * A url action's href: `https:`, `mailto:` or `tel:` — exactly the shared
 * schema's set (`isSafeActionHref` in @livechat/shared), nothing wider.
 *
 * `Linking.openURL` launches any scheme the OS has a handler for, so the rule
 * is an ALLOW-LIST of three, not a deny-list: `intent:`, `sms:`, `itms-apps:`
 * and an app's own scheme are all refused. The three admitted open the
 * system browser, a draft e-mail and the dialer with the number filled in;
 * none acts without the visitor confirming (iOS asks before `tel:`, Android
 * opens the dialer and never places the call).
 */
export function isSafeActionHref(href: string): boolean {
  if (href.length === 0 || href.length > 2000) {
    return false;
  }
  // eslint-disable-next-line no-control-regex -- matching control characters IS the check
  if (/[\u0000-\u001F\u007F]/.test(href) || href !== href.trim()) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
  );
}

function readAction(raw: unknown): WidgetAction | null {
  if (!isBag(raw) || !str(raw['label'])) {
    return null;
  }
  switch (raw['kind']) {
    case 'url':
      // Opened with `Linking.openURL`: the schema's three schemes only.
      return str(raw['href']) && isSafeActionHref(raw['href'])
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
    case 'navigate':
      return str(raw['path']) ? (raw as unknown as WidgetAction) : null;
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

/** The three `card.stock` states, so an unrecognised one never reaches a style. */
const STOCK_STATES = new Set(['in_stock', 'low', 'out_of_stock']);

/** The three `order_status` step states. An unrecognised one is coerced, not dropped. */
const STEP_STATES = new Set(['done', 'current', 'pending']);

/**
 * Badges, collapsed to ONE shape: always an array of `{ text, tone }`.
 *
 * `card.badge` accepts three spellings — a bare string (every stored row and
 * every integrator today), an object with a `tone`, or an array of up to two
 * of either. A renderer that branched on all three would be three branches,
 * two of which nobody exercises; worse, four renderers across this repo would
 * each have their own three. So the reader collapses it and `types.ts`
 * declares only the collapsed form.
 *
 * A bare string becomes `tone: 'neutral'`. `tone` is COERCED and never
 * dropped — the `order_status[].state` rule: it reaches a style, so it cannot
 * pass through unrecognised, and dropping the badge over an unknown tone
 * would delete the words "Final sale" to protect the colour of a pill. It is
 * always PRESENT for the mirror-image reason: an absent tone leaves each
 * renderer picking its own default.
 *
 * Mirrors `readCardBadges` in the shared reader, which is exported there
 * because `plain-text.ts` collapses badges the same way for `messages.body`.
 */
function readCardBadges(raw: unknown): Bag[] {
  const out: Bag[] = [];
  for (const entry of Array.isArray(raw) ? raw : [raw]) {
    const badge: Bag = str(entry) ? { text: entry } : isBag(entry) ? { ...entry } : {};
    if (!str(badge['text'])) {
      continue;
    }
    const tone = badge['tone'];
    if (tone !== 'success' && tone !== 'warning' && tone !== 'danger') {
      badge['tone'] = 'neutral';
    }
    out.push(badge);
  }
  return out;
}

/**
 * A comparison table: the things across, their attributes down.
 *
 * ── Why a bad COLUMN is coerced and a bad ROW is dropped ─────────────
 *
 * Not the same mistake. A row is identified by its own label, so a row
 * without one is a line of values nobody can interpret and it goes, the way a
 * half-formed variant goes. A COLUMN is identified by its POSITION: drop
 * column 1 and every row's cells shift left, so "USD 120.00" is drawn under
 * the wrong product — a wrong answer rather than a missing one. So an
 * unreadable heading is coerced to an empty one and keeps its place.
 *
 * A table with no readable heading at all is dropped: the headings make it a
 * comparison rather than a list. Cells are coerced to strings for the same
 * positional reason, a LONGER row is truncated (the envelope refuses one
 * outright, and a seventh cell under no heading is a column the reader
 * invented), and a SHORT row is deliberately fine and renders blanks.
 *
 * `columns[].image` goes through the same https-only guard as `card.image`
 * and drops the IMAGE rather than the column.
 */
function readTable(raw: Bag): Bag | null {
  const columns: Bag[] = [];
  for (const entry of Array.isArray(raw['columns']) ? raw['columns'] : []) {
    const column: Bag = isBag(entry) ? { ...entry } : {};
    if (!str(column['label'])) {
      column['label'] = '';
    }
    if (
      column['image'] !== undefined &&
      !(str(column['image']) && isSafeMediaSrc(column['image']))
    ) {
      delete column['image'];
    }
    columns.push(column);
  }
  if (!columns.some((column) => column['label'] !== '')) {
    return null;
  }
  const rows: Bag[] = [];
  for (const entry of Array.isArray(raw['rows']) ? raw['rows'] : []) {
    if (!isBag(entry) || !str(entry['label'])) {
      continue;
    }
    const cells = (Array.isArray(entry['cells']) ? entry['cells'] : [])
      .slice(0, columns.length)
      .map((cell) => (typeof cell === 'string' ? cell : ''));
    rows.push({ ...entry, cells });
  }
  // No readable row is no comparison: a heading row over a blank space.
  return rows.length > 0 ? { ...raw, columns, rows } : null;
}

/**
 * Variants, keeping unknown keys and normalising the one a renderer branches on.
 *
 * A variant needs both halves for the same reason a quick reply does: `label`
 * is what the shopper reads and `value` is what gets sent, and an option
 * missing either is unreadable or unanswerable. One bad option loses that
 * option, not the card.
 *
 * `inStock` is forced to absent-or-boolean. A renderer greys out `false` and
 * leaves absent alone, and the string `"false"` passed through would be
 * neither — truthy to `!variant.inStock` and not equal to `false`, so two
 * renderers written the two obvious ways would disagree about whether the
 * option can be bought.
 */
function readVariants(raw: unknown): Bag[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Bag[] = [];
  for (const entry of raw) {
    if (!isBag(entry) || !str(entry['label']) || !str(entry['value'])) {
      continue;
    }
    const variant: Bag = { ...entry };
    if (typeof variant['inStock'] !== 'boolean') {
      delete variant['inStock'];
    }
    out.push(variant);
  }
  return out;
}

/**
 * A grid's trailing "more" tile, or null.
 *
 * Narrowed to the three action kinds that can page, matching the write schema:
 * a `copy`, `host_event` or `step` tile would render as a button that shows
 * no more cards. Dropping the tile keeps the grid — twenty-four cards are the
 * substance and a missing affordance for the twenty-fifth is not worth losing
 * them.
 *
 * Note that `readAction` here is the native one, so a `url` tile pointing at
 * anything but `https:` is refused where the shared reader admits it — the
 * one documented difference between the two readers, for the reason
 * `read-envelope.parity.spec.ts` states about `Linking.openURL`.
 */
function readGridMore(raw: unknown): Bag | null {
  if (!isBag(raw) || !str(raw['label'])) {
    return null;
  }
  const action = readAction(raw['action']);
  if (
    action === null ||
    (action.kind !== 'postback' && action.kind !== 'url' && action.kind !== 'navigate')
  ) {
    return null;
  }
  return { ...raw, action };
}

/**
 * Timeline steps, with the state COERCED rather than the step dropped.
 *
 * `state` reaches a style, so it cannot pass through unrecognised — the
 * `layout` rule. But the two ways of enforcing that are not equally safe
 * here. Dropping a step whose state a later release invented (`failed`, say)
 * removes a ROW from a timeline, and a timeline missing a row reads as an
 * order that skipped a stage: the words "Payment failed" vanish and the
 * shopper is told nothing. Coercing to `pending` keeps the label and the
 * timestamp, which is what a person actually reads, and costs only the shape
 * of a dot.
 *
 * `at` is dropped unless it parses. A string a date formatter cannot read
 * renders as the words "Invalid Date" next to a fulfilment milestone, which
 * is worse than no date at all — and `at` is optional precisely because a
 * pending step has none.
 */
function readTimelineSteps(raw: unknown): Bag[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Bag[] = [];
  for (const entry of raw) {
    if (!isBag(entry) || !str(entry['label'])) {
      continue;
    }
    const step: Bag = { ...entry };
    if (!str(step['state']) || !STEP_STATES.has(step['state'])) {
      step['state'] = 'pending';
    }
    if (step['at'] !== undefined && !(str(step['at']) && !Number.isNaN(Date.parse(step['at'])))) {
      delete step['at'];
    }
    out.push(step);
  }
  return out;
}

const PLACEMENTS = new Set(['arc', 'shelf', 'wall', 'table']);
const ANCHORS = new Set(['center', 'base', 'top', 'back']);
const MODEL_FORMATS = new Set(['gltf', 'usdz']);

/**
 * `card.model`: dropped when its url is not `https:`-and-clean, otherwise kept
 * with each malformed optional field removed. Mirrors `read-spatial.ts` in
 * `@livechat/shared`; `read-envelope.spatial.parity.spec.ts` compares them.
 */
function readModel(raw: unknown): Bag | null {
  if (!isBag(raw) || !str(raw['url']) || !isSafeMediaSrc(raw['url'])) {
    return null;
  }
  const model: Bag = { ...raw };
  const { scale, anchor, format } = model;
  if (typeof scale !== 'number' || !(scale >= 0.01 && scale <= 100)) {
    delete model['scale'];
  }
  if (!ANCHORS.has(anchor as string)) {
    delete model['anchor'];
  }
  if (!MODEL_FORMATS.has(format as string)) {
    delete model['format'];
  }
  return model;
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
  /*
   * The badge, COLLAPSED rather than passed through — see `readCardBadges`.
   * In the same position in this function as in the shared reader, because
   * `read-envelope.parity.spec.ts` compares the two with `JSON.stringify` and
   * a key written in a different order is a different string.
   */
  if (card['badge'] !== undefined) {
    const badges = readCardBadges(card['badge']);
    if (badges.length === 0) {
      delete card['badge'];
    } else {
      card['badge'] = badges;
    }
  }
  /*
   * The reaction pair, narrowed to the two members and DEDUPED.
   *
   * `['like','like']` is accepted by the write schema — an enum of two with
   * `.max(2)` cannot say "distinct" — and draws two identical thumbs, or a
   * duplicate key in a list. An unrecognised member is DROPPED rather than
   * coerced: it reaches a glyph and the payload of a postback a bot switches
   * on, and there is no label inside it worth keeping.
   */
  if (card['reactions'] !== undefined) {
    const reactions = Array.isArray(card['reactions'])
      ? card['reactions'].filter(
          (r, i, all) => (r === 'like' || r === 'dislike') && all.indexOf(r) === i,
        )
      : [];
    if (reactions.length === 0) {
      delete card['reactions'];
    } else {
      card['reactions'] = reactions;
    }
  }
  /*
   * `reaction` is only meaningful if the card OFFERS it. Read AFTER the
   * filter above, so a chosen value naming a member that filter just dropped
   * goes with it. Byte-identical rule to the server reader, and the parity
   * spec is what holds the two together.
   */
  /*
   * `action` — the card's tap target. Narrowed to the four kinds the schema
   * allows, and DROPPED otherwise: a stored card predating the field could
   * carry anything, and this value wraps the whole image. Byte-identical rule
   * to the server reader; the parity spec holds the two together.
   */
  if (card['action'] !== undefined) {
    const a = card['action'];
    const usable =
      isBag(a) &&
      str(a['label']) &&
      ((a['kind'] === 'url' && str(a['href'])) ||
        (a['kind'] === 'host_event' && str(a['event'])) ||
        (a['kind'] === 'step' && str(a['canvasId'])) ||
        (a['kind'] === 'navigate' && str(a['path'])));
    if (!usable) {
      delete card['action'];
    }
  }
  if (card['reaction'] !== undefined) {
    const offered = card['reactions'];
    const chosen = card['reaction'];
    const usable =
      Array.isArray(offered) &&
      (chosen === 'like' || chosen === 'dislike') &&
      offered.includes(chosen);
    if (!usable) {
      delete card['reaction'];
    }
  }
  /*
   * `variants` and `stock` are touched ONLY when present.
   *
   * Not a style choice: this function sets `actions` and `fields`
   * unconditionally, so every card it returns carries two empty arrays, and
   * `read-envelope.parity.spec.ts` compares this reader's output with the
   * shared one's using `toEqual`. A third unconditional key would make every
   * existing parity case fail on a card that has no variants at all — which
   * is why the shared reader is written the same way.
   */
  if (card['variants'] !== undefined) {
    const variants = readVariants(card['variants']);
    if (variants.length === 0) {
      delete card['variants'];
    } else {
      card['variants'] = variants;
    }
  }
  // An unrecognised stock state reaches a style and a badge, so it is dropped
  // rather than passed through — the `layout` rule.
  if (card['stock'] !== undefined && !(str(card['stock']) && STOCK_STATES.has(card['stock']))) {
    delete card['stock'];
  }
  if (card['model'] !== undefined) {
    const model = readModel(card['model']);
    if (model === null) {
      delete card['model'];
    } else {
      card['model'] = model;
    }
  }
  return card;
}

export function readBlock(raw: unknown): WidgetBlock | null {
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
      if (grid['layout'] !== 'grid' && grid['layout'] !== 'carousel' && grid['layout'] !== 'auto') {
        delete grid['layout'];
      }
      // As with `variants` above: only touched when present, so a grid
      // without a `more` tile reads identically to how it did before the
      // field existed.
      if (grid['more'] !== undefined) {
        const more = readGridMore(grid['more']);
        if (more === null) {
          delete grid['more'];
        } else {
          grid['more'] = more;
        }
      }
      if (grid['placement'] !== undefined && !PLACEMENTS.has(grid['placement'] as string)) {
        delete grid['placement'];
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
    case 'order_status': {
      const steps = readTimelineSteps(raw['steps']);
      // No readable step is no timeline: a bordered blank space where the
      // answer to "where is my order" belongs. Same rule as `quick_replies`.
      return steps.length > 0 ? ({ ...raw, steps } as unknown as WidgetBlock) : null;
    }
    case 'table': {
      const table = readTable(raw);
      return table === null ? null : (table as unknown as WidgetBlock);
    }
    case 'place': {
      if (!str(raw['label'])) {
        return null;
      }
      const place: Bag = { ...raw };
      for (const key of ['detail', 'ref']) {
        if (place[key] !== undefined && !str(place[key])) {
          delete place[key];
        }
      }
      return place as unknown as WidgetBlock;
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
