/**
 * The web widget's theme, translated onto `ChatlyTheme`.
 *
 * ═══ THE DEFECT THIS FILE EXISTS TO CLOSE ═════════════════════════════════
 *
 * `POST /v1/widget/init` has always returned the workspace's real theme. The
 * `branding` object carries `workspaces.branding`, then `brands.branding`,
 * then the channel's own `parseWidgetTheme(channels.config.theme)` spread over
 * the top (`apps/api/src/modules/widget/widget.service.ts`) — the whole
 * palette, every token, both overlay palettes. This SDK typed it
 * `branding: Record<string, unknown>` and NO component read it. A customer who
 * spent an afternoon theming their widget in the dashboard saw a blue
 * `#2563eb` Chatly default in their native app, and nothing anywhere said
 * why.
 *
 * ═══ WHY THIS IS A MAPPING AND NOT A MERGE ════════════════════════════════
 *
 * The web theme is 83 fields of CSS. React Native has no CSS: no cascade, no
 * `var()` fallback chain, no `color-mix`, no `calc`, no gradients without a
 * dependency, no `box-shadow` string, no `:hover`, no media queries, and no
 * web font loading. So most of those 83 cannot be honoured on a phone, and
 * pretending otherwise is exactly the bug being fixed here — a docblock
 * claiming parity that did not exist.
 *
 * Every one of the 83 is therefore named below in one of three tables, and
 * the distinction between the last two is the one a reader needs:
 *
 *   `MAPPED`        — it reaches a `ChatlyTheme` leaf. 17 fields.
 *   `UNMAPPED_YET`  — it COULD be honoured natively. What stops it is that
 *                     `ChatlyTheme` has no leaf for it and/or a bundled
 *                     component hard-codes the value. Ordinary work. 38.
 *   `CANNOT_MAP`    — there is nothing on a phone for it to mean. 29.
 *
 * `widget-theme-map.spec.ts` holds those three tables against
 * `widgetThemeSchema` itself, in both directions, so a field added to the web
 * theme fails this package's suite until somebody classifies it. That gate is
 * the reason these tables are data rather than prose: a comment listing 83
 * names goes stale the first time the web gains an 84th.
 *
 * ═══ WHAT IS NOT VALIDATED HERE, AND WHY IT IS VALIDATED HERE ═════════════
 *
 * Only the CHANNEL slice of `branding` has been through `widgetThemeSchema`.
 * `workspaces.branding` and `brands.branding` are spread in raw, and nothing
 * on the write path validates `theme` at all (see `salvageConfig`'s docblock).
 * So every reader below checks the VALUE as well as the key, and drops what
 * it cannot use rather than passing it to a `style` prop — the same per-key
 * repair `salvageConfig` performs, for the same reason: one malformed colour
 * must not cost a workspace the other eighty-two.
 */

import { defaultTheme } from './defaultTheme';

import type { ChatlyColorScheme, ChatlyTheme, ChatlyThemeOverrides } from './ChatlyTheme';

/* ══ The three tables ═════════════════════════════════════════════════════ */

/** Web field → where it lands on `ChatlyTheme`. */
export const MAPPED: Readonly<Record<string, string>> = Object.freeze({
  primaryColor: 'colors.primary',
  primaryContrast: 'colors.onPrimary',
  background: 'colors.background',
  backgroundSubtle: 'colors.surface',
  foreground: 'colors.foreground',
  foregroundMuted: 'colors.mutedForeground',
  border: 'colors.border',
  dangerColor: 'colors.danger',
  fontSize: 'typography.sizeBody',
  fontSizeSmall: 'typography.sizeSmall',
  headerSubtitleSize: 'typography.sizeSmall, only when `fontSizeSmall` is unset',
  headerTitleSize: 'typography.sizeTitle',
  headingSize: 'typography.sizeTitle, only when `headerTitleSize` is unset',
  borderRadius: 'radius.md, and radius.sm / radius.lg by the shipped deltas',
  density: 'spacing.xs / sm / md / lg, as a scale',
  colorScheme: 'chooses the light or the dark palette',
  darkTheme: 'layered over everything below the integrator when the scheme is dark',
});

