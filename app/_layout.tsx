// app/_layout.tsx
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { get, onValue, ref } from 'firebase/database';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { rtdb } from '../config/firebase';
import { getOrCreateDeviceId } from '../services/deviceId';
import { acceptHelp, updateHelperLocation } from '../services/emergency';
import { getOrCreateProfile, updatePushToken } from '../services/friends';
import { getCurrentLocation, watchLocation } from '../services/location';
import { getExpoPushToken } from '../services/notifications';
import { useAppStore } from '../store/useAppStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const {
    setDeviceId, setNickname, setFriends, setPendingRequests,
    setOutgoingRequests, loadContactsFromStorage, setInitialized,
    setHelpingState, helpingState, nickname,
  } = useAppStore();
  const router = useRouter();

  // Helper location tracking — cleanup ref
  const stopHelperTracking = useRef<(() => void) | null>(null);

  // Jab helpingState set ho, apni location track karke Firebase mein bhejte raho
  useEffect(() => {
    if (!helpingState) {
      // Stop karo
      stopHelperTracking.current?.();
      stopHelperTracking.current = null;
      return;
    }

    const { sessionId, friendDeviceId } = helpingState;
    const myDeviceId = useAppStore.getState().deviceId;
    if (!myDeviceId) return;

    // Turant current location bhejo
    getCurrentLocation().then((coords) => {
      if (coords) updateHelperLocation(sessionId, myDeviceId, coords);
    });

    // Phir har 5 seconds update karo
    stopHelperTracking.current = watchLocation(async (coords) => {
      await updateHelperLocation(sessionId, myDeviceId, coords);
    });

    return () => {
      stopHelperTracking.current?.();
      stopHelperTracking.current = null;
    };
  }, [helpingState]);

  useEffect(() => {
    initializeApp();
  }, []);

  async function initializeApp() {
    try {
      const deviceId = await getOrCreateDeviceId();
      setDeviceId(deviceId);

      await loadContactsFromStorage();

      try {
        const profile = await getOrCreateProfile(deviceId);
        setNickname(profile.nickname ?? '');
        setPendingRequests(profile.pendingRequests ?? []);
        setOutgoingRequests((profile as any).outgoingRequests ?? []);

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

        // Realtime profile subscribe — friend requests + SOS alerts
        const lastSOSSeenTs = { value: 0 };
        const profileRef = ref(rtdb, `users/${deviceId}`);
        onValue(profileRef, async (snap) => {
          if (!snap.exists()) return;
          const p: any = snap.val();
          setNickname(p.nickname ?? '');
          setPendingRequests(p.pendingRequests ?? []);
          setOutgoingRequests(p.outgoingRequests ?? []);
          const resolvedLive = await resolveFriends(p.friends ?? []);
          setFriends(resolvedLive);

          // ── SOS Alert Handler ─────────────────────────────────────────────
          try {
            const sosAlert = p.lastSOSAlert;
            if (sosAlert && sosAlert.timestamp && sosAlert.timestamp > lastSOSSeenTs.value) {
              lastSOSSeenTs.value = sosAlert.timestamp;

              const fromId: string = sosAlert.fromDeviceId ?? 'Ek dost';
              const addr: string = sosAlert.address ?? '';
              const sessionId: string = sosAlert.sessionId;

              // Nickname fetch karo
              let fromNick = fromId;
              try {
                const friendSnap = await get(ref(rtdb, `users/${fromId}`));
                if (friendSnap.exists()) fromNick = friendSnap.val().nickname ?? fromId;
              } catch {}

              const myNick = useAppStore.getState().nickname || deviceId.slice(0, 8);

              Alert.alert(
                '🚨 Dost Ko Madad Chahiye!',
                `${fromNick} ne SOS trigger kiya hai!\n${addr ? `📍 ${addr}` : ''}\n\nKya tum madad karne jaoge?`,
                [
                  {
                    text: '✅ Haan, jaa raha hoon!',
                    onPress: async () => {
                      try {
                        // Firebase mein register karo ki mai aa raha hoon
                        await acceptHelp(sessionId, deviceId, myNick);
                        // Store mein helping state set karo (yeh location tracking trigger karega)
                        setHelpingState({
                          sessionId,
                          friendDeviceId: fromId,
                          friendNickname: fromNick,
                          friendAddress: addr,
                        });
                        // Radar screen par navigate karo SOS person ki location dekhne
                        router.push(`/(tabs)/radar?helpingSessionId=${encodeURIComponent(sessionId)}&friendNickname=${encodeURIComponent(fromNick)}`);
                        Alert.alert(
                          '✅ Help Mode Active',
                          `Tum ${fromNick} ki madad kar rahe ho. Unhe tumhari live location dikh rahi hai.`
                        );
                      } catch (err) {
                        Alert.alert('Error', 'Help accept karne mein dikkat aayi.');
                      }
                    },
                  },
                  {
                    text: '❌ Abhi nahi ja sakta',
                    style: 'cancel',
                  },
                ]
              );
            }
          } catch (err) {
            console.warn('SOS alert handling error', err);
          }
        });

        try {
          const pushToken = await getExpoPushToken();
          if (pushToken) await updatePushToken(deviceId, pushToken);
        } catch (err) {
          console.warn('push register failed', err);
        }
      } catch (e) {
        console.warn('Firebase profile sync failed - offline mode', e);
      }

      setInitialized(true);
    } catch (error) {
      console.error('App init error:', error);
      setInitialized(true);
    } finally {
      await SplashScreen.hideAsync();
    }
  }

  // Push notification response handler
  useEffect(() => {
    let subscription: any = null;
    (async () => {
      try {
        const Constants = await import('expo-constants');
        if (Constants?.default?.appOwnership === 'expo') return;

        const Notifications = await import('expo-notifications');
        subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
          try {
            const data = response?.notification?.request?.content?.data ?? {};
            const sessionId = data?.sessionId ?? null;
            if (sessionId) {
              router.push(`/(tabs)/radar?helpingSessionId=${encodeURIComponent(sessionId)}`);
            } else {
              router.push('/(tabs)/radar');
            }
          } catch (e) {
            console.warn('notification response error', e);
          }
        });
      } catch (e) {}
    })();

    return () => {
      try {
        if (subscription?.remove) subscription.remove();
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