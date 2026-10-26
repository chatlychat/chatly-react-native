/**
 * Public entry point for `@chatlychat/react-native`.
 *
 * Everything callers should depend on is re-exported here. Anything not
 * exported is considered an internal implementation detail and may change.
 */

export { ChatlyProvider, ChatlyContext } from './ChatlyProvider';
export type {
  ChatlyActionEvent,
  ChatlyNavigateEvent,
  ChatlyNotice,
  ChatlyProviderProps,
  ChatlyContextValue,
} from './ChatlyProvider';

export { useChatly } from './useChatly';
export { useTyping } from './useTyping';

export { ChatlyWidget } from './ChatlyWidget';
export type { ChatlyWidgetProps } from './ChatlyWidget';

export { MessagesList } from './components/MessagesList';
export type { MessagesListProps } from './components/MessagesList';

export { Composer } from './components/Composer';
export type { ComposerProps } from './components/Composer';
/**
 * What `pickAttachment` returns. Exported because a host writing a picker has
 * to name the type, and without it the only way to reach it was
 * `ComposerProps['pickAttachment']` (Crossly, 2026-10-26).
 */
export type { PickedAttachment } from './attachments';

export { MessageBubble } from './components/MessageBubble';
export type { MessageBubbleProps } from './components/MessageBubble';

export { MessageBlocks } from './components/MessageBlocks';
export type { MessageBlocksProps } from './components/MessageBlocks';

export { MessageCanvas } from './components/MessageCanvas';
export type { MessageCanvasProps } from './components/MessageCanvas';

/**
 * The block vocabulary and its READER, exported.
 *
 * A consumer who wants their own card design — a real markdown renderer, a
 * native clipboard, a video player — renders from the envelope themselves
 * rather than forking the component. `readBlocksEnvelope` is what makes that
 * safe: it is the same refusal the server-side renderers apply, so a custom
 * renderer cannot accidentally draw something the rest of the product would
 * reject.
 */
export { readBlocksEnvelope, isSafeMediaSrc } from './blocks/read-envelope';
export { readCanvas } from './blocks/read-canvas';
export { computeCanvasTotal, visibleInputIds } from './blocks/canvas-total';
export { formatMoney, moneyToPlainText, readMoney } from './blocks/money';
export { BLOCK_PROTOCOL_VERSION } from './blocks/types';
export type { Money } from './blocks/money';
export type {
  CanvasAction,
  CanvasField,
  WidgetAction,
  WidgetBlock,
  WidgetBlocksEnvelope,
  WidgetCanvas,
  WidgetCard,
} from './blocks/types';

export { HelpCenter } from './components/HelpCenter';
export type { HelpCenterProps } from './components/HelpCenter';

export { ChatlyRequestError, RestClient } from './client/RestClient';
export { RealtimeClient } from './client/RealtimeClient';
export type {
  MintedRealtimeToken,
  RealtimeConnectInput,
  RealtimeTokenMinter,
} from './client/RealtimeClient';

export { IdentityStore, TokenStore } from './storage/TokenStore';
export type { ChatlyStorage, StoredIdentity } from './storage/TokenStore';

export { registerPushToken } from './push/registerPushToken';

export { darkDefaultTheme, defaultTheme } from './theme/defaultTheme';
export { resolveChatlyTheme } from './theme/resolveTheme';
export { themeFromBranding } from './theme/widget-theme-map';
/*
 * `ChatlyThemeOverrides` is the type of the `theme` prop, and it was
 * unreachable: a consumer could pass an override object (the prop is typed on
 * `ChatlyProviderProps`) but could not NAME its type to build one in a
 * variable or a function return. `Partial<ChatlyTheme>` was the obvious guess
 * and it is wrong — it makes the four groups optional and their contents
 * required, so `{ colors: { primary: '#f00' } }` does not typecheck.
 */
export type { ChatlyColorScheme, ChatlyTheme, ChatlyThemeOverrides } from './theme/ChatlyTheme';

export type {
  Attachment,
  ChatlyConfig,
  ChatlyIdentity,
  ConversationStatus,
  ConversationSummary,
  ProfileView,
  TypingState,
  InitResponse,
  KbArticle,
  KbResult,
  MessageAuthor,
  MessageCreatedPayload,
  MessageKind,
  MessageRow,
  PushPlatform,
  PushTokenRegistration,
  RealtimeEnvelope,
  RealtimeEventType,
  SessionState,
  StartResponse,
} from './client/types';
export { REALTIME_PROTOCOL_VERSION } from './client/types';
