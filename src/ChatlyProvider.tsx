/**
 * <ChatlyProvider /> bootstraps the REST + realtime clients, restores the
 * persisted visitor token, fires `/v1/widget/init`, and exposes session state
 * to descendants via the `useChatly` hook.
 *
 * The provider is intentionally state-light: the heavy lifting (message lists,
 * composer state) lives in the components that use it. This keeps the public
 * context surface stable as we add features.
 */

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RealtimeClient } from './client/RealtimeClient';
import { RestClient } from './client/RestClient';
import { registerPushToken } from './push/registerPushToken';
import { defaultTheme } from './theme/defaultTheme';

import type {
  ChatlyConfig,
  ChatlyIdentity,
  ConversationSummary,
  InitResponse,
  PushTokenRegistration,
  SessionState,
} from './client/types';
import type { ChatlyTheme } from './theme/ChatlyTheme';

export interface ChatlyContextValue {
  config: ChatlyConfig;
  theme: ChatlyTheme;
  rest: RestClient;
  realtime: RealtimeClient;
  session: SessionState | null;
  init: InitResponse | null;
  isReady: boolean;
  error: Error | null;
  unreadCount: number;
  conversations: ConversationSummary[];
  /**
   * The conversation the realtime socket is scoped to, or null when no socket
   * is open.
   *
   * A visitor's realtime token names ONE conversation — see
   * `RestClient.mintRealtimeToken` — so there is no such thing as a
   * session-wide visitor socket. The provider opens one when a conversation
   * becomes active and closes it when none is.
   */
  activeConversationId: string | null;
  /**
   * Scope live delivery to a conversation, or pass null to close the socket.
   *
   * `MessagesList` calls this for you; call it yourself if you render your own
   * thread. Switching re-mints and reconnects, because reusing the socket
   * would keep delivering the previous conversation's events.
   */
  setActiveConversation: (conversationId: string | null) => void;
  /**
   * Why live delivery is not running, if it is not.
   *
   * Deliberately separate from `error`: a refused realtime mint (a 404 for
   * somebody else's conversation, a 403 on a channel with an origin
   * allow-list, which a native app cannot satisfy) leaves the thread working
   * over REST. Blanking the chat for it would be worse than the degradation.
   */
  realtimeError: Error | null;
  identify: (identity: ChatlyIdentity) => Promise<void>;
  logout: () => Promise<void>;
  setPushToken: (registration: PushTokenRegistration) => Promise<void>;
  refresh: () => Promise<void>;
  /**
   * What the APP does about a `host_event` card action.
   *
   * The one feature a native SDK exists for. A card saying "Pay $48.20" has
   * to run with the buyer's real session — a native payment sheet, the app's
   * own cart, a screen push — and none of that can happen inside a chat
   * library. So the renderer does nothing for a `host_event` and calls this.
   *
   * Report the outcome back with `rest.reportAction`, which appends the
   * visible line under the card and tells the owning bot. Not reporting is a
   * shopper looking at a card with nothing under it and a bot that asks
   * again.
   *
   * `undefined` when the consumer did not supply one, and the renderer then
   * draws the button and the tap does nothing — which is the right failure:
   * a card that renders without its buttons would hide that the integrator
   * has work to do.
   */
  onAction?: ((event: ChatlyActionEvent) => void) | undefined;
}

/** One `host_event` tap, with everything needed to report the outcome. */
export interface ChatlyActionEvent {
  /** The author's own event name, e.g. `add_to_cart`. */
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly conversationId: string | null;
  readonly messageId: string;
  /** Pass this back to `reportAction` so the result lands under the card. */
  readonly actionId: string;
}

export const ChatlyContext = createContext<ChatlyContextValue | null>(null);

export interface ChatlyProviderProps {
  config: ChatlyConfig;
  theme?: Partial<ChatlyTheme>;
  children: React.ReactNode;
  /** See `ChatlyContextValue.onAction`. */
  onAction?: (event: ChatlyActionEvent) => void;
}

