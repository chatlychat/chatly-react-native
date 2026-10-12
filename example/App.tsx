/**
 * Minimal example app. Wraps the root in <ChatlyProvider /> and renders
 * <ChatlyWidget /> full-screen. Replace `publicId` with your workspace's
 * public id.
 */

import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';

import { ChatlyProvider, ChatlyWidget, useChatly } from '@chatlychat/react-native';

function Inner(): React.JSX.Element {
  const { identify, setPushToken } = useChatly();

  useEffect(() => {
    void identify({
      externalId: 'demo-user-123',
      email: 'demo@example.com',
      name: 'Demo User',
    });
  }, [identify]);

  useEffect(() => {
    // Replace with a real token from `@react-native-firebase/messaging` or
    // `expo-notifications`. This call is safe to repeat; the server upserts.
    void setPushToken({ platform: 'ios', token: 'REPLACE_ME' });
  }, [setPushToken]);

  return <ChatlyWidget />;
}

export default function App(): React.JSX.Element {
  return (
    <View style={styles.fill}>
      <StatusBar barStyle="dark-content" />
      <ChatlyProvider config={{ publicId: 'pub_abc123', apiHost: 'api.chatlychat.com' }}>
        <Inner />
      </ChatlyProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
