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
import { acceptHelp, getActiveFriendEmergencies, updateHelperLocation } from '../services/emergency';
import { getOrCreateProfile, updatePushToken } from '../services/friends';
import { getCurrentLocation, watchLocation } from '../services/location';
import { getExpoPushToken } from '../services/notifications';
import { useAppStore } from '../store/useAppStore';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  try {
    // @ts-ignore
    if (typeof global !== 'undefined') {
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

  const stopHelperTracking = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!helpingState) {
      stopHelperTracking.current?.();
      stopHelperTracking.current = null;
      return;
    }

    const { sessionId, friendDeviceId } = helpingState;
    const myDeviceId = useAppStore.getState().deviceId;
    const myNick = useAppStore.getState().nickname || myDeviceId?.slice(0, 8) || '';
    if (!myDeviceId) return;

    getCurrentLocation().then((coords) => {
      if (coords) updateHelperLocation(sessionId, myDeviceId, coords, myNick);
    });

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
          if (ids.length === 0) return [];

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

          try {
            const activeSessions = await getActiveFriendEmergencies(ids);
            const emergencyIds = new Set(activeSessions.map((s) => s.deviceId));
            return results.map((f) => ({
              ...f,
              isInEmergency: emergencyIds.has(f.deviceId),
            }));
          } catch {
            return results;
          }
        }

        const resolved = await resolveFriends(profile.friends ?? []);
        setFriends(resolved);

        // ── Realtime profile listener ────────────────────────────────────────
        // Seen timestamps — initialized to 0 so fresh alerts always show
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

          // ── SOS Alert Handler ──────────────────────────────────────────────
          try {
            const sosAlert = p.lastSOSAlert;

            if (isInitialProfileLoad.value) {
              // App just opened — if alert is older than 8 seconds, mark as seen
              // If it's fresh (within 8s), show it
              const isFresh = sosAlert?.timestamp && (Date.now() - sosAlert.timestamp) < 8000;
              if (!isFresh) {
                lastSOSSeenTs.value = sosAlert?.timestamp ?? 0;
              }
            }

            const isMine = sosAlert?.fromDeviceId === deviceId; // Ignore own SOS alerts
            const isNew = sosAlert?.timestamp && sosAlert.timestamp > lastSOSSeenTs.value;

            if (!isMine && isNew && sosAlert) {
              lastSOSSeenTs.value = sosAlert.timestamp;

              const fromId: string = sosAlert.fromDeviceId ?? 'A friend';
              const addr: string = sosAlert.address ?? '';
              const sessionId: string = sosAlert.sessionId;

              let fromNick = fromId;
              try {
                const friendSnap = await get(ref(rtdb, `users/${fromId}`));
                if (friendSnap.exists()) fromNick = friendSnap.val().nickname ?? fromId;
              } catch {}

              const myNick = useAppStore.getState().nickname || deviceId.slice(0, 8);

              Alert.alert(
                '🚨 Friend Needs Help!',
                `${fromNick} triggered SOS!\n${addr ? `📍 ${addr}` : ''}\n\nWill you help?`,
                [
                  {
                    text: "✅ Yes, I'm coming!",
                    onPress: async () => {
                      try {
                        await acceptHelp(sessionId, deviceId, myNick);
                        setHelpingState({
                          sessionId,
                          friendDeviceId: fromId,
                          friendNickname: fromNick,
                          friendAddress: addr,
                        });
                        router.push(
                          `/(tabs)/radar?helpingSessionId=${encodeURIComponent(sessionId)}&friendNickname=${encodeURIComponent(fromNick)}`
                        );
                        Alert.alert(
                          '✅ Help Mode Active',
                          `You are helping ${fromNick}. They can see your live location.`
                        );
                      } catch (err) {
                        Alert.alert('Error', 'There was an issue accepting help.');
                      }
                    },
                  },
                  {
                    text: "❌ Not now",
                    style: 'cancel',
                  },
                ],
                { cancelable: false } // Cannot dismiss by tapping outside
              );
            }
          } catch (err) {
            console.warn('SOS alert handling error', err);
          }

          // ── Help-ended Handler ─────────────────────────────────────────────
          try {
            const helpNotif = p?.notifications?.lastHelpEndedFor;
            if (isInitialProfileLoad.value) {
              lastHelpEndedSeenTs.value = helpNotif?.timestamp ?? 0;
            }
            const isNewHelpEnd =
              helpNotif?.timestamp && helpNotif.timestamp > lastHelpEndedSeenTs.value;
            if (!isInitialProfileLoad.value && isNewHelpEnd) {
              lastHelpEndedSeenTs.value = helpNotif.timestamp;
              const endedSessionId = helpNotif.sessionId ?? helpNotif;
              const fromNick = helpNotif.fromNick ?? 'Friend';
              Alert.alert('✅ Safe!', `${fromNick} is now safe!`);
              const currentHelping = useAppStore.getState().helpingState;
              if (currentHelping && currentHelping.sessionId === endedSessionId) {
                setHelpingState(null);
              }
            }
          } catch (err) {
            console.warn('Help-ended handling error', err);
          }

          // Initial load complete
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