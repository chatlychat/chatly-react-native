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

/**
 * A `url` action's own-site path, or null when it belongs elsewhere.
 *
 * Crossly's round 2: `onNavigate` routes a `navigate` action, but a plain
 * `url` whose href is on the app's OWN `siteOrigin` still went to
 * `onOpenUrl` or the system browser — so an older card, an agent who typed a
 * full link, or a help article bounced the buyer out of the app and the host
 * had to strip the origin itself. The web widget already treats that case as
 * `target: "self"`.
 *
 * The same `isSafeNavigatePath` guard applies, so this cannot turn a hostile
 * href into a path the router would follow: `https://site/..%2fadmin` fails
 * it exactly as a `navigate` action would. Origin comparison is on the parsed
 * `URL.origin` rather than a string prefix, because `https://site.example.evil`
 * starts with `https://site.example` and a prefix test would hand it over.
 */
export function ownSitePath(siteOrigin: string | undefined, href: string): string | null {
  if (siteOrigin === undefined) {
    return null;
  }
  let origin: string;
  try {
    const declared = new URL(siteOrigin);
    // https only, matching `navigateTarget` — an http origin is not one we
    // will route to, so it is not one we will route FROM either.
    if (declared.protocol !== 'https:') {
      return null;
    }
    origin = declared.origin;
  } catch {
    return null;
  }
  let target: URL;
  try {
    target = new URL(href);
  } catch {
    return null;
  }
  if (target.origin !== origin) {
    return null;
  }
  const path = `${target.pathname}${target.search}${target.hash}`;
  return isSafeNavigatePath(path) ? path : null;
}
