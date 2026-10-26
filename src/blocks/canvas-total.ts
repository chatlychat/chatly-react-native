/**
 * The canvas's visibility rule and running total, hand-written.
 *
 * `@livechat/shared` is private and this package is published, so these are
 * copies of `widget-canvas/visibility.ts`, `total.ts` and `limits.ts`.
 * `canvas-total.parity.spec.ts` pins them to the originals across a table of
 * cases (currency mismatch, hidden select, cycles, overflow) — it is the only
 * thing stopping two implementations of one rule from drifting.
 *
 * The total is PRESENTATION: the server never reads it, so a wrong figure here
 * is a wrong label, not a wrong charge. It is still the worst label to get
 * wrong, hence `null` ("show no total") whenever it cannot be stated honestly.
 */
import type { Money } from './money';

/** `limits.ts` MAX_CANVAS_MINOR_AMOUNT: keeps the sum an exact integer. */
export const MAX_CANVAS_MINOR_AMOUNT = 10_000_000_000;

export interface CanvasMoney {
  readonly amount: number;
  readonly currency: string;
}

export interface VisibleWhen {
  readonly input: string;
  readonly equals: string | boolean;
}

export interface VisibilityInput {
  readonly id: string;
  readonly type: string;
  readonly visibleWhen?: VisibleWhen | undefined;
  readonly options?: readonly { readonly value: string; readonly adds?: CanvasMoney | undefined }[];
}

/** The ids of the inputs shown for these `values`. A malformed reference fails HIDDEN. */
export function visibleInputIds(
  inputs: readonly VisibilityInput[],
  values: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  const byId = new Map<string, VisibilityInput>();
  for (const input of inputs) {
    if (!byId.has(input.id)) {
      byId.set(input.id, input);
    }
  }
  const memo = new Map<string, boolean>();

  const resolve = (id: string, path: ReadonlySet<string>): boolean => {
    const known = memo.get(id);
    if (known !== undefined) {
      return known;
    }
    const input = byId.get(id);
    if (input === undefined || path.has(id)) {
      return false;
    }
    let shown = true;
    const rule = input.visibleWhen;
    if (rule !== undefined) {
      const source = byId.get(rule.input);
      if (source === undefined || (source.type !== 'toggle' && source.type !== 'select')) {
        shown = false;
      } else if (!resolve(source.id, new Set(path).add(id))) {
        shown = false;
      } else {
        const current = values[source.id];
        shown =
          source.type === 'toggle'
            ? typeof rule.equals === 'boolean' && (current === true) === rule.equals
            : typeof rule.equals === 'string' && current === rule.equals;
      }
    }
    // A verdict reached mid-cycle is only "hidden" because of where the walk began.
    if (path.size === 0) {
      memo.set(id, shown);
    }
    return shown;
  };

  const out = new Set<string>();
  for (const input of inputs) {
    if (resolve(input.id, new Set())) {
      out.add(input.id);
    }
  }
  return out;
}

/** Base price plus the `adds` of each VISIBLE selected option; `null` if not honest. */
export function computeCanvasTotal(
  canvas: {
    readonly price?: CanvasMoney | undefined;
    readonly inputs?: readonly VisibilityInput[];
  },
  values: Readonly<Record<string, unknown>>,
): CanvasMoney | null {
  const price = canvas.price;
  if (price === undefined) {
    return null;
  }
  const inputs = canvas.inputs ?? [];
  const visible = visibleInputIds(inputs, values);
  let amount = price.amount;
  for (const input of inputs) {
    if (input.type !== 'select' || !visible.has(input.id)) {
      continue;
    }
    const chosen = input.options?.find((o) => o.value === values[input.id]);
    if (chosen?.adds === undefined) {
      continue;
    }
    if (chosen.adds.currency !== price.currency) {
      return null;
    }
    amount += chosen.adds.amount;
  }
  return Number.isSafeInteger(amount) ? { amount, currency: price.currency } : null;
}

/** A canvas money (integer minor units, 0..cap, upper-case ISO code) or null. */
export function readCanvasMoney(raw: unknown): Money | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const { amount, currency } = raw as Record<string, unknown>;
  return typeof amount === 'number' &&
    Number.isInteger(amount) &&
    amount >= 0 &&
    amount <= MAX_CANVAS_MINOR_AMOUNT &&
    typeof currency === 'string' &&
    /^[A-Z]{3}$/.test(currency)
    ? { amount, currency }
    : null;
}
