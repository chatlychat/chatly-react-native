/**
 * What the DEVICE says about dark mode.
 *
 * ── Why this is a shim and not a bare `useColorScheme` import ───────────
 *
 * Two reasons, and the second is the one that matters.
 *
 * `react-native` is a PEER dependency here, and `useColorScheme` only arrived
 * in 0.62. The declared range is `>=0.73.0`, so every supported version has
 * it — but this package is published, a peer range is a promise about what we
 * tolerate, and a missing hook would be a crash on mount rather than a
 * degraded colour.
 *
 * And under vitest `react-native` resolves to `src/test/react-native-dom.tsx`,
 * a DOM stand-in that exports the component primitives and no hooks. Without
 * this shim, importing `useColorScheme` would be `undefined`, calling it
 * would throw, and every `.tsx` spec that mounts a provider would fail for a
 * reason that has nothing to do with what it is testing.
 *
 * ── The hook rules are respected ───────────────────────────────────────
 *
 * The fallback is resolved ONCE at module load, so the call below is
 * unconditional and the hook count per render is fixed for the lifetime of the
 * process. It never flips between the real hook and the stub mid-session.
 *
 * ── What this means for the suite ──────────────────────────────────────
 *
 * In jsdom this always answers `null`, so the DARK path cannot be reached
 * through the device. That is why `ChatlyProvider` takes an explicit
 * `colorScheme` prop and why the dark-mode assertions go through it and
 * through `resolveChatlyTheme` directly. Nothing here proves that a real
 * phone flipping to dark mode re-renders the tree — only a simulator can.
 */

import * as ReactNative from 'react-native';

import type { ChatlyColorScheme } from './ChatlyTheme';

type NativeHook = () => ChatlyColorScheme | null | undefined;

const native = (ReactNative as { useColorScheme?: NativeHook }).useColorScheme;

/** Named `use…` so the react-hooks lint rules treat the call below as a hook. */
const useNativeColorScheme: NativeHook = native ?? ((): null => null);

export function useDeviceColorScheme(): ChatlyColorScheme | null {
  return useNativeColorScheme() ?? null;
}