/**
 * Transferable, and not transferred.
 *
 * The value against each name is what the work is. Most of it is one leaf on
 * `ChatlyTheme` plus one line in a component under `src/components/`, which is
 * a different owner from this file; `logoUrl` and `agentAvatarUrl` are not
 * style at all and want an image slot rather than a theme leaf.
 *
 * Nothing in here is a silent drop. A workspace that sets one of these sees
 * no change on a phone, and this is the list that says so.
 */
export const UNMAPPED_YET: Readonly<Record<string, string>> = Object.freeze({
  bubbleAgentBg:
    'needs colors.bubbleAgentBg; MessageBubble gives the agent bubble `colors.surface`, ' +
    'which also paints cards, table headers and secondary buttons',
  bubbleAgentFg: 'needs colors.bubbleAgentFg; the agent bubble takes `colors.foreground`',
  successColor: 'no leaf, and nothing in this SDK renders a delivery receipt to colour',
  warningColor: 'no leaf, and this SDK renders no offline banner',
  lineHeight:
    'a unitless CSS ratio; RN `lineHeight` is absolute, so it has to be multiplied out ' +
    'per Text node against that node own size',
  composerBg: 'Composer takes colors.background',
  composerBorder: 'Composer takes colors.border',
  composerRadius: 'Composer takes radius.md',
  composerPlaceholder: 'Composer passes no placeholderTextColor at all',
  composerIcon: 'the RN composer draws no icon buttons yet',
  composerSendBg: 'the send button takes colors.primary',
  composerSendFg: 'the send button takes colors.onPrimary',
  composerButtonBg: 'no icon buttons to fill',
  composerButtonFg: 'no icon buttons to fill',
  composerButtonSize: 'no icon buttons to size',
  cardBg: 'BlockCard takes colors.surface',
  cardBorder: 'BlockCard takes colors.border',
  cardRadius: 'BlockCard takes radius.bubble',
  cardImageRatio:
    'parses to a number for RN `aspectRatio`, but BlockCard sets a hard-coded height: 140',
  cardImageFit:
    'cover / contain / fill map onto RN resizeMode cover / contain / stretch; `none` and ' +
    '`scale-down` have no RN equivalent, so this one transfers only in part',
  cardTitleLines: 'RN Text takes numberOfLines; BlockCard passes none',
  cardPriceColor: 'the price takes colors.foreground',
  cardPriceSize: 'the price takes typography.sizeBody',
  cardBadgeBg: 'a badge is drawn as an outline on colors.background',
  cardBadgeFg: 'a badge label takes colors.foreground',
  cardButtonBg: 'a card action takes colors.primary or colors.surface by its `style`',
  cardButtonBorder: 'a card action takes colors.border',
  cardButtonFg: 'a card action takes colors.onPrimary or colors.foreground',
  chipBg: 'chips are drawn as card actions',
  chipFg: 'chips are drawn as card actions',
  chipBorder: 'chips are drawn as card actions',
  chipRadius: 'chips are drawn as card actions',
  chipWrap:
    'RN flexWrap takes the same two literals; the chip row is a card-action row with a ' +
    'fixed wrap',
  cardPerView:
    'needs the rendered width, which RN learns only from onLayout — there is no panel of ' +
    'known width here; the carousel passes a hard-coded width={240}',
  headerHeight: 'ChatlyWidget header is sized by its padding',
  headerLogoOnly:
    'depends on `logoUrl` landing first: honouring it today would hide the title and ' +
    'leave an empty header',
  logoUrl: 'not a style value — it wants an Image slot in the header, not a theme leaf',
  agentAvatarUrl: 'not a style value — it wants an Image slot in MessageBubble',
});

