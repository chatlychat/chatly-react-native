/**
 * A DOM stand-in for the React Native primitives THIS package uses, so its
 * components can be tested at all.
 *
 * ── Why this package needed one ────────────────────────────────────────
 *
 * `vitest.config.ts` here included `src/**‌/*.spec.ts`, which cannot match a
 * `.tsx` file — so every component in a published SDK (the composer, the
 * message list, and now the block and canvas renderers a shopper taps) was
 * structurally untestable. The same one-line config bug that left
 * `apps/mobile-agent`'s screens uncovered, in a package customers ship.
 *
 * ── Why it is a second stand-in and not a shared one ───────────────────
 *
 * `apps/mobile-agent/src/test/react-native-mock.tsx` is the same idea for the
 * agent app, and sharing them was tried and reverted. The only place a
 * workspace-shared version could live is `@livechat/testing`, which depends
 * on `@livechat/db`, `postgres` and `testcontainers` — so every React Native
 * package would take a Postgres driver into its dev graph to borrow a `<div>`
 * wrapper, and a bare `@livechat/testing/react-native-dom` specifier does not
 * resolve from an app that does not depend on it. The two files also cover
 * genuinely different sets: that one has `Alert`, `Modal`, `Switch`,
 * `Animated` and a navigation stub; this one has the twelve primitives this
 * package imports and nothing else.
 *
 * The real risk of a local copy is not drift — neither file is a contract —
 * it is a stand-in that silently lacks a primitive a component starts using,
 * which makes that component untestable again. `react-native-dom.spec.tsx`
 * reads every `from 'react-native'` import in this package's source and
 * fails if any name is missing from here, which is the half that matters.
 *
 * ── What it does NOT prove ─────────────────────────────────────────────
 *
 * Nothing native: not layout, not gestures, not keyboard behaviour, not that
 * a `Pressable` has a large enough hit area, not that the package builds for
 * a device. What it covers is the React layer, which is where component bugs
 * are.
 *
 * `accessibilityLabel` becomes `aria-label` and `testID` becomes
 * `data-testid`, deliberately: a test then asks for an element the way a
 * screen reader would, so a control that is unlabelled in the app is also
 * unfindable in the test.
 */
import React from 'react';

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

/**
 * RN props that mean something to a DOM element, translated. Everything else
 * — `style`, `keyboardType` and the rest — is dropped rather than passed
 * through, because React would warn about each one and the warnings would
 * bury a real failure.
 */
function domProps(props: AnyProps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof props['accessibilityLabel'] === 'string') {
    out['aria-label'] = props['accessibilityLabel'];
  }
  if (typeof props['accessibilityHint'] === 'string') {
    out['aria-description'] = props['accessibilityHint'];
  }
  if (typeof props['testID'] === 'string') {
    out['data-testid'] = props['testID'];
  }
  if (props['accessibilityRole'] === 'button' || props['accessibilityRole'] === 'link') {
    out['role'] = props['accessibilityRole'];
  }
  /*
   * `accessibilityState.selected` → `aria-pressed`, because the only thing
   * using it is a toggle button (the card reaction pair) and `aria-pressed`
   * is what the web widget's equivalent sets. Mapped so a test can assert the
   * toggle's STATE rather than only that a press was dispatched — without it,
   * a component that fired the postback and never updated itself would pass.
   */
  const state = props['accessibilityState'];
  if (typeof state === 'object' && state !== null && 'selected' in state) {
    out['aria-pressed'] = (state as { selected?: boolean }).selected === true;
  }
  if (props['disabled'] === true) {
    out['disabled'] = true;
    out['aria-disabled'] = true;
  }
  return out;
}

function view(tag: 'div' | 'span') {
  return function Mock(props: AnyProps) {
    return React.createElement(tag, domProps(props), props['children']);
  };
}

export const View = view('div');
export const SafeAreaView = view('div');
export const ScrollView = view('div');
export const Text = view('span');

export const ActivityIndicator = function ActivityIndicator(props: AnyProps) {
  return React.createElement('progress', domProps(props));
};

export const Image = function Image(props: AnyProps) {
  const source = props['source'] as { uri?: string } | undefined;
  return React.createElement('img', {
    ...domProps(props),
    src: source?.uri ?? '',
    // RN has no alt; `accessibilityLabel` is the equivalent and an image with
    // neither should be findable as decorative rather than invisible.
    alt: typeof props['accessibilityLabel'] === 'string' ? props['accessibilityLabel'] : '',
  });
};

/**
 * `Pressable` as a real `<button>`.
 *
 * A `<div onClick>` would be clickable in a test and unreachable by keyboard,
 * which is exactly the distinction a test should keep: `getByRole('button')`
 * finds this, and `userEvent.click` fires `onPress`.
 */
const pressable = function Pressable(props: AnyProps) {
  const onPress = props['onPress'];
  return React.createElement(
    'button',
    {
      ...domProps(props),
      type: 'button',
      onClick: typeof onPress === 'function' ? (onPress as () => void) : undefined,
    },
    props['children'],
  );
};
export const Pressable = pressable;
export const TouchableOpacity = pressable;

export const TextInput = function TextInput(props: AnyProps) {
  const onChangeText = props['onChangeText'];
  return React.createElement('input', {
    ...domProps(props),
    value: (props['value'] as string | undefined) ?? '',
    placeholder: props['placeholder'] as string | undefined,
    onChange: (e: { target: { value: string } }) => {
      if (typeof onChangeText === 'function') {
        (onChangeText as (v: string) => void)(e.target.value);
      }
    },
  });
};

/**
 * `FlatList` rendered eagerly, every row.
 *
 * A virtualising list would render a window, and a test asserting "the row is
 * there" would then depend on a measured viewport that jsdom does not have.
 * Every row is the honest simplification: it can over-report (a row present
 * here might be off-screen on a device) and it cannot under-report, which is
 * the direction a test should fail in.
 */
export const FlatList = function FlatList(props: AnyProps) {
  const data = (props['data'] as unknown[] | undefined) ?? [];
  const renderItem = props['renderItem'] as
    | ((info: { item: unknown; index: number }) => React.ReactNode)
    | undefined;
  const keyExtractor = props['keyExtractor'] as ((item: unknown, i: number) => string) | undefined;
  return React.createElement(
    'div',
    domProps(props),
    props['ListHeaderComponent'] as React.ReactNode,
    data.length === 0
      ? (props['ListEmptyComponent'] as React.ReactNode)
      : data.map((item, index) =>
          React.createElement(
            'div',
            { key: keyExtractor?.(item, index) ?? String(index) },
            renderItem?.({ item, index }),
          ),
        ),
    props['ListFooterComponent'] as React.ReactNode,
  );
};

export type ListRenderItemInfo<T> = { item: T; index: number };

export const Platform = { OS: 'ios' as const, select: (o: Record<string, unknown>) => o['ios'] };

export const StyleSheet = {
  create: <T,>(styles: T): T => styles,
  hairlineWidth: 1,
  flatten: (s: unknown) => s,
  absoluteFill: {},
};

/** Opening a url. Recorded rather than performed, so a test can assert it. */
export const openedUrls: string[] = [];
export const Linking = {
  openURL: async (url: string): Promise<void> => {
    openedUrls.push(url);
  },
  canOpenURL: async (): Promise<boolean> => true,
};
