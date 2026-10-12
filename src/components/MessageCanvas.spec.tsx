/**
 * The Tier 2 canvas on a native screen.
 *
 * ── The two properties that are easy to get wrong ──────────────────────
 *
 * The canvas on screen must be REPLACED by whatever the submission returns.
 * A refused submission comes back as the same canvas with messages on it and
 * a changed total comes back as a FRESH step rather than a charge — so a
 * renderer that kept rendering its prop would show the shopper the old price
 * beside the new errors, and would show a stale "Confirm · $48.20" after the
 * server had already quoted $51.
 *
 * And a `hostEvent` on the answer must reach the APP. That is how 3-D Secure
 * works on a phone: the step says "now run this", the app runs it natively.
 * A renderer that swallowed it would leave a payment half-done with nothing
 * on screen to say so.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from '../ChatlyProvider';
import { MessageCanvas } from './MessageCanvas';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyActionEvent, ChatlyContextValue } from '../ChatlyProvider';

afterEach(cleanup);

const CONV = 'conv-1';

const CANVAS = {
  v: 1,
  canvasId: 'buy-nd10',
  title: 'Confirm purchase · $48.20',
  fields: [
    { type: 'text', name: 'note', label: 'Gift note', placeholder: 'Optional' },
    { type: 'checkbox', name: 'gift', label: 'Send as a gift' },
  ],
  actions: [
    { id: 'confirm', kind: 'submit', label: 'Buy now', style: 'primary' },
    { id: 'cancel', kind: 'cancel', label: 'Not now' },
  ],
  state: 'quote:4820',
};

function harness(opts: {
  answer?: unknown;
  reject?: boolean;
  onAction?: (e: ChatlyActionEvent) => void;
}) {
  const submitCanvas = vi.fn(() =>
    opts.reject === true
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(opts.answer ?? { canvas: CANVAS, errors: {} }),
  );
  const value = {
    theme: defaultTheme,
    rest: { submitCanvas },
    ...(opts.onAction === undefined ? {} : { onAction: opts.onAction }),
  } as unknown as ChatlyContextValue;
  render(
    <ChatlyContext.Provider value={value}>
      <MessageCanvas canvas={CANVAS} conversationId={CONV} messageId="m1" />
    </ChatlyContext.Provider>,
  );
  return { submitCanvas };
}

describe('MessageCanvas', () => {
  it('renders the title, the fields and the actions', () => {
    harness({});
    expect(screen.getByText('Confirm purchase · $48.20')).toBeDefined();
    expect(screen.getByLabelText('Gift note')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeDefined();
  });

  it('submits the typed values, with a checkbox as a boolean', async () => {
    const h = harness({});
    await userEvent.type(screen.getByLabelText('Gift note'), 'happy birthday');
    await userEvent.click(screen.getByRole('button', { name: 'Send as a gift' }));
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => {
      expect(h.submitCanvas).toHaveBeenCalledWith(CONV, {
        messageId: 'm1',
        actionId: 'confirm',
        values: { note: 'happy birthday', gift: true },
      });
    });
  });

  it('REPLACES the step with what the server returned', async () => {
    // A changed total comes back as a fresh step rather than a charge. The
    // old title must be gone, or the shopper confirms a price that moved.
    const next = {
      canvas: { ...CANVAS, title: 'Price changed · $51.00' },
      errors: {},
    };
    harness({ answer: next });
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => {
      expect(screen.getByText('Price changed · $51.00')).toBeDefined();
    });
    expect(screen.queryByText('Confirm purchase · $48.20')).toBeNull();
  });

  it('shows a per-field error from a refused submission', async () => {
    harness({ answer: { canvas: CANVAS, errors: { note: 'Too long' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => {
      expect(screen.getByText('Too long')).toBeDefined();
    });
    // The form is still usable: the field is still there to fix.
    expect(screen.getByLabelText('Gift note')).toBeDefined();
  });

  it('hands a hostEvent on the answer to the APP', async () => {
    // 3-D Secure. The step asks; the app runs it natively.
    const onAction = vi.fn();
    harness({
      answer: {
        canvas: CANVAS,
        errors: {},
        hostEvent: { event: 'confirm_payment', data: { pi: 'pi_1' } },
      },
      onAction,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith({
        event: 'confirm_payment',
        data: { pi: 'pi_1' },
        conversationId: CONV,
        messageId: 'm1',
        actionId: 'confirm',
      });
    });
  });

  it('leaves the form usable when the submission never lands', async () => {
    harness({ reject: true });
    await userEvent.click(screen.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => {
      expect(screen.getByText('That did not go through. Try again.')).toBeDefined();
    });
    // Re-enabled, not stuck on the in-flight state: the shopper can retry and
    // the server is the only thing that can settle the price.
    expect(screen.getByRole('button', { name: 'Buy now' }).hasAttribute('disabled')).toBe(false);
  });

  it('renders nothing for a canvas with no canvasId', () => {
    // A form with nowhere to post is worse than no form.
    const value = { theme: defaultTheme, rest: {} } as unknown as ChatlyContextValue;
    const { container } = render(
      <ChatlyContext.Provider value={value}>
        <MessageCanvas canvas={{ v: 1, fields: [] }} conversationId={CONV} messageId="m1" />
      </ChatlyContext.Provider>,
    );
    expect(container.textContent).toBe('');
  });

  it('explains a Tier 3 app rather than opening a WebView', () => {
    // No sandbox attribute exists in React Native, and a WebView is the thing
    // a native SDK exists to avoid.
    const value = { theme: defaultTheme, rest: {} } as unknown as ChatlyContextValue;
    render(
      <ChatlyContext.Provider value={value}>
        <MessageCanvas
          canvas={{ v: 1, canvasId: 'c1', app: { url: 'https://x.test', title: 'Checkout' } }}
          conversationId={CONV}
          messageId="m1"
        />
      </ChatlyContext.Provider>,
    );
    expect(screen.getByText('Checkout opens outside the chat.')).toBeDefined();
  });
});
