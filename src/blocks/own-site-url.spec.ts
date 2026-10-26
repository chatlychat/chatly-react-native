/**
 * A `url` action on the app's OWN site routes like `navigate`.
 *
 * Crossly's round 2: an older card, an agent who typed a full link and a help
 * article all arrive as `url`, so sending the buyer to the system browser for
 * a screen the app owns lost their place. The web widget already treats this
 * as `target: "self"`.
 *
 * The security case is the reason this is not a string prefix test, and the
 * `.evil` case below is the whole point.
 */
import { describe, expect, it } from 'vitest';

import { ownSitePath } from './navigate';

const SITE = 'https://shop.crossly.com';

describe('ownSitePath', () => {
  it('returns the path for an href on the declared origin', () => {
    expect(ownSitePath(SITE, `${SITE}/p/wool-coat`)).toBe('/p/wool-coat');
  });

  it('keeps the query and the fragment, which carry the variant', () => {
    expect(ownSitePath(SITE, `${SITE}/p/coat?size=m#reviews`)).toBe('/p/coat?size=m#reviews');
  });

  it('refuses a suffix origin — the reason this is not a prefix test', () => {
    // `https://shop.crossly.com.evil.example` STARTS WITH the site origin, so
    // a `startsWith(siteOrigin)` test would hand an attacker's link to the
    // app's own router.
    expect(ownSitePath(SITE, 'https://shop.crossly.com.evil.example/p/x')).toBeNull();
  });

  it('refuses another origin, so a third-party link still reaches the browser', () => {
    expect(ownSitePath(SITE, 'https://example.com/p/x')).toBeNull();
  });

  it('applies the same path guard as a navigate action', () => {
    // Same origin, but a path `navigate` would refuse. Routing it because it
    // arrived as a `url` would be a way around the guard.
    expect(ownSitePath(SITE, `${SITE}/..%2fadmin`)).toBeNull();
    expect(ownSitePath(SITE, `${SITE}//evil.example`)).toBeNull();
  });

  it('is null with no siteOrigin, and for an http one', () => {
    expect(ownSitePath(undefined, `${SITE}/p/x`)).toBeNull();
    // `navigateTarget` will not route to an http origin, so this must not
    // route FROM one either.
    expect(ownSitePath('http://shop.crossly.com', 'http://shop.crossly.com/p/x')).toBeNull();
  });

  it('is null for an unparseable href or origin', () => {
    expect(ownSitePath(SITE, 'not a url')).toBeNull();
    expect(ownSitePath('not an origin', `${SITE}/p/x`)).toBeNull();
  });

  it('routes the origin root as `/`', () => {
    expect(ownSitePath(SITE, SITE)).toBe('/');
  });
});
