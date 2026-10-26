/**
 * `navigate` in the React Native client (ADR 0082): the path guard and the
 * URL join, restated here for the reason `money.ts` gives — this published
 * package takes no workspace-internal dependency. `navigate.spec.ts` holds it
 * to the shared `isSafeNavigatePath` over the same table.
 */

/** A single leading `/`, no `//`, no backslash, no control character or space, no `.`/`..` segment, no encoded dot/slash, at most 512 chars. */
export function isSafeNavigatePath(path: string): boolean {
  if (path.length < 1 || path.length > 512 || path[0] !== '/') {
    return false;
  }
  // eslint-disable-next-line no-control-regex -- matching control characters IS the check
  if (/[\u0000- \u007F\\]/.test(path) || path.includes('//')) {
    return false;
  }
  if (/%(?:2e|2f|5c|00)/i.test(path)) {
    return false;
  }
  const pathOnly = path.split(/[?#]/)[0] ?? path;
  if (pathOnly.split('/').some((seg) => seg === '.' || seg === '..')) {
    return false;
  }
  return !/^\/[^/?#]*[:@]/.test(path);
}

/** `origin + path` when the app declared an https origin, else null. */
export function navigateTarget(siteOrigin: string | undefined, path: string): string | null {
  if (siteOrigin === undefined || !isSafeNavigatePath(path)) {
    return null;
  }
  try {
    const u = new URL(siteOrigin);
    return u.protocol === 'https:' ? u.origin + path : null;
  } catch {
    return null;
  }
}
