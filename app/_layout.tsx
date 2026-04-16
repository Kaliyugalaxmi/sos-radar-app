// app/_layout.tsx
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { onValue, ref, get } from 'firebase/database';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { rtdb } from '../config/firebase';
import { getOrCreateDeviceId } from '../services/deviceId';
import { getOrCreateProfile, updatePushToken } from '../services/friends';
import { getExpoPushToken } from '../services/notifications';
import { useAppStore } from '../store/useAppStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { setDeviceId, setNickname, setFriends, setPendingRequests, setOutgoingRequests, loadContactsFromStorage, setInitialized } = useAppStore();
  const router = useRouter();

  useEffect(() => {
    initializeApp();
  }, []);

  async function initializeApp() {
    try {
      // Step 1: Device ID get karo (signup nahi, device-based)
      const deviceId = await getOrCreateDeviceId();
      setDeviceId(deviceId);

      // Step 2: Contacts load karo AsyncStorage se
      await loadContactsFromStorage();

      // Step 3: Firebase profile sync (optional, friends feature ke liye)
      try {
        const profile = await getOrCreateProfile(deviceId);
        setNickname(profile.nickname ?? '');
        setPendingRequests(profile.pendingRequests ?? []);
        setOutgoingRequests((profile as any).outgoingRequests ?? []);

        // Helper to resolve friend IDs into friend objects with nickname
        async function resolveFriends(friendIds: any): Promise<any[]> {
          const ids: string[] = Array.isArray(friendIds) ? friendIds : [];
          const results = await Promise.all(
            ids.map(async (id) => {
              try {
                const snap = await get(ref(rtdb, `users/${id}`));
                const nick = snap.exists() ? snap.val().nickname ?? id : id;
                return { deviceId: id, nickname: nick, isInEmergency: false };
              } catch {
                return { deviceId: id, nickname: id, isInEmergency: false };
              }
            })
          );
          return results;
        }

        const resolved = await resolveFriends(profile.friends ?? []);
        setFriends(resolved);

        // Subscribe to realtime profile updates so UI reflects accepts/rejections
        const lastSOSSeenTs = { value: 0 };
        const profileRef = ref(rtdb, `users/${deviceId}`);
        const unsubscribe = onValue(profileRef, async (snap) => {
          if (snap.exists()) {
            const p: any = snap.val();
            setNickname(p.nickname ?? '');
            setPendingRequests(p.pendingRequests ?? []);
            setOutgoingRequests(p.outgoingRequests ?? []);
            const resolvedLive = await resolveFriends(p.friends ?? []);
            setFriends(resolvedLive);

            // In-app alert handling: if a friend wrote lastSOSAlert, show an Alert to the user
            try {
              const alert = p.lastSOSAlert;
              if (alert && alert.timestamp && alert.timestamp > lastSOSSeenTs.value) {
                lastSOSSeenTs.value = alert.timestamp;
                const from = alert.fromDeviceId ?? 'Friend';
                const addr = alert.address ?? '';
                Alert.alert(
                  'SOS Nearby',
                  `${from} started an SOS. ${addr ? '\n' + addr : ''}`,
                  [{ text: 'Open Radar', onPress: () => {} }, { text: 'Dismiss', style: 'cancel' }]
                );
              }
            } catch (err) {
              // ignore alert errors
            }
          }
        });
        // keep listener until app unmount (no cleanup here since root lives whole app lifecycle)

        // Register for push notifications and save token to profile
        try {
          const pushToken = await getExpoPushToken();
          if (pushToken) {
            await updatePushToken(deviceId, pushToken);
          }
        } catch (err) {
          console.warn('push register failed', err);
        }
      } catch (e) {
        // Firebase offline ho toh bhi app kaam kare
        console.warn('Firebase profile sync failed - offline mode', e);
      }

      setInitialized(true);
    } catch (error) {
      console.error('App init error:', error);
      setInitialized(true); // Error hone par bhi app open ho
    } finally {
      await SplashScreen.hideAsync();
    }
  }

  // Notification response handler: when user taps a push, open Radar to session
  useEffect(() => {
    let subscription: any = null;
    (async () => {
      try {
        const Constants = await import('expo-constants');
        if (Constants?.default?.appOwnership === 'expo') return; // skip in Expo Go

        const Notifications = await import('expo-notifications');
        subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
          try {
            const data = response?.notification?.request?.content?.data ?? response?.notification?.request?.content?.data;
            const sessionId = data?.sessionId ?? data?.session_id ?? null;
            if (sessionId) {
              router.push(`/(tabs)/radar?sessionId=${encodeURIComponent(sessionId)}`);
            } else {
              router.push('/(tabs)/radar');
            }
          } catch (e) {
            console.warn('notification response handling error', e);
          }
        });
      } catch (e) {
        // ignore - likely Expo Go or notifications not available
      }
    })();

    return () => {
      try {
        if (subscription && subscription.remove) subscription.remove();
      } catch {}
    };
  }, [router]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#0a0a0a" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', headerShown: true, title: 'Emergency Contacts' }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}