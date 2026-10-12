/**
 * Register a mobile push token (APNS / FCM) against the current widget
 * visitor session. Routes to the public `/v1/widget/push/register` endpoint
 * which the API exposes for SDK consumers.
 *
 * The RestClient maintains the `publicId` + `visitorToken` it persisted at
 * init time, so the caller only needs to provide `{ platform, token }`.
 */

import type { RestClient } from '../client/RestClient';
import type { ChatlyIdentity, PushPlatform, PushTokenRegistration } from '../client/types';

/**
 * Translate the SDK-facing platform vocab into the server's transport vocab.
 *   iOS native     → APNS
 *   Android native → FCM
 *   Expo           → FCM (Expo's push service tokenizes upstream to FCM/APNS,
 *                    but the device-side token we receive is an Expo push
 *                    token; the API service routes it via FCM-compatible
 *                    delivery)
 */
function toServerPlatform(p: PushPlatform): 'apns' | 'fcm' | 'web-push' {
  if (p === 'ios') {
    return 'apns';
  }
  // 'android' and 'expo' both route through the FCM-compatible path
  return 'fcm';
}

export async function registerPushToken(
  rest: RestClient,
  registration: PushTokenRegistration,
  _identity?: ChatlyIdentity,
): Promise<void> {
  await rest.registerPushToken({
    platform: toServerPlatform(registration.platform),
    token: registration.token,
    ...(registration.appVersion !== undefined ? { appVersion: registration.appVersion } : {}),
  });
}
