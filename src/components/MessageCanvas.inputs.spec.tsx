/**
 * CRX-2: the server's canvas shape (`inputs`, `id`, `toggle`, `textarea`,
 * `visibleWhen`, option `adds`, `price`, `showTotal`) on a native screen.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readCanvas } from '../blocks/read-canvas';
import { ChatlyContext } from '../ChatlyProvider';
import { MessageCanvas } from './MessageCanvas';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyContextValue } from '../ChatlyProvider';

afterEach(cleanup);

const BUY = {
  v: 1,
  canvasId: 'buy',
  price: { amount: 13250, currency: 'USD' },
  inputs: [
    { type: 'toggle', id: 'gift', label: 'Send as a gift' },
    {
      type: 'textarea',
      id: 'message',
      label: 'Gift message',
      visibleWhen: { input: 'gift', equals: true },
    },
    {
      type: 'select',
      id: 'plan',
      label: 'Protection',
      options: [
        { value: 'none', label: 'None' },
        { value: 'two', label: '2 years', adds: { amount: 1299, currency: 'USD' } },
      ],
    },
  ],
  actions: [
    { id: 'buy', kind: 'submit', label: 'Confirm & buy', style: 'primary', showTotal: true },
  ],
};

function mount(canvas: unknown = BUY) {
  const submitCanvas = vi.fn(() => Promise.resolve({ canvas: BUY, errors: {} }));
  const value = { theme: defaultTheme, rest: { submitCanvas } } as unknown as ChatlyContextValue;
  render(
    <ChatlyContext.Provider value={value}>
      <MessageCanvas canvas={canvas} conversationId="c1" messageId="m1" />
    </ChatlyContext.Provider>,
  );
  return { submitCanvas };
}

describe('MessageCanvas inputs', () => {
  it('shows the running total on the button and moves it with a chosen option', async () => {
    mount();
    expect(screen.getByRole('button', { name: 'Confirm & buy · $132.50' })).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: /2 years/ }));
    expect(screen.getByRole('button', { name: 'Confirm & buy · $145.49' })).toBeDefined();
  });

  it('hides a visibleWhen input until its toggle is on, and omits it from the submission while hidden', async () => {
    const h = mount();
    expect(screen.queryByLabelText('Gift message')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Send as a gift' }));
    await userEvent.type(screen.getByLabelText('Gift message'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send as a gift' }));
    expect(screen.queryByLabelText('Gift message')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Confirm & buy/ }));
    await waitFor(() => expect(h.submitCanvas).toHaveBeenCalled());
    expect(h.submitCanvas).toHaveBeenCalledWith('c1', {
      messageId: 'm1',
      actionId: 'buy',
      values: { gift: false, plan: '' },
    });
  });

  it('does not sum a select hidden by visibleWhen', async () => {
    const hidden = {
      ...BUY,
      inputs: [
        BUY.inputs[0],
        { ...BUY.inputs[2], visibleWhen: { input: 'gift', equals: true }, value: 'two' },
      ],
    };
    mount(hidden);
    expect(screen.getByRole('button', { name: 'Confirm & buy · $132.50' })).toBeDefined();
  });

  it('shows no total when an option adds in another currency', () => {
    const mixed = JSON.parse(JSON.stringify(BUY)) as typeof BUY;
    (mixed.inputs[2] as { options: Array<{ adds?: unknown }> }).options[1]!.adds = {
      amount: 500,
      currency: 'EUR',
    };
    mount({ ...mixed, inputs: [{ ...mixed.inputs[2], value: 'two' }] });
    expect(screen.getByRole('button', { name: 'Confirm & buy' })).toBeDefined();
  });
});

describe('readCanvas', () => {
  it('still reads the old fields/name/checkbox shape as inputs/id/toggle', () => {
    const c = readCanvas({
      v: 1,
      canvasId: 'x',
      fields: [{ type: 'checkbox', name: 'a', label: 'A' }],
    });
    expect(c?.inputs).toEqual([{ id: 'a', label: 'A', type: 'toggle' }]);
  });

  it('drops the price when any adds is unusable, rather than under-count', () => {
    const c = readCanvas({
      ...BUY,
      inputs: [
        {
          type: 'select',
          id: 'p',
          label: 'P',
          options: [{ value: 'a', label: 'A', adds: { amount: -5, currency: 'USD' } }],
        },
      ],
    });
    expect(c?.price).toBeUndefined();
  });

  it('refuses a price above the cap', () => {
    expect(
      readCanvas({ ...BUY, price: { amount: 10_000_000_001, currency: 'USD' } })?.price,
    ).toBeUndefined();
  });
});
