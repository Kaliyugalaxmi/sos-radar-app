// services/emergency.ts
import { get, off, onValue, ref, set, update } from 'firebase/database';
import { rtdb } from '../config/firebase';
import { Coordinates } from './location';
import { sendExpoPushNotification } from './notifications';

export interface EmergencySession {
  sessionId: string;
  deviceId: string;
  status: 'active' | 'resolved';
  startedAt: any;
  lastLocation: Coordinates;
  address?: string;
}

export interface HelperInfo {
  deviceId: string;
  nickname: string;
  status: 'coming';
  acceptedAt: number;
  latitude?: number;
  longitude?: number;
  updatedAt?: number;
}

// SOS press hone par emergency session create karo Firebase me
export async function createEmergencySession(
  deviceId: string,
  location: Coordinates,
  address?: string
): Promise<string> {
  const sessionId = `sos_${deviceId}_${Date.now()}`;

  const sessionData: EmergencySession = {
    sessionId,
    deviceId,
    status: 'active',
    startedAt: Date.now(),
    lastLocation: location,
    address: address ?? '',
  };

  await set(ref(rtdb, `emergencies/${sessionId}`), sessionData);
  await updateLiveLocation(sessionId, location);

  // Notify friends about SOS
  try {
    const friendsSnap = await get(ref(rtdb, `users/${deviceId}/friends`));
    const friends: string[] = friendsSnap.exists() ? friendsSnap.val() : [];
    if (friends.length > 0) {
      await Promise.all(
        friends.map(async (friendId) => {
          try {
            const friendSnap = await get(ref(rtdb, `users/${friendId}`));
            if (!friendSnap.exists()) return;
            const friend = friendSnap.val();
            const token: string | null = friend?.pushToken ?? null;
            if (token) {
              const title = '🚨 SOS Alert';
              const body = `Your friend needs help! Tap to view live location.`;
              await sendExpoPushNotification(token, title, body, { sessionId, from: deviceId });
            }
            // In-app realtime alert
            await update(ref(rtdb, `users/${friendId}/lastSOSAlert`), {
              fromDeviceId: deviceId,
              sessionId,
              timestamp: Date.now(),
              location,
              address: address ?? '',
            });
          } catch (err) {
            console.warn('notify friend error', err);
          }
        })
      );
    }
  } catch (err) {
    console.warn('notify friends list error', err);
  }

  return sessionId;
}

// SOS person ki live location update karo (har 5 seconds)
export async function updateLiveLocation(
  sessionId: string,
  location: Coordinates
): Promise<void> {
  const locationRef = ref(rtdb, `live_locations/${sessionId}`);
  await set(locationRef, {
    ...location,
    updatedAt: Date.now(),
  });
}

// Session resolve/close karo
export async function resolveEmergencySession(sessionId: string): Promise<void> {
  await update(ref(rtdb, `emergencies/${sessionId}`), {
    status: 'resolved',
    resolvedAt: Date.now(),
  });
  await set(ref(rtdb, `live_locations/${sessionId}`), null);
  // Helper locations bhi clear karo
  await set(ref(rtdb, `helper_locations/${sessionId}`), null);
}

// SOS person ki live location subscribe karo (helper dekhta hai)
export function subscribeFriendLocation(
  sessionId: string,
  onUpdate: (location: Coordinates & { updatedAt: number }) => void
): () => void {
  const locationRef = ref(rtdb, `live_locations/${sessionId}`);
  onValue(locationRef, (snapshot) => {
    const data = snapshot.val();
    if (data) onUpdate(data);
  });
  return () => off(locationRef);
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

// Helper ne accept kiya
export async function acceptHelp(
  sessionId: string,
  helperDeviceId: string,
  helperNickname: string
): Promise<void> {
  await update(ref(rtdb, `emergencies/${sessionId}/helpers/${helperDeviceId}`), {
    nickname: helperNickname,
    status: 'coming',
    acceptedAt: Date.now(),
  });
}

// Helper ki live location update karo (SOS person dekhega)
export async function updateHelperLocation(
  sessionId: string,
  helperDeviceId: string,
  location: Coordinates
): Promise<void> {
  await set(ref(rtdb, `helper_locations/${sessionId}/${helperDeviceId}`), {
    ...location,
    updatedAt: Date.now(),
  });
}

// Helper ka location clear karo (jab stop kare)
export async function removeHelperLocation(
  sessionId: string,
  helperDeviceId: string
): Promise<void> {
  await set(ref(rtdb, `helper_locations/${sessionId}/${helperDeviceId}`), null);
  await set(ref(rtdb, `emergencies/${sessionId}/helpers/${helperDeviceId}`), null);
}

// SOS person: helpers ki live location subscribe karo
export function subscribeHelperLocations(
  sessionId: string,
  onUpdate: (helpers: HelperInfo[]) => void
): () => void {
  const helpersRef = ref(rtdb, `helper_locations/${sessionId}`);
  onValue(helpersRef, (snapshot) => {
    const data = snapshot.val() ?? {};
    const helpers: HelperInfo[] = Object.entries(data).map(
      ([deviceId, loc]: [string, any]) => ({
        deviceId,
        nickname: loc.nickname ?? deviceId.slice(0, 8),
        status: 'coming',
        acceptedAt: loc.acceptedAt ?? 0,
        latitude: loc.latitude,
        longitude: loc.longitude,
        updatedAt: loc.updatedAt,
      })
    );
    onUpdate(helpers);
  });
  return () => off(helpersRef);
}

// Active emergencies fetch karo (friends ki)
export async function getActiveFriendEmergencies(
  friendDeviceIds: string[]
): Promise<EmergencySession[]> {
  const sessions: EmergencySession[] = [];
  const snap = await get(ref(rtdb, 'emergencies'));
  const data = snap.exists() ? snap.val() : {};

  Object.values(data).forEach((s: any) => {
    if (s && s.status === 'active' && friendDeviceIds.includes(s.deviceId)) {
      sessions.push(s as EmergencySession);
    }
  });

  return sessions;
}