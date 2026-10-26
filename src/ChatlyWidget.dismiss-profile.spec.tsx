/** Row action "Remove" calls `rest.dismiss`; the provider exposes `profile`. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext, ChatlyProvider } from './ChatlyProvider';
import { ChatlyWidget } from './ChatlyWidget';
import { defaultTheme } from './theme/defaultTheme';
import { useChatly } from './useChatly';

import type { ChatlyContextValue } from './ChatlyProvider';

afterEach(cleanup);

describe('<ChatlyWidget /> remove from list', () => {
  it('dismisses that conversation and refreshes the list', async () => {
    const rest = { dismiss: vi.fn().mockResolvedValue(undefined) };
    const refresh = vi.fn().mockResolvedValue(undefined);
    const value = {
      theme: defaultTheme,
      rest,
      refresh,
      isReady: true,
      error: null,
      init: null,
      conversations: [
        { id: 'c1', subject: 'Hats', lastMessagePreview: 'hi', unreadContactCount: 0 },
        { id: 'c2', subject: 'Shoes', lastMessagePreview: 'yo', unreadContactCount: 0 },
      ],
    } as unknown as ChatlyContextValue;
    render(
      <ChatlyContext.Provider value={value}>
        <ChatlyWidget enableHelpCenter={false} />
      </ChatlyContext.Provider>,
    );
    fireEvent.click(screen.getByLabelText('Remove conversation Shoes from this list'));
    await waitFor(() => expect(rest.dismiss).toHaveBeenCalledWith('c2'));
    expect(rest.dismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('ChatlyProvider profile', () => {
  it('resolves the profile after init and exposes it on useChatly()', async () => {
    const profile = {
      profile: 'vip',
      matched: true,
      starterPrompts: ['Hi'],
      quickLinks: [],
      copy: {},
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.endsWith('/init')
          ? {
              session: {
                token: 't',
                contactId: 'c',
                workspaceId: 'w',
                brandId: 'b',
                channelId: 'ch',
              },
              workspace: { id: 'w', name: 'W' },
            }
          : url.endsWith('/profile/resolve')
            ? profile
            : { conversations: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    function Probe() {
      const { profile: p } = useChatly();
      return <span>{p === null ? 'none' : p.starterPrompts.join(',')}</span>;
    }
    render(
      <ChatlyProvider
        config={{
          publicId: 'pub',
          storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        }}
      >
        <Probe />
      </ChatlyProvider>,
    );
    await waitFor(() => expect(screen.getByText('Hi')).toBeDefined());
  });
});
