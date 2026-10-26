/**
 * The published block renderer, on the parts the bubble's spec does not reach.
 *
 * ── Why a second spec file beside `MessageBubble.spec.tsx` ──────────────
 *
 * That one exists to prove the MOUNT — a renderer nothing mounts passes its
 * own unit test and renders nowhere, which has shipped here twice — so it
 * drives the component through the bubble and asserts the interactive half.
 * This one renders `MessageBlocks` directly, because the things added on
 * 2026-10-22 (both badges with their tone, the reaction pair, thirteen
 * actions, a comparison table) need a dozen envelopes and no bubble.
 *
 * ── What this suite can and cannot see ─────────────────────────────────
 *
 * `react-native` is aliased to `src/test/react-native-dom.tsx`, which maps the
 * primitives onto DOM elements and DROPS every `style` prop (its header says
 * why: React would warn on each one and the warnings would bury a real
 * failure). So nothing below asserts a colour, a width, a border or a font
 * weight — not the fixed column widths that make the table line up, not the
 * tone border on a badge, not the filled header row. Those are claims only a
 * simulator can check, and no simulator runs in this repo: Expo SDK 50 will
 * not build against Xcode 26.
 *
 * What IS asserted is the layer where the bugs are — which values appear,
 * under which heading, with which accessible name, and whether a control is a
 * control. Every assertion below is derived from `blocks/types.ts`, which the
 * reader's own parity spec holds to the shared schema; none of it is a shape
 * invented for the test, because a made-up shape makes a suite agree with the
 * bug it was written to catch.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from '../ChatlyProvider';
import { MessageBlocks } from './MessageBlocks';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyContextValue } from '../ChatlyProvider';

/*
 * Explicit, not inherited: `@testing-library/react` auto-cleans only under
 * `globals: true`, which this package does not set. Without it every render
 * accumulates in one document and `getByText` starts failing with "found
 * multiple elements", which reads as a duplicate-render bug in the component.
 */
afterEach(cleanup);

function draw(blocks: unknown): { readonly rest: { readonly postback: ReturnType<typeof vi.fn> } } {
  const rest = {
    reply: vi.fn().mockResolvedValue({}),
    postback: vi.fn().mockResolvedValue({}),
    reportAction: vi.fn().mockResolvedValue({}),
    requestCanvasStep: vi.fn().mockResolvedValue({}),
    submitCanvas: vi.fn().mockResolvedValue({ canvas: null, errors: {} }),
  };
  const value = { theme: defaultTheme, rest } as unknown as ChatlyContextValue;
  render(
    <ChatlyContext.Provider value={value}>
      <MessageBlocks blocks={blocks} conversationId="conv-1" messageId="m1" />
    </ChatlyContext.Provider>,
  );
  return { rest };
}

