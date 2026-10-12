/**
 * Money on a card, restated for the published package.
 *
 * ── Why this is a copy and not an import ───────────────────────────────
 *
 * The canonical implementation is `packages/shared/src/widget-blocks/money.ts`
 * and this file is deliberately identical in behaviour. `@livechat/shared` is
 * `private: true` — it is the monorepo's internal package with a hundred
 * export paths — so a published npm package cannot depend on it. The same
 * reason `client/types.ts` restates the realtime types rather than importing
 * them.
 *
 * A copy is a drift risk, so it is pinned rather than trusted:
 * `money.parity.spec.ts` imports BOTH this and the shared original and
 * asserts they agree over a currency table that includes the cases a
 * hand-rolled version gets wrong. `check-block-field-parity.mjs` knows about
 * the second `Intl.NumberFormat` by name, with that spec as the reason.
 *
 * ── Minor units, never a float ─────────────────────────────────────────
 *
 * `amount` is an integer count of the currency's smallest unit: 4820 is
 * $48.20, 4820 is also ¥4,820, and 4820 is 4.820 KWD.
 *
 * The DIVISOR IS NOT 100. Three currencies have no minor unit (JPY, KRW, VND)
 * and four have three digits (KWD, BHD, JOD, OMR), so `(amount / 100)`
 * renders ¥4,820 as "¥48" and 4.820 KWD as "48.200 KWD" — wrong by two orders
 * of magnitude in opposite directions, and perfect in USD, which is why it
 * would ship. The digit count is read off the formatter, so a currency added
 * to CLDR after this was written is right with no table here.
 *
 * React Native ships a full ICU on iOS and, since 0.73 with Hermes
 * `intl` enabled, on Android too. The `catch` below is what covers an engine
 * without it: a card with an unrecognised currency still shows a price rather
 * than taking the thread's render down.
 */

/** A price on a card. `amount` and `compareAt` are both MINOR units. */
export interface Money {
  readonly amount: number;
  /** ISO 4217, upper case. */
  readonly currency: string;
  /** The was-price. Rendered only when above `amount`. */
  readonly compareAt?: number;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

const isMinor = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Read a price off a stored card, or null. Refuses what cannot be drawn. */
export function readMoney(raw: unknown): Money | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const bag = raw as Record<string, unknown>;
  const currency = bag['currency'];
  if (!isMinor(bag['amount']) || typeof currency !== 'string' || !CURRENCY_RE.test(currency)) {
    return null;
  }
  const compareAt = bag['compareAt'];
  return {
    amount: bag['amount'],
    currency,
    ...(isMinor(compareAt) ? { compareAt } : {}),
  };
}

function minorPerMajor(formatter: Intl.NumberFormat): number {
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return 10 ** (typeof digits === 'number' ? digits : 2);
}

/** The locale-free rendition, used as the fallback and for accessibility text. */
export function moneyToPlainText(money: Money): string {
  return `${money.currency} ${(money.amount / 100).toFixed(2)}`;
}

/**
 * Format one amount in the DEVICE's locale.
 *
 * `locale` undefined means "whatever this device is set to", which is the
 * right default: the app runs on the shopper's phone and a German shopper
 * reads `48,20 $`.
 */
export function formatMoney(money: Money, locale?: string): string {
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: money.currency,
    });
    return formatter.format(money.amount / minorPerMajor(formatter));
  } catch {
    return moneyToPlainText(money);
  }
}
