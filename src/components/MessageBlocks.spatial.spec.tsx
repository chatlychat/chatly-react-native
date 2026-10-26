/**
 * Spatial hints in the published RN renderer: a `place` is one accessible line
 * of text, and a model or a placement changes nothing about the card or grid.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from '../ChatlyProvider';
import { MessageBlocks } from './MessageBlocks';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyContextValue } from '../ChatlyProvider';

afterEach(cleanup);

const value = {
  theme: defaultTheme,
  rest: { postback: vi.fn(), reportAction: vi.fn(), reply: vi.fn() },
} as unknown as ChatlyContextValue;

const html = (blocks: unknown[]): string => {
  const { container, unmount } = render(
    <ChatlyContext.Provider value={value}>
      <MessageBlocks blocks={{ v: 1, blocks }} conversationId="c1" messageId="m1" />
    </ChatlyContext.Provider>,
  );
  const out = container.innerHTML;
  unmount();
  return out;
};

const MODEL = { url: 'https://cdn.example.com/dunk.glb', scale: 2, anchor: 'base' };
const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Dunk Low',
  subtitle: 'Panda',
  image: 'https://cdn.example.com/dunk.png',
  ...extra,
});

describe('spatial hints in the published RN renderer', () => {
  it('a card with a model renders the markup it rendered without one', () => {
    expect(html([{ type: 'card', ...body({ model: MODEL }) }])).toBe(
      html([{ type: 'card', ...body() }]),
    );
  });

  it('a grid with a placement renders the markup it rendered without one', () => {
    expect(
      html([{ type: 'card_grid', placement: 'wall', cards: [body({ model: MODEL }), body()] }]),
    ).toBe(html([{ type: 'card_grid', cards: [body(), body()] }]));
  });

  it('never puts a model URL in the markup', () => {
    expect(html([{ type: 'card', ...body({ model: MODEL }) }])).not.toContain('dunk.glb');
  });

  it('a place is one accessible line naming what it is, and never shows the ref', () => {
    const out = html([{ type: 'place', label: 'Front door', detail: 'Level 2', ref: 'nike/door' }]);
    expect(out).not.toContain('nike/door');
    render(
      <ChatlyContext.Provider value={value}>
        <MessageBlocks
          blocks={{ v: 1, blocks: [{ type: 'place', label: 'Front door', detail: 'Level 2' }] }}
          conversationId="c1"
          messageId="m1"
        />
      </ChatlyContext.Provider>,
    );
    expect(screen.getByLabelText('Place: Front door — Level 2')).toBeDefined();
    expect(screen.getByText('Front door — Level 2')).toBeDefined();
  });
});
