import { useContext } from 'react';

import { ChatlyContext, type ChatlyContextValue } from './ChatlyProvider';

export function useChatly(): ChatlyContextValue {
  const ctx = useContext(ChatlyContext);
  if (ctx === null) {
    throw new Error('[@chatlychat/react-native] useChatly() must be called inside <ChatlyProvider>.');
  }
  return ctx;
}
