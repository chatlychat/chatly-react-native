/**
 * <ChatlyProvider /> bootstraps the REST + realtime clients, restores the
 * persisted visitor token, fires `/v1/widget/init`, resolves the theme from
 * the workspace's own branding, and exposes session state to descendants via
 * the `useChatly` hook.
 *
 * The provider is intentionally state-light: the heavy lifting (message lists,
 * composer state) lives in the components that use it. This keeps the public
 * context surface stable as we add features.
 */

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RealtimeClient } from './client/RealtimeClient';
import { RestClient } from './client/RestClient';
import { registerPushToken } from './push/registerPushToken';
import { resolveChatlyTheme } from './theme/resolveTheme';
import { useDeviceColorScheme } from './theme/useDeviceColorScheme';
import { resolveColorScheme } from './theme/widget-theme-map';

import type {
  ChatlyConfig,
  ChatlyIdentity,
  ConversationSummary,
  InitResponse,
  ProfileView,
  PushTokenRegistration,
  SessionState,
} from './client/types';
import type { ChatlyColorScheme, ChatlyTheme, ChatlyThemeOverrides } from './theme/ChatlyTheme';

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
  /**
   * The audience profile this visitor matches (`POST /v1/widget/profile/resolve`):
   * `starterPrompts`, `quickLinks` and `copy`, the same ones the web widget
   * shows. Null until resolved, and null if the call failed (draw your own
   * defaults then). Re-resolved after `identify()`.
   */
  profile: ProfileView | null;
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
  /**
   * Route a `url` action yourself instead of handing it to the OS.
   *
   * ── Why an app needs this ──────────────────────────────────────────────
   *
   * A `url` action calls `Linking.openURL`, which leaves the app — and for a
   * link to the integrator's OWN content (a listing, a cart, a watchlist)
   * that is the wrong outcome twice over: the buyer loses their place, and
   * the destination is a screen the app already has. On the web the same
   * problem is solved by `target: 'self'`, honoured when the href is on the
   * embedding page's origin. A native app has no "embedding page", so the
   * equivalent is a hook: you get the href and decide.
   *
   * Return `true` when you handled it. Return `false` or `undefined` — or do
   * not supply the hook at all — and `Linking.openURL` runs as before, so
   * every existing integration is unchanged and an unrecognised URL still
   * reaches the browser rather than being swallowed.
   *
   * The href has already been through the same allow-list the web renderer
   * applies: an `https`, `mailto` or `tel` URL with no control characters,
   * and nothing else — no other scheme ever reaches `Linking.openURL`. It is still a value an author controls: match it against
   * routes you own, and let anything else fall through.
   */
  onOpenUrl?: ((href: string) => boolean | undefined) | undefined;
  /**
   * Route a `navigate` card action inside your app (ADR 0082).
   *
   * The action carries a PATH on your site (`/pricing?plan=pro`) that has
   * already been through the same guard the web widget applies: a single
   * leading `/`, no host, `//`, backslash, control character or `..` segment.
   * Hand it to your router. Return `true` when you handled it.
   *
   * Return `false` or `undefined` — or supply no hook — and the SDK opens
   * `config.siteOrigin + path` in the system browser when `siteOrigin` is set,
   * and does nothing otherwise (it will not guess a host).
   */
  onNavigate?: ((event: ChatlyNavigateEvent) => boolean | undefined) | undefined;
  /**
   * An ephemeral one-line toast answering one of this visitor's silent
   * postbacks (ADR 0082). Not a message: it is never in the thread, and it
   * only arrives over the live socket. Show it however your app shows toasts.
   */
  onNotice?: ((notice: ChatlyNotice) => void) | undefined;
}

/** One `navigate` tap. */
export interface ChatlyNavigateEvent {
  /** A validated site-relative path, e.g. `/pricing?plan=pro`. */
  readonly path: string;
  readonly label: string;
  readonly conversationId: string | null;
  readonly messageId: string;
  readonly actionId: string;
}