/**
 * No native meaning, with the reason for each.
 *
 * Four groups, and the first two are the bulk of it. The LAUNCHER does not
 * exist in this SDK: the web widget owns a floating button in somebody else's
 * document, and a native app opens chat from its own tab bar or nav button,
 * which is the host app's element and not ours to size, colour, animate or
 * hide. The PANEL GEOMETRY is the same argument — `ChatlyWidget` fills the
 * view the app puts it in, so there is no corner to sit in and no overlay to
 * offset.
 */
export const CANNOT_MAP: Readonly<Record<string, string>> = Object.freeze({
  anchor:
    'positions the web panel above an element on the HOST PAGE (a CSS selector or the ' +
    "integrator's own button); a React Native app has no host page to select from, and " +
    'places ChatlyLauncher itself',
  fontFamily:
    'a CSS family STACK ("Inter, system-ui, sans-serif"). RN fontFamily takes one family ' +
    'and it must already be linked into the app binary, so a string from a server cannot ' +
    'name a font the build does not contain',
  headerStyle:
    'gradient needs a gradient dependency; solid / plain / light are cascade arrangements ' +
    'over four CSS custom properties',
  headerGradient:
    'RN draws no gradient without react-native-linear-gradient or expo-linear-gradient',
  cardShadow:
    'a free-form CSS box-shadow string. RN takes shadowColor + shadowOffset + shadowRadius ' +
    '+ shadowOpacity on iOS and `elevation` on Android, and that is not recoverable from ' +
    'the string by anything short of a CSS parser',
  chipHoverBg: 'there is no hover on a touch screen',
  position: 'there is no corner: ChatlyWidget fills the view the host app gives it',
  offsetX: 'positions the host ELEMENT on a web page',
  offsetY: 'positions the host ELEMENT on a web page',
  panelOffsetY: 'lifts a floating panel above a host page launcher',
  panelWidth: 'the view is sized by the app layout',
  panelHeight: 'the view is sized by the app layout',
  launcherSize: 'no launcher — see the table docblock',
  launcherSizeSm: 'no launcher, and it is a max-width media query besides',
  hideLauncher: 'no launcher',
  launcherPing: 'no launcher',
  launcherIdleAnimation: 'no launcher',
  launcherLabel: 'no launcher',
  launcherLabelSize: 'no launcher',
  launcherRadius: 'no launcher',
  launcherBg: 'no launcher',
  launcherFg: 'no launcher',
  launcherOpenBg: 'no launcher, and no open/closed state to invert',
  launcherOpenFg: 'no launcher, and no open/closed state to invert',
  launcherIcon: 'raw SVG/HTML markup for dangerouslySetInnerHTML; RN renders no markup',
  launcherImage: 'no launcher',
  icons: 'raw SVG markup overrides; RN would need react-native-svg',
  hideBranding:
    'a plan entitlement rather than a style, and this SDK renders no attribution to hide',
  inlineTheme:
    'a deliberate decision, and an arguable one. It is the palette for a view mounted INTO ' +
    'a host layout rather than floating over it, which is structurally what every RN mount ' +
    'is — so the faithful reading is that it should always apply here. It is not applied, ' +
    'because a web customer who set it for their web inline mount would then find their ' +
    'native app restyled by a field whose name says nothing about mobile. That is a product ' +
    'call rather than a technical one and it is recorded here rather than taken quietly',
});

/* ══ Value readers ════════════════════════════════════════════════════════ */

/**
 * `#rgb`, `#rrggbb` or `#rrggbbaa` — the same spelling the web schema uses.
 *
 * Hex only. Every source field below is `hexColor` on the web, so anything
 * else arriving here came from an unvalidated `workspaces.branding` blob.
 * React Native would accept `rgb()`, `hsl()` and the named colours too, but
 * admitting them here would mean this SDK rendering a colour the web widget
 * refuses, from the same stored row — and `transparent` / `currentColor`,
 * which the web's token fields do admit, have no meaning on any of the eight
 * leaves these map onto.
 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function hex(value: unknown): string | undefined {
  return typeof value === 'string' && HEX.test(value) ? value : undefined;
}

/**
 * A CSS length, as a NUMBER of device-independent pixels.
 *
 * The web's `cssLength` is `number | string`, and the string half is passed to
 * CSS verbatim — so it legitimately holds `1rem`, `50%`, `calc(1rem + 2px)`
 * and the corner shorthand `12px 12px 0 0`. None of those is a number.
 *
 * `rem` and `em` are refused rather than multiplied by 16: there is no root
 * font size on a phone to be relative TO, and inventing one would make a
 * workspace `borderRadius: '1rem'` silently mean something different on each
 * platform. A refused value falls through to this SDK's own default, which is
 * visibly a default; a guessed one looks correct and is not.
 */
