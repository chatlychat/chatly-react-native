import type { ChatlyTheme } from './ChatlyTheme';

/**
 * Default theme. Colors mirror the web widget defaults so cross-platform
 * branding stays consistent out of the box.
 */
export const defaultTheme: ChatlyTheme = {
  colors: {
    primary: '#2563eb',
    onPrimary: '#ffffff',
    background: '#ffffff',
    foreground: '#0f172a',
    mutedForeground: '#64748b',
    border: '#e2e8f0',
    surface: '#f8fafc',
    danger: '#ef4444',
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    bubble: 18,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
  typography: {
    sizeBody: 15,
    sizeSmall: 12,
    sizeTitle: 17,
    weightRegular: '400',
    weightMedium: '500',
    weightBold: '700',
  },
};

/**
 * The built-in DARK palette, applied when the resolved colour scheme is dark.
 *
 * ── Why this has to exist at all ────────────────────────────────────────
 *
 * On the web, a channel with `colorScheme: 'dark'` and no `darkTheme` of its
 * own still goes dark, because `.cl-shell.scheme-dark` in
 * `apps/widget/src/widget.css` redefines seven custom properties in the
 * CASCADE. There is no cascade in React Native, so without this constant a
 * workspace that set `colorScheme: 'dark'` would have got the light palette
 * on a phone and nothing would have said so.
 *
 * The five values below are those seven, copied from that rule verbatim
 * (`--cl-agent-bg` / `--cl-agent-fg` are the two that are not listed
 * separately: the RN agent bubble takes `surface` and `foreground`, which the
 * web's rule happens to set to the same `#1e293b` / `#f1f5f9`, so the bubble
 * lands correctly without a leaf of its own). `primary`, `onPrimary` and
 * `danger` are deliberately unchanged: they are not scheme-sensitive on the
 * web either.
 *
 * `rgba()` for the border, not hex, because that is what the web rule says
 * and React Native accepts the function form. An 8-digit hex would have been
 * a different colour over a different backdrop.
 *
 * It sits BELOW the workspace's own theme in `resolveChatlyTheme`, which is
 * also what the web does: an explicit `theme.background` is emitted as an
 * inline custom property and an inline declaration outranks any author rule,
 * so an operator who sets a light background and no dark palette gets a light
 * panel in dark mode on both platforms. That is a surprising behaviour to
 * mirror, and mirroring it is the point — the alternative is the two
 * platforms disagreeing about the same stored config.
 */
export const darkDefaultTheme: ChatlyTheme = {
  ...defaultTheme,
  colors: {
    ...defaultTheme.colors,
    background: '#0f172a',
    surface: '#1e293b',
    foreground: '#f1f5f9',
    mutedForeground: '#94a3b8',
    border: 'rgba(255, 255, 255, 0.08)',
  },
};
