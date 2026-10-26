/**
 * The theme contract for the React Native SDK.
 *
 * ── This docblock used to claim something false ─────────────────────────
 *
 * It read: "Mirrors the variables exposed by the web widget so designers can
 * theme web + mobile from one palette." It does not, and never did. The web
 * widget's theme is 83 fields (`widgetThemeSchema` in
 * `packages/shared/src/widget-config/appearance.ts` plus the 49 tokens spread
 * in from `theme-tokens.ts`); this is 22 leaves, and exactly three of the
 * names coincide — `background`, `foreground`, `border`. Every other one is
 * renamed or word-reversed: `primary` is the web's `primaryColor`,
 * `onPrimary` is `primaryContrast`, `mutedForeground` is `foregroundMuted`,
 * `surface` is `backgroundSubtle`, `danger` is `dangerColor`. A designer who
 * read that sentence and built one palette would have found that five names
 * in six did nothing.
 *
 * ── What this type actually is ──────────────────────────────────────────
 *
 * It is the SDK's own small, native-shaped palette: the values the bundled
 * components (`MessageBubble`, `Composer`, `MessagesList`, `BlockCard`,
 * `BlockTable`, `MessageCanvas`, `HelpCenter`, `ChatlyWidget`) actually read
 * and pass to a React Native `style` prop. Every one of the 22 leaves below
 * is read by at least one of them, which is the property that makes it worth
 * keeping as it is rather than renaming it to match the web.
 *
 * The relationship to the web's tokens is a MAPPING, not an identity, and it
 * lives in one place: `widget-theme-map.ts`, which translates the
 * `branding` payload of `POST /v1/widget/init` onto these leaves and names
 * every one of the web's 83 fields as mapped, not-mapped-yet, or
 * cannot-be-mapped. Read that file before assuming a web setting reaches a
 * phone.
 *
 * ── The names are not changing ──────────────────────────────────────────
 *
 * Renaming them to the web's would be the honest fix and it is a breaking
 * change to a published package (`@chatlychat/react-native`, on npm), so it
 * needs a major and a deliberate decision. Until then the names stay and this
 * docblock tells the truth instead.
 */
export interface ChatlyTheme {
  colors: {
    /** The web's `primaryColor` (or the legacy `brandColor`). */
    primary: string;
    /** The web's `primaryContrast`. */
    onPrimary: string;
    /** The web's `background`. */
    background: string;
    /** The web's `foreground`. */
    foreground: string;
    /** The web's `foregroundMuted`. */
    mutedForeground: string;
    /** The web's `border`. */
    border: string;
    /** The web's `backgroundSubtle`. */
    surface: string;
    /** The web's `dangerColor`. */
    danger: string;
  };
  radius: {
    /** Derived from the web's `borderRadius`, less 4 — see `widget-theme-map.ts`. */
    sm: number;
    /** The web's `borderRadius`. */
    md: number;
    /** Derived from `borderRadius`. Read by nothing in this package today. */
    lg: number;
    /** No web field governs this: `.cl-bubble` is a hard-coded 14px there too. */
    bubble: number;
  };
  /** Driven as a scale by the web's `density` enum. */
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
  };
  typography: {
    /** The web's `fontSize`. */
    sizeBody: number;
    /** The web's `fontSizeSmall`, falling back to `headerSubtitleSize`. */
    sizeSmall: number;
    /** The web's `headerTitleSize`, falling back to `headingSize`. */
    sizeTitle: number;
    weightRegular: '400';
    weightMedium: '500';
    weightBold: '700';
  };
}

/**
 * A theme with every leaf optional, at every depth.
 *
 * ── `Partial<ChatlyTheme>` was the wrong type and it was the prop's type ─
 *
 * `Partial<ChatlyTheme>` makes the four GROUPS optional and leaves each
 * group's contents fully required, so the obvious call —
 * `theme={{ colors: { primary: '#f00' } }}` — did not typecheck, even though
 * `mergeTheme` spread the group and handled it correctly at runtime. An
 * integrator who wanted to change one colour had to restate all eight.
 *
 * Widening the prop to this is additive: every value that satisfied
 * `Partial<ChatlyTheme>` still satisfies this.
 */
export interface ChatlyThemeOverrides {
  colors?: Partial<ChatlyTheme['colors']>;
  radius?: Partial<ChatlyTheme['radius']>;
  spacing?: Partial<ChatlyTheme['spacing']>;
  typography?: Partial<ChatlyTheme['typography']>;
}

/** The two schemes a device can be in, after `'auto'` has been resolved. */
export type ChatlyColorScheme = 'light' | 'dark';
