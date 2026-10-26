/** The composer's draft can be owned by the host (dictation, a tapped starter). */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatlyContext } from '../ChatlyProvider';
import { Composer } from './Composer';
import { defaultTheme } from '../theme/defaultTheme';

import type { ChatlyContextValue } from '../ChatlyProvider';

afterEach(cleanup);

function ctx() {
  const rest = { reply: vi.fn().mockResolvedValue({}) };
  const value = { theme: defaultTheme, rest } as unknown as ChatlyContextValue;
  return { rest, value };
}

describe('Composer value / onChangeText', () => {
  it('shows the host value, reports typing, and sends the host value', async () => {
    const { rest, value } = ctx();
    function Host() {
      const [draft, setDraft] = useState('from speech');
      return <Composer conversationId="c1" value={draft} onChangeText={setDraft} />;
    }
    render(
      <ChatlyContext.Provider value={value}>
        <Host />
      </ChatlyContext.Provider>,
    );
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type a message…');
    expect(input.value).toBe('from speech');
    fireEvent.change(input, { target: { value: 'edited' } });
    expect(input.value).toBe('edited');
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect(rest.reply).toHaveBeenCalledWith('c1', 'edited', undefined));
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('still works uncontrolled', async () => {
    const { rest, value } = ctx();
    render(
      <ChatlyContext.Provider value={value}>
        <Composer conversationId="c1" />
      </ChatlyContext.Provider>,
    );
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type a message…');
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect(rest.reply).toHaveBeenCalledWith('c1', 'hi', undefined));
  });
});
