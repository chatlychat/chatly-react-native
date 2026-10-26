import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Two kinds of test live here, and the include pattern is the interesting part.
 *
 * `src/**\/*.spec.ts` — the pure modules (the REST and realtime clients, the
 * block reader, the money formatter), in node.
 * `src/**\/*.spec.tsx` — the COMPONENTS, in jsdom, with `react-native` aliased
 * to a DOM stand-in (`src/test/react-native-dom.tsx`).
 *
 * The second pattern is new. It used to be `.ts` only, which cannot match a
 * `.tsx` file — so every component in this published SDK was structurally
 * untestable, including the composer and the message list that every consumer
 * renders. `apps/mobile-agent` had the identical bug and the identical fix;
 * the stand-in is a second file rather than a shared one, and the header of
 * `src/test/react-native-dom.tsx` says why.
 *
 * A simulator is still the only thing that can prove the native layer. This
 * covers the React layer, which is where component bugs actually are.
 */
const vitestExecution = { pool: 'threads' as const };

export default defineConfig({
  resolve: {
    alias: {
      'react-native': fileURLToPath(new URL('./src/test/react-native-dom.tsx', import.meta.url)),
    },
  },
  test: {
    // Worker THREADS, not forked processes. See @livechat/config/vitest.
    ...vitestExecution,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    exclude: ['**/node_modules/**'],
  },
});
