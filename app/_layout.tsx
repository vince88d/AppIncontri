import * as ScreenCapture from 'expo-screen-capture';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Alert, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const lastAlertAt = useRef(0);

  useEffect(() => {
    let subscription: ReturnType<typeof ScreenCapture.addScreenshotListener> | null = null;

    const enableScreenCaptureProtection = async () => {
      try {
        await ScreenCapture.preventScreenCaptureAsync();
      } catch {
        // Best-effort: some platforms do not allow full prevention.
      }

      try {
        subscription = ScreenCapture.addScreenshotListener(() => {
          const now = Date.now();
          if (now - lastAlertAt.current < 2000) {
            return;
          }
          lastAlertAt.current = now;
          Alert.alert('Impossibile fare screenshot');
        });
      } catch {
        // Best-effort: not all runtimes expose screenshot events.
      }
    };

    void enableScreenCaptureProtection();

    return () => {
      subscription?.remove();
      void ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    };
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="profile/[id]" />
        <Stack.Screen name="profile/setup" />
      </Stack>
      <StatusBar
        style={colorScheme === 'dark' ? 'light' : 'dark'}
        backgroundColor={palette.background}
        translucent={false}
      />
    </>
  );
}
