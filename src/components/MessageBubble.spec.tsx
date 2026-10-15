/**
 * The bubble, with rich blocks and a canvas MOUNTED.
 *
 * ── Why the mount is the thing under test ──────────────────────────────
 *
 * A renderer that handles every block type and that nothing mounts passes
 * its own unit test and renders nowhere. That exact pair of defects shipped
 * in this product once already: the agent inbox mounted blocks inside an
 * `if (isNote)` early return so the AI answer the feature exists for never
 * reached it, and the mobile renderer was exported, spec'd, and imported by
 * nothing but its own spec. `check-block-renderer-parity.mjs` asserts the
 * mount literal is in this file and that THIS spec carries a block envelope;
 * it cannot tell which branches a component has, so the assertions below are
 * the half that reads the output.
 *
 * The interactive half matters as much. On the agent app every action is
 * plain text, because an agent has no visitor session; here a tap must reach
 * either the API or the integrator's own code, and `host_event` reaching the
 * app is the single feature this package exists for.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from '../ChatlyProvider';
import { MessageBubble } from './MessageBubble';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyActionEvent, ChatlyContextValue } from '../ChatlyProvider';
import type { MessageRow } from '../client/types';

const CONV = 'conv-1';

/*
 * Explicit, not inherited.
 *
 * `@testing-library/react` auto-cleans only when vitest runs with
 * `globals: true`, which this package does not. Without it each render
 * accumulates in the same document and `getByText` starts failing with
 * "found multiple elements" — which reads as a duplicate-render bug in the
 * component rather than as a missing afterEach. Three tests failed that way
 * before this line existed.
 */
afterEach(cleanup);

function harness(over: { onAction?: (e: ChatlyActionEvent) => void } = {}) {
  const rest = {
    reply: vi.fn().mockResolvedValue({}),
    postback: vi.fn().mockResolvedValue({}),
    reportAction: vi.fn().mockResolvedValue({}),
    requestCanvasStep: vi.fn().mockResolvedValue({}),
    submitCanvas: vi.fn().mockResolvedValue({ canvas: null, errors: {} }),
  };
  const value = {
    theme: defaultTheme,
    rest,
    ...over,
  } as unknown as ChatlyContextValue;
  const wrap = (message: MessageRow) =>
    render(
      <ChatlyContext.Provider value={value}>
        <MessageBubble message={message} conversationId={CONV} />
      </ChatlyContext.Provider>,
    );
  return { rest, wrap };
}

const row = (over: Partial<MessageRow>): MessageRow => ({
  id: 'm1',
  authorType: 'bot',
  kind: 'text',
  body: 'Here are six hats',
  createdAt: '2026-10-12T00:00:00.000Z',
  ...over,
});

