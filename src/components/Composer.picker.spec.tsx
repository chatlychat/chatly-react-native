/**
 * The picker is a prop, and may return a uri.
 *
 * Both halves of Crossly's round-2 P1. The contract was a BYTES-ONLY global:
 * no Expo picker returns bytes, so every Expo app wrote a `fetch(uri)` read or
 * a base64 decoder first, and a global is set once per app where the picker a
 * screen wants is a per-screen choice.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from '../ChatlyProvider';
import { Composer } from './Composer';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyContextValue } from '../ChatlyProvider';

afterEach(() => {
  cleanup();
  delete globalThis.__chatlyPicker;
  vi.unstubAllGlobals();
});

function ctx() {
  const rest = {
    reply: vi.fn().mockResolvedValue({}),
    uploadAttachment: vi.fn().mockResolvedValue({ id: 'at_1', filename: 'photo.jpg' }),
  };
  return { rest, value: { theme: defaultTheme, rest } as unknown as ChatlyContextValue };
}

const attach = async (): Promise<void> => {
  fireEvent.click(screen.getByLabelText('Attach a file'));
};

describe('Composer pickAttachment', () => {
  it('uses the prop, and reads a uri the way an Expo picker returns one', async () => {
    const { rest, value } = ctx();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    );
    render(
      <ChatlyContext.Provider value={value}>
        <Composer
          conversationId="c1"
          pickAttachment={async () => ({ uri: 'file:///tmp/photo.jpg' })}
        />
      </ChatlyContext.Provider>,
    );
    await attach();
    await waitFor(() => expect(rest.uploadAttachment).toHaveBeenCalledTimes(1));
    const sent = rest.uploadAttachment.mock.calls[0]?.[0] as {
      bytes: Uint8Array;
      filename: string;
      mimeType: string;
    };
    // Bytes, from a picker that only ever gave a uri — the glue every Expo
    // integrator was writing.
    expect([...sent.bytes]).toEqual([1, 2, 3]);
    expect(sent.filename).toBe('photo.jpg');
    expect(sent.mimeType).toBe('image/jpeg');
  });

  it('prefers the prop over the global, so a screen can choose its own', async () => {
    const { rest, value } = ctx();
    globalThis.__chatlyPicker = vi.fn(async () => ({
      bytes: new Uint8Array([9]),
      filename: 'global.bin',
      mimeType: 'application/octet-stream',
    }));
    render(
      <ChatlyContext.Provider value={value}>
        <Composer
          conversationId="c1"
          pickAttachment={async () => ({ bytes: new Uint8Array([7]), filename: 'prop.bin' })}
        />
      </ChatlyContext.Provider>,
    );
    await attach();
    await waitFor(() => expect(rest.uploadAttachment).toHaveBeenCalledTimes(1));
    expect((rest.uploadAttachment.mock.calls[0]?.[0] as { filename: string }).filename).toBe(
      'prop.bin',
    );
    expect(globalThis.__chatlyPicker).not.toHaveBeenCalled();
  });

  it('still honours the global, which is what shipped apps are on', async () => {
    // 0.9.0 through 0.11.0 documented `globalThis.__chatlyPicker`. Dropping it
    // would break every app that followed the README.
    const { rest, value } = ctx();
    globalThis.__chatlyPicker = vi.fn(async () => ({
      bytes: new Uint8Array([9]),
      filename: 'global.bin',
      mimeType: 'application/octet-stream',
    }));
    render(
      <ChatlyContext.Provider value={value}>
        <Composer conversationId="c1" />
      </ChatlyContext.Provider>,
    );
    await attach();
    await waitFor(() => expect(rest.uploadAttachment).toHaveBeenCalledTimes(1));
    expect((rest.uploadAttachment.mock.calls[0]?.[0] as { filename: string }).filename).toBe(
      'global.bin',
    );
  });

  it('uploads nothing when the visitor cancels', async () => {
    const { rest, value } = ctx();
    render(
      <ChatlyContext.Provider value={value}>
        <Composer conversationId="c1" pickAttachment={async () => null} />
      </ChatlyContext.Provider>,
    );
    await attach();
    await waitFor(() => expect(rest.reply).not.toHaveBeenCalled());
    expect(rest.uploadAttachment).not.toHaveBeenCalled();
  });
});