export function ChatlyProvider({
  config,
  theme,
  children,
  onAction,
}: ChatlyProviderProps): React.JSX.Element {
  const rest = useMemo(() => new RestClient(config), [config]);
  const realtime = useMemo(() => new RealtimeClient(config), [config]);

  const mergedTheme = useMemo<ChatlyTheme>(() => mergeTheme(defaultTheme, theme), [theme]);

  const [session, setSession] = useState<SessionState | null>(null);
  const [init, setInit] = useState<InitResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<Error | null>(null);
  const mounted = useRef(true);

  const bootstrap = useCallback(
    async (identity?: ChatlyIdentity): Promise<void> => {
      try {
        const result = await rest.init(identity);
        if (!mounted.current) {
          return;
        }
        setInit(result);
        setSession(result.session);
        /*
         * No socket here on purpose.
         *
         * This used to be `realtime.connect(session, session.token)` plus a
         * subscribe to `contact:<id>`, and neither could work: the gateway
         * does not accept the session token (it verifies an unlabelled
         * handshake as an agent, RS256) and does not read a subscribe frame
         * from a visitor at all. A visitor socket is minted per CONVERSATION
         * and opened by the effect below.
         */
        try {
          const list = await rest.listConversations();
          if (mounted.current) {
            setConversations(list.conversations);
          }
        } catch {
          // Non-fatal: surface as zero conversations rather than blocking init.
        }
      } catch (err) {
        if (mounted.current) {
          setError(err as Error);
        }
      }
    },
    // No `realtime` any more: bootstrap no longer opens a socket, because a
    // visitor socket is per-conversation. The effect below owns it.
    [rest],
  );

  useEffect(() => {
    mounted.current = true;
    void bootstrap();
    return (): void => {
      mounted.current = false;
      realtime.disconnect();
    };
  }, [bootstrap, realtime]);

  /**
   * The visitor socket: one conversation, one minted token.
   *
   * Re-runs on a switch, and `connect()` disconnects the previous socket
   * synchronously before it awaits the mint, so the two never overlap.
   */
  useEffect(() => {
    if (session === null || activeConversationId === null) {
      realtime.disconnect();
      return undefined;
    }
    setRealtimeError(null);
    realtime
      .connect({
        session,
        conversationId: activeConversationId,
        mintToken: (conversationId) => rest.mintRealtimeToken(conversationId),
      })
      .catch((err: unknown) => {
        if (mounted.current) {
          // Live delivery is off; the thread still works over REST.
          setRealtimeError(err as Error);
        }
      });
    return (): void => {
      realtime.disconnect();
    };
  }, [realtime, rest, session, activeConversationId]);

  const setActiveConversation = useCallback((conversationId: string | null): void => {
    setActiveConversationId(conversationId);
  }, []);

  // Refresh conversation summaries on inbound message events.
  useEffect(() => {
    const off = realtime.on('message.created', () => {
      void rest
        .listConversations()
        .then((res) => {
          if (mounted.current) {
            setConversations(res.conversations);
          }
        })
        .catch(() => undefined);
    });
    return off;
  }, [realtime, rest]);

  const unreadCount = useMemo(
    () => conversations.reduce((acc, c) => acc + (c.unreadContactCount ?? 0), 0),
    [conversations],
  );

  const identify = useCallback(
    async (identity: ChatlyIdentity): Promise<void> => {
      await bootstrap(identity);
    },
    [bootstrap],
  );

  const logout = useCallback(async (): Promise<void> => {
    setActiveConversationId(null);
    realtime.disconnect();
    await rest.clearToken();
    setSession(null);
    setInit(null);
    setConversations([]);
    setRealtimeError(null);
  }, [realtime, rest]);

  const setPushToken = useCallback(
    async (registration: PushTokenRegistration): Promise<void> => {
      await registerPushToken(rest, registration);
    },
    [rest],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await rest.listConversations();
      if (mounted.current) {
        setConversations(res.conversations);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err as Error);
      }
    }
  }, [rest]);

  const value = useMemo<ChatlyContextValue>(
    () => ({
      config,
      theme: mergedTheme,
      rest,
      realtime,
      session,
      init,
      isReady: session !== null,
      error,
      unreadCount,
      conversations,
      activeConversationId,
      setActiveConversation,
      realtimeError,
      identify,
      logout,
      setPushToken,
      refresh,
      onAction,
    }),
    [
      config,
      mergedTheme,
      rest,
      realtime,
      session,
      init,
      error,
      unreadCount,
      conversations,
      activeConversationId,
      setActiveConversation,
      realtimeError,
      identify,
      logout,
      setPushToken,
      refresh,
      onAction,
    ],
  );

  return <ChatlyContext.Provider value={value}>{children}</ChatlyContext.Provider>;
}

function mergeTheme(base: ChatlyTheme, override?: Partial<ChatlyTheme>): ChatlyTheme {
  if (override === undefined) {
    return base;
  }
  return {
    colors: { ...base.colors, ...(override.colors ?? {}) },
    radius: { ...base.radius, ...(override.radius ?? {}) },
    spacing: { ...base.spacing, ...(override.spacing ?? {}) },
    typography: { ...base.typography, ...(override.typography ?? {}) },
  };
}
