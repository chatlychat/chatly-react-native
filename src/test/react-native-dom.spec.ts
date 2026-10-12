/**
 * The DOM stand-in covers every primitive this package imports.
 *
 * ── The failure this catches ───────────────────────────────────────────
 *
 * A stand-in is not a contract, so it cannot "drift" in the usual sense.
 * What it can do is silently lack a primitive a component starts using:
 * `import { Modal } from 'react-native'` resolves to `undefined`, the
 * component throws at render, and the symptom is a test file that fails to
 * collect — which reads as a broken test rather than as an incomplete
 * harness. Worse, somebody deletes the test.
 *
 * So this reads the source rather than trusting it: every name imported from
 * `react-native` anywhere in `src/` must be exported by the stand-in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as standIn from './react-native-dom';

/*
 * `fileURLToPath(dirname(...))`, not `new URL('..').pathname`.
 *
 * The first attempt used the latter and resolved to `/src` — vite rewrites
 * `import.meta.url` for a transformed module, so the URL is root-relative and
 * `.pathname` drops the part that matters. The failure was an ENOENT on
 * `/src/index.ts`, which at least was loud; a version that had silently
 * scanned an empty directory would have passed.
 */
const SRC = dirname(dirname(fileURLToPath(import.meta.url)));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !entry.includes('.spec.')) {
      out.push(full);
    }
  }
  return out;
}

/** Every name imported from `react-native`, across the package. */
function importedNames(): string[] {
  const names = new Set<string>();
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import \{([^}]*)\} from 'react-native';/gs)) {
      for (const raw of (m[1] ?? '').split(',')) {
        const name = raw.trim().replace(/^type\s+/, '');
        if (name.length > 0) {
          names.add(name);
        }
      }
    }
  }
  return [...names].sort();
}

describe('react-native stand-in', () => {
  const imported = importedNames();

  it('is reading the source — the scan found the imports', () => {
    // A floor, because an empty list would make the assertion below trivially
    // true forever. Twelve at the time of writing.
    expect(imported.length).toBeGreaterThanOrEqual(10);
    expect(imported).toContain('View');
    expect(imported).toContain('Text');
  });

  it('exports every primitive the package imports', () => {
    // `ListRenderItemInfo` is a TYPE and is erased, so it is not a runtime
    // export of the stand-in — but it must still be declared there or the
    // alias breaks the typecheck, which `tsc --noEmit` covers.
    const runtime = imported.filter((n) => n !== 'ListRenderItemInfo');
    const missing = runtime.filter((n) => !(n in standIn));
    expect(missing).toEqual([]);
  });

  it('exports components that actually render', () => {
    // `in` would be satisfied by an exported `undefined`.
    for (const name of ['View', 'Text', 'Pressable', 'TextInput', 'FlatList', 'Image']) {
      expect(typeof (standIn as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