/** An ephemeral notice, as `onNotice` receives it. */
export interface ChatlyNotice {
  readonly conversationId: string;
  /** The id of the visitor message (the press) this answers. */
  readonly replyTo: string;
  readonly body: string;
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
  /**
   * Explicit theme values for this screen. They beat the workspace's
   * configured theme — the precedence and the reasoning are in
   * `theme/resolveTheme.ts`.
   *
   * Widened from `Partial<ChatlyTheme>`, which required every member of a
   * group once the group was named: see `ChatlyThemeOverrides`.
   */
  theme?: ChatlyThemeOverrides;
  /**
   * Force a palette instead of following the device.
   *
   * For an app with its own in-app light/dark switch that does not follow the
   * OS. Unset, the device's `useColorScheme()` decides, unless the workspace
   * pinned `colorScheme` to `light` or `dark` in the dashboard.
   */
  colorScheme?: ChatlyColorScheme;
  children: React.ReactNode;
  /** See `ChatlyContextValue.onAction`. */
  onAction?: (event: ChatlyActionEvent) => void;
  /** See `ChatlyContextValue.onOpenUrl`. */
  onOpenUrl?: (href: string) => boolean | undefined;
  /** See `ChatlyContextValue.onNavigate`. */
  onNavigate?: (event: ChatlyNavigateEvent) => boolean | undefined;
  /** See `ChatlyContextValue.onNotice`. */
  onNotice?: (notice: ChatlyNotice) => void;
}

export function ChatlyProvider({
  config,
  theme,
  colorScheme,
  children,
  onAction,
  onOpenUrl,
  onNavigate,
  onNotice,
}: ChatlyProviderProps): React.JSX.Element {
  const rest = useMemo(() => new RestClient(config), [config]);
  const realtime = useMemo(() => new RealtimeClient(config), [config]);

  const [session, setSession] = useState<SessionState | null>(null);
  const [init, setInit] = useState<InitResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<Error | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const mounted = useRef(true);

  /**
   * THE WORKSPACE'S OWN THEME, which this provider used to throw away.
   *
   * `init.branding` is the full theme the operator configured — workspace,
   * then brand, then channel, exactly as `POST /v1/widget/init` layers them.
   * It arrived on every boot, was typed `Record<string, unknown>`, and no
   * component read it: the provider seeded from `defaultTheme` and an
   * integrator prop, so a customer who themed their widget in the dashboard
   * saw a Chatly blue in their native app.
   *
   * `theme/widget-theme-map.ts` is the translation and names every web field
   * it cannot carry. `theme/resolveTheme.ts` is the precedence.
   *
   * It re-resolves when `init` arrives, which means the first paint of a cold
   * start is the DEFAULT palette and the themed one lands a request later.
   * That is the honest shape of the thing — the theme is remote config and
   * there is nothing to show it before the response — and it is why the
   * defaults are a deliberate neutral rather than a placeholder.
   */
  const deviceScheme = useDeviceColorScheme();
  const branding = init?.branding;
  const scheme = useMemo(
    () => resolveColorScheme(branding, colorScheme, deviceScheme),
    [branding, colorScheme, deviceScheme],
  );
  const mergedTheme = useMemo<ChatlyTheme>(
    () => resolveChatlyTheme({ branding, overrides: theme, scheme }),
    [branding, theme, scheme],
  );

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
          const resolved = await rest.resolveProfile();
          if (mounted.current) {
            setProfile(resolved);
          }
        } catch {
          // Non-fatal: the app falls back to its own defaults.
        }
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

  /*
   * The ephemeral toast (ADR 0082). Held in a ref so a new `onNotice` closure
   * does not re-subscribe, and filtered on the active conversation because the
   * socket is scoped to ONE and a stray envelope must not toast in another.
   */
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  useEffect(() => {
    return realtime.on<{ conversationId?: unknown; replyTo?: unknown; body?: unknown }>(
      'message.notice',
      (envelope) => {
        const p = envelope.payload;
        if (
          typeof p.conversationId === 'string' &&
          p.conversationId === activeConversationId &&
          typeof p.replyTo === 'string' &&
          typeof p.body === 'string' &&
          p.body !== ''
        ) {
          noticeRef.current?.({
            conversationId: p.conversationId,
            replyTo: p.replyTo,
            body: p.body,
          });
        }
      },
    );
  }, [realtime, activeConversationId]);

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
    setProfile(null);
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
      profile,
      identify,
      logout,
      setPushToken,
      refresh,
      onAction,
      onOpenUrl,
      onNavigate,
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
      profile,
      identify,
      logout,
      setPushToken,
      refresh,
      onAction,
      onOpenUrl,
      onNavigate,
    ],
  );

  return <ChatlyContext.Provider value={value}>{children}</ChatlyContext.Provider>;
}