describe('MessageBlocks (published RN SDK)', () => {
  it('renders BOTH badges, with the tone as a glyph and as a word', () => {
    draw({
      v: 1,
      blocks: [
        {
          type: 'card',
          title: 'Wool hat',
          badge: ['Sale', { text: 'Above typical', tone: 'warning' }],
        },
      ],
    });
    /*
     * Two pills, not one. `MAX_CARD_BADGES` is two because the common pair is
     * a fact and a verdict, and a renderer drawing the first shows the shopper
     * half of what the author wrote.
     *
     * The legacy BARE STRING is a `neutral` badge and gets no glyph — that is
     * what every row stored before tones existed holds, so it is the common
     * path rather than the legacy one.
     */
    expect(screen.getByText('Sale')).toBeDefined();
    expect(screen.getByText('! Above typical')).toBeDefined();
    /*
     * And the tone's MEANING in the accessible name. The rule is not "pick a
     * legible colour", it is that colour may never be the only carrier — which
     * matters doubly here, where `ChatlyTheme` has no `warning` token at all,
     * so the glyph and this name are the ONLY carriers.
     */
    expect(screen.getByLabelText('Above typical (caution)')).toBeDefined();
    expect(screen.queryByLabelText(/^Sale \(/)).toBeNull();
  });

  it('draws a tone nothing recognises as neutral rather than dropping the words', () => {
    /*
     * Through the package's real reader, which COERCES an unknown tone rather
     * than dropping the badge: a later server inventing `tone: 'info'` must
     * not delete the words "Final sale" to protect the colour of a border.
     */
    draw({
      v: 1,
      blocks: [{ type: 'card', title: 'x', badge: { text: 'Final sale', tone: 'info' } }],
    });
    /*
     * The visible text is the words and nothing else — `getByText` is exact,
     * so a glyph prefix would fail it — and there is no tone suffix in the
     * accessible name either, because `neutral` is the absence of a claim.
     *
     * NOT written as `queryByText(/Final sale$/)).toBeDefined()`, which is
     * how this assertion started: `queryBy*` returns null when it finds
     * nothing and `expect(null).toBeDefined()` passes, so that line asserted
     * nothing at all.
     */
    expect(screen.getByText('Final sale')).toBeDefined();
    expect(screen.queryByLabelText(/Final sale \(/)).toBeNull();
  });

  /*
   * These four replaced one test that pinned the OPPOSITE ruling — "shows the
   * reaction pair, named, and deliberately NOT pressable" — and it was right
   * to exist and right to fail. It asserted `queryAllByRole('button')` was
   * empty and `rest.postback` was never called, which held the line until the
   * widget settled the wire spelling. It did (`card.reaction` as the `value`,
   * `{ card, reaction }` as the `payload`), so the ruling changed and its test
   * went with it. A pin on a deliberate gap is not a test you keep passing by
   * leaving the gap open.
   */
  it('offers the pair as toggle buttons with accessible names', () => {
    draw({
      v: 1,
      blocks: [{ type: 'card', title: 'Wool hat', reactions: ['like', 'dislike'] }],
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByLabelText('Helpful')).toBeDefined();
    expect(screen.getByLabelText('Not helpful')).toBeDefined();
    // The words are visible too, not only in the label: an emoji thumb is
    // announced by its unicode name by some readers and by nothing by others.
    expect(screen.getByText('Helpful')).toBeDefined();
  });

  /*
   * The wire shape, asserted on what the SDK SENT. A fake transport that
   * echoes whatever it was handed agrees with any spelling — which is how
   * four mobile SDKs shipped a visitor contract the server does not speak,
   * all four with green suites.
   */
  it('sends card.reaction as a silent postback with the card id in the payload', () => {
    const { rest } = draw({
      v: 1,
      blocks: [{ type: 'card', id: 'c1', title: 'Wool hat', reactions: ['like'] }],
    });
    fireEvent.click(screen.getByLabelText('Helpful'));
    expect(rest.postback).toHaveBeenCalledWith('conv-1', {
      value: 'card.reaction',
      payload: { card: 'c1', reaction: 'like' },
      silent: true,
    });
    /*
     * And the component updated ITSELF. Without this, a version that posted
     * the reaction and never re-rendered would pass every assertion above —
     * the shopper taps, nothing visibly happens, and they tap again.
     */
    expect(screen.getByLabelText('Helpful').getAttribute('aria-pressed')).toBe('true');
  });

  /* Clearing sends an explicit null, so a bot can tell "took it back" from
   * "never rated it". */
  it('sends reaction: null when the active thumb is pressed again', () => {
    const { rest } = draw({
      v: 1,
      blocks: [{ type: 'card', id: 'c1', title: 'Wool hat', reactions: ['like'] }],
    });
    fireEvent.click(screen.getByLabelText('Helpful'));
    fireEvent.click(screen.getByLabelText('Helpful'));
    expect(rest.postback).toHaveBeenLastCalledWith('conv-1', {
      value: 'card.reaction',
      payload: { card: 'c1', reaction: null },
      silent: true,
    });
  });

  /*
   * The author-set chosen thumb. Reopening the app is a fresh mount, so this
   * is the "survives a reload" case on native: without it the shopper comes
   * back to an un-pressed thumb on a card the bot is still ranking against.
   */
  it('seeds the thumb the author set', () => {
    draw({
      v: 1,
      blocks: [
        {
          type: 'card',
          id: 'c1',
          title: 'Wool hat',
          reactions: ['like', 'dislike'],
          reaction: 'dislike',
        },
      ],
    });
    expect(screen.getByLabelText('Helpful').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Not helpful').getAttribute('aria-pressed')).toBe('true');
  });

  /* And the visitor can still take back a verdict the bot set. */
  it('lets the visitor clear an author-set reaction', () => {
    const { rest } = draw({
      v: 1,
      blocks: [
        { type: 'card', id: 'c1', title: 'Wool hat', reactions: ['dislike'], reaction: 'dislike' },
      ],
    });
    const thumb = screen.getByLabelText('Not helpful');
    expect(thumb.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(thumb);
    expect(rest.postback).toHaveBeenCalledWith('conv-1', {
      value: 'card.reaction',
      payload: { card: 'c1', reaction: null },
      silent: true,
    });
    expect(screen.getByLabelText('Not helpful').getAttribute('aria-pressed')).toBe('false');
  });

  /*
   * A chosen reaction the card does not OFFER is dropped by the reader, so no
   * surface draws a pressed thumb with no control behind it.
   */
  it('ignores a chosen reaction the card does not offer', () => {
    draw({
      v: 1,
      blocks: [
        { type: 'card', id: 'c1', title: 'Wool hat', reactions: ['like'], reaction: 'dislike' },
      ],
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByLabelText('Helpful').getAttribute('aria-pressed')).toBe('false');
  });

  /* A card with no `id` sends no `card` key — not a positional fallback,
   * whose meaning would change when the grid is patched. */
  it('omits the card key when the card has no id', () => {
    const { rest } = draw({
      v: 1,
      blocks: [{ type: 'card', title: 'Wool hat', reactions: ['dislike'] }],
    });
    fireEvent.click(screen.getByLabelText('Not helpful'));
    const payload = (rest.postback as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[1] as {
      payload: Record<string, unknown>;
    };
    expect('card' in payload.payload).toBe(false);
    expect(payload.payload['reaction']).toBe('dislike');
  });

  it('renders all thirteen card actions as live buttons, with no overflow menu', () => {
    /*
     * `MAX_CARD_ACTIONS` is thirteen and `MAX_CARD_ACTIONS_VISIBLE` is five.
     * The five is what a 380px web panel fits before the buttons start a third
     * row; here they wrap in a `flexWrap` row inside a scrolling list, so
     * every one renders and there is no popover to open.
     */
    draw({
      v: 1,
      blocks: [
        {
          type: 'card',
          title: 'x',
          actions: Array.from({ length: 13 }, (_, i) => ({
            kind: 'postback',
            label: `Act ${String(i)}`,
            value: `v${String(i)}`,
          })),
        },
      ],
    });
    for (let i = 0; i < 13; i += 1) {
      expect(screen.getByRole('button', { name: `Act ${String(i)}` })).toBeDefined();
    }
    // Thirteen and nothing else — a "More" tile would be a fourteenth.
    expect(screen.getAllByRole('button')).toHaveLength(13);
    expect(screen.queryByText(/^More$/)).toBeNull();
  });

  it('renders a table as a scrollable grid, with each row naming both axes', () => {
    draw({
      v: 1,
      blocks: [
        {
          type: 'table',
          caption: 'Three hats',
          columns: [{ label: 'Wool', image: 'https://cdn.test/wool.png' }, { label: 'Felt' }],
          rows: [
            { label: 'Warmth', cells: ['High', 'Medium'] },
            { label: 'Price', cells: ['USD 48.20', 'USD 29.00'] },
          ],
        },
      ],
    });
    // The caption is OUTSIDE the scroller, so it cannot scroll out of view
    // sideways along with the last column.
    expect(screen.getByText('Three hats')).toBeDefined();
    expect(screen.getByLabelText('Comparison table')).toBeDefined();
    expect(screen.getByText('Wool')).toBeDefined();
    expect(screen.getByText('Felt')).toBeDefined();
    /*
     * The row's accessible name is what `<th scope="row">` buys a web surface
     * for free and a flex grid cannot: without it a screen reader reads a
     * comparison as a drift of loose values in document order.
     */
    expect(screen.getByLabelText('Warmth: Wool High, Felt Medium')).toBeDefined();
    expect(screen.getByLabelText('Price: Wool USD 48.20, Felt USD 29.00')).toBeDefined();
  });

  it('renders a column image small in the header, as decoration', () => {
    draw({
      v: 1,
      blocks: [
        {
          type: 'table',
          columns: [{ label: 'Wool', image: 'https://cdn.test/wool.png' }],
          rows: [{ label: 'Warmth', cells: ['High'] }],
        },
      ],
    });
    const image = screen.getByRole('presentation', { hidden: true });
    expect(image.getAttribute('src')).toBe('https://cdn.test/wool.png');
    /*
     * No accessible name, deliberately: the column's label sits right beside
     * it, so a name here would have a screen reader say "Wool, Wool".
     */
    expect(image.getAttribute('alt')).toBe('');
  });

  it('renders a SHORT table row as blanks, in the right columns', () => {
    /*
     * The one correctness rule in `BlockTable.tsx`: the cells are iterated
     * over `columns`, never over `row.cells`. A short row is legal — the write
     * boundary refuses only a row LONGER than the header, because an author
     * assembling a comparison out of a catalogue will have gaps — so walking
     * the row would shift every value left of a gap under the wrong heading.
     * That is a confident wrong answer about a product rather than a missing
     * one.
     */
    draw({
      v: 1,
      blocks: [
        {
          type: 'table',
          columns: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
          rows: [{ label: 'Price', cells: ['one'] }],
        },
      ],
    });
    // Named as a gap in the spoken version, rather than skipped.
    const row = screen.getByLabelText('Price: A one, B not given, C not given');
    // And drawn as blanks in the right places in the visual one: the attribute
    // then one cell per COLUMN, with the single value under A.
    // `Array.from` and not a spread: this package's `lib` has no `DOM.Iterable`,
    // so a `NodeListOf` is not iterable here.
    expect(Array.from(row.querySelectorAll('span')).map((s) => s.textContent)).toEqual([
      'Price',
      'one',
      '',
      '',
    ]);
  });

  it('draws nothing extra on a card that carries none of the three', () => {
    /*
     * The reader sets `badge`, `reactions` and the commerce keys only when
     * they are present. A renderer that drew an empty pill row, an empty
     * feedback line or a bordered blank table would be a hole in the thread.
     */
    draw({ v: 1, blocks: [{ type: 'card', title: 'Plain' }] });
    expect(screen.getByText('Plain')).toBeDefined();
    expect(screen.queryByText(/Helpful/)).toBeNull();
    expect(screen.queryByLabelText(/Feedback on this card/)).toBeNull();
    expect(screen.queryByLabelText('Comparison table')).toBeNull();
  });
});
