/**
 * A `table` block on a native screen, and why it is a file of its own.
 *
 * ── Why it is not in `MessageBlocks.tsx` ────────────────────────────────
 *
 * Because it does not fit: that file was 495 lines and the badge, reaction and
 * table work is about 230 more, against this repo's 650-line ceiling
 * (`scripts/check-file-size.mjs`). Splitting a file is never free — CLAUDE.md
 * has had to say so twice about the widget's byte budget — so the seam was
 * chosen rather than taken at the first convenient blank line. A comparison
 * table shares NOTHING with the rest of the block renderer: no action running,
 * no postback, no `onReply`, no card shape, nothing from `MessageBlocksProps`.
 * It takes a block and a theme and draws a grid. The `case 'table'` that
 * reaches it stays in the switch next to its nine siblings, so
 * `check-block-renderer-parity.mjs` still sees the literal where it belongs.
 *
 * ── Why a flex grid and not a table ────────────────────────────────────
 *
 * React Native has no table primitive — no `<table>`, no `<th>`, no `scope`,
 * no row/column semantics of any kind. So this is a flex grid inside a
 * horizontal `ScrollView`, and the two costs of that are paid explicitly:
 *
 *  - The widths are FIXED, not flexed. Columns that size themselves to their
 *    own content stop lining up between rows, and a comparison whose columns
 *    do not line up is unreadable in exactly the way a table exists to
 *    prevent. Six columns at 116px plus the attribute column do not fit a
 *    phone, which is what the `ScrollView` is for; wrapping them instead
 *    would turn a comparison into a list, and `fields` is already the block
 *    for a list.
 *  - Every data row sets `accessible` and an `accessibilityLabel` naming BOTH
 *    axes — "Battery life: Pixel 9 22 hours, iPhone 16 20 hours". That
 *    announcement is what `<th scope="row">` buys a web surface for free, and
 *    it is not decoration: without it a screen reader reads a six-by-twelve
 *    comparison as seventy-two loose values in document order, which is worse
 *    than no table at all.
 *
 * ── The one rule that is a correctness rule ────────────────────────────
 *
 * The cells are iterated over `columns`, NEVER over `row.cells`. A short row
 * is legal and renders blanks — the write boundary refuses only a row LONGER
 * than the header, because an author assembling a comparison out of a
 * catalogue will have gaps — so walking the row would shift every value left
 * of a gap under the wrong heading. That is a confident wrong answer about a
 * product rather than a missing one, which is the worst of the three outcomes
 * the reader picks between, and it is the reason `read-envelope.ts` coerces a
 * bad column instead of dropping it.
 */
import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

import { useChatly } from '../useChatly';

import type { WidgetBlock } from '../blocks/types';

type TableBlock = Extract<WidgetBlock, { readonly type: 'table' }>;

/** Fixed widths, because a flex grid without them is not a grid. See the header. */
const ROW_LABEL_WIDTH = 108;
const CELL_WIDTH = 116;

/** What an absent cell is CALLED when it is spoken. A silence reads as an omission. */
const NOT_GIVEN = 'not given';

export function BlockTable({ block }: { readonly block: TableBlock }): React.JSX.Element {
  const { theme } = useChatly();
  const cell = {
    paddingHorizontal: theme.spacing.xs + 2,
    paddingVertical: theme.spacing.xs,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  } as const;
  const small = { fontSize: theme.typography.sizeSmall };

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {/*
        The caption sits OUTSIDE the scroller, deliberately. It is one line of
        prose about the whole table, and a caption that scrolls sideways out of
        view along with column four is a caption nobody reads.
      */}
      {block.caption !== undefined && (
        <Text style={{ ...small, color: theme.colors.mutedForeground }}>{block.caption}</Text>
      )}
      <ScrollView horizontal accessibilityLabel="Comparison table">
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.sm,
            overflow: 'hidden',
          }}
        >
          {/*
            The header row is distinct by THREE things rather than one: a
            filled background, a heavier weight and a rule beneath it. A tint
            alone is what a reader with inverted colours or a high-contrast
            setting loses first, and weight and rule both survive that.
          */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: theme.colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            {/* The corner heads neither axis, so it carries nothing. */}
            <View style={{ ...cell, width: ROW_LABEL_WIDTH }} />
            {block.columns.map((column, c) => (
              <View key={`c-${String(c)}`} style={{ ...cell, width: CELL_WIDTH }}>
                {column.image !== undefined && (
                  <Image
                    source={{ uri: column.image }}
                    accessibilityIgnoresInvertColors
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: theme.radius.sm,
                      marginBottom: 2,
                    }}
                  />
                )}
                <Text
                  style={{
                    ...small,
                    color: theme.colors.foreground,
                    fontWeight: theme.typography.weightBold,
                  }}
                >
                  {column.label}
                </Text>
              </View>
            ))}
          </View>
          {block.rows.map((row, r) => (
            <View
              key={`r-${String(r)}`}
              accessible
              accessibilityLabel={`${row.label}: ${block.columns
                .map((column, c) => `${column.label} ${row.cells[c] ?? NOT_GIVEN}`)
                .join(', ')}`}
              style={{
                flexDirection: 'row',
                backgroundColor: theme.colors.background,
                borderTopWidth: r === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <View style={{ ...cell, width: ROW_LABEL_WIDTH }}>
                <Text style={{ ...small, color: theme.colors.mutedForeground }}>{row.label}</Text>
              </View>
              {block.columns.map((_column, c) => (
                <View key={`c-${String(c)}`} style={{ ...cell, width: CELL_WIDTH }}>
                  <Text style={{ ...small, color: theme.colors.foreground }}>
                    {row.cells[c] ?? ''}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