const PX = /^(\d{1,4}(?:\.\d{1,3})?)px$/;

function px(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = PX.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/* ══ The mapping ══════════════════════════════════════════════════════════ */

const COLORS: ReadonlyArray<readonly [string, keyof ChatlyTheme['colors']]> = [
  ['primaryColor', 'primary'],
  ['primaryContrast', 'onPrimary'],
  ['background', 'background'],
  ['backgroundSubtle', 'surface'],
  ['foreground', 'foreground'],
  ['foregroundMuted', 'mutedForeground'],
  ['border', 'border'],
  ['dangerColor', 'danger'],
];

/**
 * `density`, as one multiplier over the whole spacing scale.
 *
 * The web resolves the enum to two numbers — `--cl-density-pad` 8 / 16 against
 * a shipped 10, and `--cl-density-gap` 6 / 14 against a shipped 9
 * (`themeToCssVars`). `ChatlyTheme.spacing` is four numbers used as both
 * padding and gap, so the pad ratios are the ones taken: 0.8 and 1.6.
 *
 * Rounded to whole pixels and floored at 1, because a sub-pixel gap is not a
 * gap and a zero one collapses two surfaces into one.
 */
const DENSITY_SCALE: Readonly<Record<string, number>> = { compact: 0.8, comfortable: 1.6 };

/**
 * `borderRadius`, as a DELTA against the shipped scale rather than a ratio.
 *
 * `radius.sm` is 4 below `radius.md` in `defaultTheme`, which is not a
 * coincidence to be preserved by hand: it is the web's own arithmetic, and
 * `widget.css` writes `calc(var(--cl-radius) - 4px)` at the two surfaces that
 * want a tighter corner than the panel's. `radius.lg` keeps its shipped +6.
 *
 * Deltas rather than ratios so that an unset `borderRadius` leaves all three
 * leaves exactly as shipped, and a `borderRadius: 0` gives square corners
 * everywhere instead of a scale that has quietly kept its proportions.
 *
 * `radius.bubble` is deliberately NOT derived: `.cl-bubble` on the web is a
 * hard-coded 14px that `--cl-radius` does not reach either, so moving it from
 * a channel's `borderRadius` would be this SDK inventing a behaviour the web
 * does not have.
 */
const RADIUS_SM_DELTA = defaultTheme.radius.sm - defaultTheme.radius.md;
const RADIUS_LG_DELTA = defaultTheme.radius.lg - defaultTheme.radius.md;

/**
 * Read one web theme object — the top level of `branding`, or a `darkTheme`
 * overlay — as a partial `ChatlyTheme`.
 *
 * Returns only the leaves the object genuinely set. An absent or unusable
 * value produces an absent KEY rather than an `undefined` one, which is what
 * makes layering these safe: see `applyOverrides`.
 */
export function themeFromBranding(raw: unknown): ChatlyThemeOverrides {
  const branding = record(raw);
  if (branding === null) {
    return {};
  }

  const colors: Partial<ChatlyTheme['colors']> = {};
  for (const [from, to] of COLORS) {
    const value = hex(branding[from]);
    if (value !== undefined) {
      colors[to] = value;
    }
  }
  /*
   * The legacy `brandColor`, honoured exactly as the web honours it.
   *
   * `resolveWidgetTheme`'s `SERVER_TO_THEME` fills `primaryColor` from it only
   * when the server did not supply `primaryColor` directly, so a future
   * payload that sends the real name still wins. It is what
   * `workspaces.branding` has stored since before the theme schema existed,
   * and it is the single most likely field to be the only colour a workspace
   * ever set.
   */
  if (colors.primary === undefined) {
    const legacy = hex(branding['brandColor']);
    if (legacy !== undefined) {
      colors.primary = legacy;
    }
  }

  const radius: Partial<ChatlyTheme['radius']> = {};
  const base = px(branding['borderRadius']);
  if (base !== undefined) {
    radius.md = base;
    radius.sm = Math.max(0, base + RADIUS_SM_DELTA);
    radius.lg = Math.max(0, base + RADIUS_LG_DELTA);
  }

  const spacing: Partial<ChatlyTheme['spacing']> = {};
  const density = branding['density'];
  const scale = typeof density === 'string' ? DENSITY_SCALE[density] : undefined;
  if (scale !== undefined) {
    spacing.xs = Math.max(1, Math.round(defaultTheme.spacing.xs * scale));
    spacing.sm = Math.max(1, Math.round(defaultTheme.spacing.sm * scale));
    spacing.md = Math.max(1, Math.round(defaultTheme.spacing.md * scale));
    spacing.lg = Math.max(1, Math.round(defaultTheme.spacing.lg * scale));
  }

  const typography: Partial<ChatlyTheme['typography']> = {};
  const body = px(branding['fontSize']);
  if (body !== undefined) {
    typography.sizeBody = body;
  }
  /*
   * Two web fields per leaf, and the tie-break is written down.
   *
   * `typography.sizeSmall` is read nineteen times in this package — card
   * subtitles, captions, timestamps, the system line — which is what the web's
   * `fontSizeSmall` governs (`.cl-branding`, `.cl-blk-card__sub`).
   * `headerSubtitleSize` governs `.cl-status` and `.cl-greet-sub`, two
   * surfaces this SDK does not have. So `fontSizeSmall` wins and the other
   * applies only when it is unset — which still beats dropping it, because a
   * workspace that set only `headerSubtitleSize` then gets something.
   *
   * `typography.sizeTitle` is the same shape the other way round: it is read
   * by the ChatlyWidget header's workspace name, which IS `.cl-org`, so
   * `headerTitleSize` wins over `headingSize` (`.cl-greet-h`,
   * `.cl-article-title`).
   *
   * Collapsing two fields onto one leaf is a real loss and it is listed as
   * such in `MAPPED` above, not hidden behind the `??`.
   */
  const small = px(branding['fontSizeSmall']) ?? px(branding['headerSubtitleSize']);
  if (small !== undefined) {
    typography.sizeSmall = small;
  }
  const title = px(branding['headerTitleSize']) ?? px(branding['headingSize']);
  if (title !== undefined) {
    typography.sizeTitle = title;
  }

  const out: ChatlyThemeOverrides = {};
  if (Object.keys(colors).length > 0) {
    out.colors = colors;
  }
  if (Object.keys(radius).length > 0) {
    out.radius = radius;
  }
  if (Object.keys(spacing).length > 0) {
    out.spacing = spacing;
  }
  if (Object.keys(typography).length > 0) {
    out.typography = typography;
  }
  return out;
}

/**
 * Which palette this render uses.
 *
 * Mirrors `resolveWidgetTheme`: anything that is not exactly `'light'` or
 * `'dark'` resolves from the device, which covers `'auto'`, an absent field
 * and the `'Dark'` an untyped embed snippet can produce.
 *
 * @param integrator the `colorScheme` prop. It wins, for the reason the
 *   provider's precedence docblock gives: it is code the app author wrote.
 * @param device what `useColorScheme()` says, or null where there is no
 *   device to ask.
 */
export function resolveColorScheme(
  branding: unknown,
  integrator: ChatlyColorScheme | undefined,
  device: ChatlyColorScheme | null,
): ChatlyColorScheme {
  if (integrator === 'light' || integrator === 'dark') {
    return integrator;
  }
  const configured = record(branding)?.['colorScheme'];
  if (configured === 'light' || configured === 'dark') {
    return configured;
  }
  return device === 'dark' ? 'dark' : 'light';
}
