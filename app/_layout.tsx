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
  // Best-effort: catch unhandled promise rejections to avoid crashing Metro/Expo
  try {
    // @ts-ignore
    if (typeof global !== 'undefined') {
      // Some environments expose 'onunhandledrejection'
      // Attach a no-op logger to avoid uncaught promise rejections stopping execution
      // This is a minimal safeguard; proper fixes should handle the underlying error.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).onunhandledrejection = (ev: any) => {
        console.warn('Unhandled promise rejection caught:', ev?.reason ?? ev);
      };
    }
  } catch (err) {}
  const {
    setDeviceId, setNickname, setFriends, setPendingRequests,
    setOutgoingRequests, loadContactsFromStorage, setInitialized,
    setHelpingState, helpingState, nickname,
  } = useAppStore();
  const router = useRouter();

  // Helper location tracking — cleanup ref
  const stopHelperTracking = useRef<(() => void) | null>(null);

  // When helpingState is set, track location and send updates to Firebase
  useEffect(() => {
    if (!helpingState) {
      // Stop karo
      stopHelperTracking.current?.();
      stopHelperTracking.current = null;
      return;
    }

    const { sessionId, friendDeviceId } = helpingState;
    const myDeviceId = useAppStore.getState().deviceId;
    const myNick = useAppStore.getState().nickname || myDeviceId?.slice(0, 8) || '';
    if (!myDeviceId) return;

    // Send current location immediately
    getCurrentLocation().then((coords) => {
      if (coords) updateHelperLocation(sessionId, myDeviceId, coords, myNick);
    });

    // Then update every 5 seconds
    stopHelperTracking.current = watchLocation(async (coords) => {
      await updateHelperLocation(sessionId, myDeviceId, coords, myNick);
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
        const lastHelpEndedSeenTs = { value: 0 };
        const profileRef = ref(rtdb, `users/${deviceId}`);
        const isInitialProfileLoad = { value: true };
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
            // If this is the first profile snapshot after app start, mark existing alerts as seen
            if (isInitialProfileLoad.value) {
              lastSOSSeenTs.value = sosAlert?.timestamp ?? lastSOSSeenTs.value;
            }
            if (!isInitialProfileLoad.value && sosAlert && sosAlert.timestamp && sosAlert.timestamp > lastSOSSeenTs.value) {
              lastSOSSeenTs.value = sosAlert.timestamp;

              const fromId: string = sosAlert.fromDeviceId ?? 'A friend';
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
                '🚨 A Friend Needs Help!',
                `${fromNick} triggered an SOS!\n${addr ? `📍 ${addr}` : ''}\n\nWill you go to help them?`,
                [
                  {
                    text: '✅ Yes, I\'m on my way!',
                    onPress: async () => {
                      try {
                        // Register in Firebase that I'm coming
                        await acceptHelp(sessionId, deviceId, myNick);
                        // Set helping state in store (this will trigger location tracking)
                        setHelpingState({
                          sessionId,
                          friendDeviceId: fromId,
                          friendNickname: fromNick,
                          friendAddress: addr,
                        });
                        // Navigate to radar screen to view SOS person's location
                        router.push(`/(tabs)/radar?helpingSessionId=${encodeURIComponent(sessionId)}&friendNickname=${encodeURIComponent(fromNick)}`);
                        Alert.alert(
                          '✅ Help Mode Active',
                          `You're helping ${fromNick}. They can see your live location.`
                        );
                      } catch (err) {
                        Alert.alert('Error', 'Failed to accept help.');
                      }
                    },
                  },
                  {
                    text: '❌ I can\'t right now',
                    style: 'cancel',
                  },
                ]
              );
            }
          } catch (err) {
            console.warn('SOS alert handling error', err);
          }

          // ── Help-ended Handler ───────────────────────────────────────────
          try {
            const helpNotif = p?.notifications?.lastHelpEndedFor;
            // Ignore help-ended notifications on initial load
            if (isInitialProfileLoad.value) {
              lastHelpEndedSeenTs.value = helpNotif?.timestamp ?? lastHelpEndedSeenTs.value;
            }
            if (!isInitialProfileLoad.value && helpNotif && helpNotif.timestamp && helpNotif.timestamp > lastHelpEndedSeenTs.value) {
              lastHelpEndedSeenTs.value = helpNotif.timestamp;
              const endedSessionId = helpNotif.sessionId ?? helpNotif;
              const fromNick = helpNotif.fromNick ?? 'Friend';
              Alert.alert(`✅ ${fromNick} is safe now!`);
              // If we were helping that session, clear helping state
              const currentHelping = useAppStore.getState().helpingState;
              if (currentHelping && currentHelping.sessionId === endedSessionId) {
                setHelpingState(null);
              }
            }
          } catch (err) {
            console.warn('Help-ended handling error', err);
          }
          // After processing the first snapshot, mark that initial load is done
          if (isInitialProfileLoad.value) isInitialProfileLoad.value = false;
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