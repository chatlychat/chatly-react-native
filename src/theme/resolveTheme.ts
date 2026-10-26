/**
 * Theme layering: built-in defaults, the workspace's configured theme, and the
 * integrator's prop.
 *
 * ═══ THE PRECEDENCE, LOWEST TO HIGHEST ════════════════════════════════════
 *
 *   1. `defaultTheme`                    — this SDK's own palette
 *   2. `darkDefaultTheme`                — replaces 1 when the scheme is dark
 *   3. `branding`                        — the workspace's theme, from
 *                                          `POST /v1/widget/init`
 *   4. `branding.darkTheme`              — applied over 3 when dark
 *   5. the `theme` prop on ChatlyProvider — the integrator
 *
 * ── Why the integrator beats the workspace ──────────────────────────────
 *
 * This is the decision an audit flagged as unmade, so it is written here
 * rather than left to be inferred from the order of two spreads.
 *
 * The prop is code the app author wrote deliberately for this screen, and a
 * reader standing at the call site can see it. The workspace theme is remote
 * config that can change under them: an app that silently restyled itself
 * because somebody saved a colour in a dashboard would be unexplainable from
 * the source, and un-debuggable from a crash report. A native binary also
 * ships on a store review cycle, so an app author has far less recourse than
 * a web page author when remote config goes somewhere they did not want.
 *
 * It is also what the web does with the same question. `resolveWidgetTheme`
 * layers channel → SNIPPET → live → profile, and the snippet — the integrator,
 * the person writing HTML on the page — beats the channel there too. Chatly
 * answers this question the same way on both platforms.
 *
 * ── Why the dark DEFAULTS sit below the workspace's own theme ───────────
 *
 * Also the web's answer, and also a surprising one: see `darkDefaultTheme`.
 * An operator who sets a light `background` and no `darkTheme` gets a light
 * surface in dark mode on both platforms, because on the web that colour is
 * emitted as an inline custom property and an inline declaration outranks
 * `.cl-shell.scheme-dark` whatever its specificity.
 */

import { darkDefaultTheme, defaultTheme } from './defaultTheme';
import { themeFromBranding } from './widget-theme-map';

import type { ChatlyColorScheme, ChatlyTheme, ChatlyThemeOverrides } from './ChatlyTheme';

/**
 * One layer over another. An ABSENT value is absent; an `undefined` one is
 * absent too.
 *
 * ── The `undefined` filter is the whole of this function ────────────────
 *
 * `exactOptionalPropertyTypes` is `false` in this package, so an integrator
 * writing `theme={{ colors: { primary: brand?.color } }}` with `brand`
 * undefined typechecks and hands us a PRESENT key holding `undefined`. A
 * plain spread carries that through and wipes the layer below — so the
 * workspace's configured colour would be destroyed by a prop that set
 * nothing, and the result would fall through to this SDK's built-in blue.
 *
 * The web widget learned this twice, in two different subsystems:
 * `assignDefined` in `apps/widget/src/theme.ts` for every theme layer above
 * the snippet, and `layeredCopy` for the four copy layers. The filter has to
 * run per LAYER and not once over the merged result, because by then a higher
 * layer's `undefined` has already overwritten a lower layer's real value.
 */
function layer<T extends object>(base: T, over: Partial<T> | undefined): T {
  if (over === undefined) {
    return base;
  }
  const out: T = { ...base };
  for (const key of Object.keys(over) as Array<keyof T>) {
    const value = over[key];
    if (value !== undefined) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

/** Apply one set of overrides to a complete theme. */
export function applyOverrides(
  base: ChatlyTheme,
  over: ChatlyThemeOverrides | undefined,
): ChatlyTheme {
  if (over === undefined) {
    return base;
  }
  return {
    colors: layer(base.colors, over.colors),
    radius: layer(base.radius, over.radius),
    spacing: layer(base.spacing, over.spacing),
    typography: layer(base.typography, over.typography),
  };
}

export interface ResolveThemeInput {
  /** `InitResponse.branding`, verbatim. */
  branding?: unknown;
  /** The `theme` prop on `ChatlyProvider`. */
  overrides?: ChatlyThemeOverrides | undefined;
  /** Already resolved — see `resolveColorScheme`. */
  scheme: ChatlyColorScheme;
}

/**
 * The theme a render uses. Pure, so the precedence above is testable without
 * mounting anything.
 */
export function resolveChatlyTheme(input: ResolveThemeInput): ChatlyTheme {
  let theme = input.scheme === 'dark' ? darkDefaultTheme : defaultTheme;
  theme = applyOverrides(theme, themeFromBranding(input.branding));
  if (input.scheme === 'dark') {
    const dark =
      typeof input.branding === 'object' && input.branding !== null
        ? (input.branding as Record<string, unknown>)['darkTheme']
        : undefined;
    theme = applyOverrides(theme, themeFromBranding(dark));
  }
  return applyOverrides(theme, input.overrides);
}