describe('MessageBubble + blocks', () => {
  it('renders the body and the card beside it', () => {
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [{ type: 'card', title: 'Wool hat', price: { amount: 4820, currency: 'USD' } }],
        },
      }),
    );
    expect(screen.getByText('Here are six hats')).toBeDefined();
    expect(screen.getByText('Wool hat')).toBeDefined();
    // Through the shared formatter: minor units, and the divisor read off the
    // currency rather than assumed to be 100.
    expect(screen.getByText('$48.20')).toBeDefined();
  });

  it('shows a was-price as words, not as a strike-through', () => {
    // RN has no `<s>` and `textDecorationLine` on a nested `Text` is
    // unreliable across the two platforms; "was" reads in a screen reader too.
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'card',
              title: 'Wool hat',
              price: { amount: 4820, currency: 'USD', compareAt: 6000 },
            },
          ],
        },
      }),
    );
    expect(screen.getByText('$48.20 (was $60.00)')).toBeDefined();
  });

  it('hands a host_event to the APP and calls no API', async () => {
    // The feature this package exists for: a native payment sheet cannot be
    // opened from inside a chat library.
    const onAction = vi.fn();
    const h = harness({ onAction });
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'actions',
              actions: [
                { kind: 'host_event', label: 'Pay', event: 'pay', id: 'a1', data: { x: 1 } },
              ],
            },
          ],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(onAction).toHaveBeenCalledWith({
      event: 'pay',
      data: { x: 1 },
      conversationId: CONV,
      messageId: 'm1',
      actionId: 'a1',
    });
    expect(h.rest.reply).not.toHaveBeenCalled();
    expect(h.rest.postback).not.toHaveBeenCalled();
  });

  it('sends a postback through the API, silently when asked', async () => {
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'actions',
              actions: [{ kind: 'postback', label: 'Under $50', value: 'under_50', silent: true }],
            },
          ],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Under $50' }));
    expect(h.rest.postback).toHaveBeenCalledWith(CONV, { value: 'under_50', silent: true });
  });

  it('sends a quick reply as an ordinary message', async () => {
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [{ type: 'quick_replies', options: [{ label: 'Under $50', value: 'under_50' }] }],
        },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Under $50' }));
    expect(h.rest.reply).toHaveBeenCalledWith(CONV, 'under_50');
  });

  it('renders a carousel as a scrollable row of every card', () => {
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'card_grid',
              layout: 'carousel',
              cards: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
            },
          ],
        },
      }),
    );
    expect(screen.getByLabelText('Scrollable options')).toBeDefined();
    for (const title of ['One', 'Two', 'Three']) {
      expect(screen.getByText(title)).toBeDefined();
    }
  });

  it('renders a status line — unlike the agent app, which skips it', () => {
    // There it is "progress, not content" for somebody reading history. Here
    // the shopper is watching it happen.
    const h = harness();
    h.wrap(row({ blocks: { v: 1, blocks: [{ type: 'status', id: 's1', text: 'Looking…' }] } }));
    expect(screen.getByText('Looking…')).toBeDefined();
  });

  it('drops an unsafe card image and keeps the card', () => {
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [{ type: 'card', title: 'Wool hat', image: 'javascript:alert(1)' }],
        },
      }),
    );
    expect(screen.getByText('Wool hat')).toBeDefined();
    expect(screen.queryByRole('img')).toBeNull();
  });

  /* ── The commerce fields on the shopper's own surface ─────────────────── */

  it('shows the variants and the stock state as a readout, with no picker', () => {
    /*
     * A readout and not a `<select>`, because nothing in the protocol carries
     * a chosen variant: a variant's `value` is never referenced by an action,
     * so a tappable option would have to invent a wire contract in a
     * published package. The shopper reads the run of sizes and asks.
     */
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'card',
              title: 'Dunk Low',
              stock: 'low',
              variants: [
                { label: 'US 9', value: 'sku-9', inStock: true },
                { label: 'US 10', value: 'sku-10' },
                { label: 'US 11', value: 'sku-11', inStock: false },
              ],
            },
          ],
        },
      }),
    );
    expect(screen.getByLabelText('Options').textContent).toBe(
      'Options: US 9, US 10, US 11 (unavailable)',
    );
    // In words: there is no badge colour to read on a Text surface.
    expect(screen.getByText('Low stock')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('makes a grid`s `more` tile a REAL button that pages the catalogue', async () => {
    /*
     * The one place this renderer differs from both agent surfaces, where the
     * tile is inert. This is the shopper's own app, so the thing the tile
     * exists for is a tap — and the label that renders is the TILE's, not the
     * action's.
     */
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'card_grid',
              cards: [{ title: 'One' }, { title: 'Two' }],
              more: {
                label: 'Show all 60',
                action: { kind: 'postback', label: 'More', value: 'page2' },
              },
            },
          ],
        },
      }),
    );
    expect(screen.getByText('One')).toBeDefined();
    expect(screen.getByText('Two')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 60' }));
    expect(h.rest.postback).toHaveBeenCalledWith(CONV, { value: 'page2', silent: false });
  });

  it('renders an order timeline, read-only, with the state in words', () => {
    const h = harness();
    h.wrap(
      row({
        blocks: {
          v: 1,
          blocks: [
            {
              type: 'order_status',
              steps: [
                { label: 'Ordered', state: 'done', at: '2026-10-10T09:00:00Z' },
                { label: 'Out for delivery', state: 'current' },
                { label: 'Delivered', state: 'pending' },
              ],
            },
          ],
        },
      }),
    );
    expect(screen.getByLabelText('Order status')).toBeDefined();
    const rows = screen.getByLabelText('Order status').textContent ?? '';
    /*
     * The date is formatted, so the assertion is on what a formatter produces
     * rather than on an exact string: the runner's timezone decides the rest.
     * The two failures worth catching are the ISO string reaching a shopper
     * and the words "Invalid Date" beside a milestone.
     */
    expect(rows).toContain('Ordered — Done · ');
    expect(rows).toContain('2026');
    expect(rows).not.toContain('2026-10-10T09:00:00Z');
    expect(rows).not.toMatch(/invalid/i);
    // No date on a step that has not happened, and no dangling separator.
    expect(rows).toContain('Out for delivery — In progress');
    expect(rows).toContain('Delivered — Pending');
    // Display-only: a timeline has no control in it, by design of the block.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing extra for a message with no blocks', () => {
    const h = harness();
    h.wrap(row({}));
    expect(screen.getByText('Here are six hats')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a system line WITHOUT blocks — a system message is never a card', () => {
    const h = harness();
    h.wrap(
      row({
        authorType: 'system',
        body: 'Buyer support is taking over from here.',
        blocks: { v: 1, blocks: [{ type: 'card', title: 'Should not render' }] },
      }),
    );
    expect(screen.getByText('Buyer support is taking over from here.')).toBeDefined();
    expect(screen.queryByText('Should not render')).toBeNull();
  });
});
