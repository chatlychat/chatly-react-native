/**
 * Read a stored Tier 2 canvas.
 *
 * Looser than the block reader on one point and stricter on another. Looser:
 * a canvas with no inputs and no actions still renders, because a step can be
 * a read-only confirmation. Stricter: `canvasId` is required, because it is
 * what a submission is posted against — a canvas without one is a form with
 * nowhere to go, which is worse than no form.
 *
 * The server stores `inputs[]` keyed by `id`. The previous releases of this
 * SDK read `fields[]` keyed by `name` with a `checkbox` type, which the server
 * never wrote; that shape is still accepted and normalised to the real one.
 *
 * `price` is all-or-nothing: if the base price or ANY option's `adds` is not a
 * valid money, the step shows no total at all, because a total that silently
 * skipped one option would be a wrong number on a buy button.
 */
import { readCanvasMoney } from './canvas-total';
import { readBlock } from './read-envelope';
import { BLOCK_PROTOCOL_VERSION } from './types';

import type { CanvasField, CanvasVisibleWhen, WidgetBlock, WidgetCanvas } from './types';

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const TEXTY = new Set(['text', 'textarea', 'email', 'tel', 'number']);

function readVisibleWhen(raw: unknown): CanvasVisibleWhen | undefined {
  return isBag(raw) &&
    str(raw['input']) &&
    (typeof raw['equals'] === 'string' || typeof raw['equals'] === 'boolean')
    ? { input: raw['input'], equals: raw['equals'] }
    : undefined;
}

/** `moneyOk` goes false when an option's `adds` is present and unusable. */
function readInput(raw: unknown, moneyOk: { ok: boolean }): CanvasField | null {
  if (!isBag(raw)) {
    return null;
  }
  const id = raw['id'] ?? raw['name']; // `name`: the pre-0.10 shape
  const type = raw['type'] === 'checkbox' ? 'toggle' : raw['type'];
  if (!str(id) || !str(raw['label']) || !str(type)) {
    return null;
  }
  const base = {
    id,
    label: raw['label'],
    ...(readVisibleWhen(raw['visibleWhen']) !== undefined
      ? { visibleWhen: readVisibleWhen(raw['visibleWhen']) }
      : {}),
  };
  if (type === 'toggle') {
    return {
      ...base,
      type,
      ...(typeof raw['value'] === 'boolean' ? { value: raw['value'] } : {}),
    } as CanvasField;
  }
  if (type === 'select') {
    if (!Array.isArray(raw['options'])) {
      return null;
    }
    const options = raw['options']
      .filter((o): o is Bag => isBag(o) && str(o['value']) && str(o['label']))
      .map((o) => {
        const adds = o['adds'] === undefined ? null : readCanvasMoney(o['adds']);
        if (o['adds'] !== undefined && adds === null) {
          moneyOk.ok = false;
        }
        return {
          label: o['label'] as string,
          value: o['value'] as string,
          ...(adds === null ? {} : { adds: adds }),
        };
      });
    return {
      ...base,
      type,
      options,
      ...(raw['required'] === true ? { required: true } : {}),
      ...(typeof raw['value'] === 'string' ? { value: raw['value'] } : {}),
    } as CanvasField;
  }
  if (!TEXTY.has(type)) {
    return null;
  }
  const value = typeof raw['value'] === 'number' ? String(raw['value']) : raw['value'];
  return {
    ...base,
    type,
    ...(raw['required'] === true ? { required: true } : {}),
    ...(typeof raw['placeholder'] === 'string' ? { placeholder: raw['placeholder'] } : {}),
    ...(typeof value === 'string' ? { value } : {}),
  } as CanvasField;
}

export function readCanvas(raw: unknown): WidgetCanvas | null {
  if (!isBag(raw) || raw['v'] !== BLOCK_PROTOCOL_VERSION || !str(raw['canvasId'])) {
    return null;
  }
  const moneyOk = { ok: true };
  const source = Array.isArray(raw['inputs'])
    ? raw['inputs']
    : Array.isArray(raw['fields'])
      ? raw['fields']
      : [];
  const inputs = source
    .map((i) => readInput(i, moneyOk))
    .filter((i): i is CanvasField => i !== null);
  const actions = Array.isArray(raw['actions'])
    ? raw['actions']
        .filter(
          (a): a is Bag =>
            isBag(a) &&
            str(a['id']) &&
            str(a['label']) &&
            (a['kind'] === 'submit' || a['kind'] === 'cancel'),
        )
        .map(({ showTotal, ...a }) => (showTotal === true ? { ...a, showTotal } : a))
    : [];
  const blocks = Array.isArray(raw['blocks'])
    ? raw['blocks'].map(readBlock).filter((b): b is WidgetBlock => b !== null)
    : [];
  const { fields: _legacy, price: rawPrice, ...rest } = raw;
  void _legacy;
  const price = rawPrice === undefined || !moneyOk.ok ? null : readCanvasMoney(rawPrice);
  return {
    ...rest,
    inputs,
    actions,
    blocks,
    ...(price === null ? {} : { price }),
  } as unknown as WidgetCanvas;
}
