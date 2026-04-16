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

// SOS press hone par emergency session create karo Firestore me
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

  // Realtime DB me bhi initial location set karo
  await updateLiveLocation(sessionId, location);

  // Notify friends (if they have push tokens) about the SOS
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
            const nickname = friend?.nickname ?? friendId;
            if (token) {
              const title = 'SOS Alert';
              const body = `Your friend ${deviceId} started an SOS. Tap to view live location.`;
              await sendExpoPushNotification(token, title, body, { sessionId, from: deviceId });
            }
            // Also write an in-app realtime alert so friends see it even without push tokens
            try {
              await update(ref(rtdb, `users/${friendId}/lastSOSAlert`), {
                fromDeviceId: deviceId,
                sessionId,
                timestamp: Date.now(),
                location,
                address: address ?? '',
              });
            } catch (err) {
              console.warn('write in-app alert error', err);
            }
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

// Live location Realtime DB me update karo (har 5 seconds)
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

  // Realtime DB se location hata do
  const locationRef = ref(rtdb, `live_locations/${sessionId}`);
  await set(locationRef, null);
}

// Friend ki live location subscribe karo (radar screen)
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

// Active emergencies fetch karo (friends ki)
export async function getActiveFriendEmergencies(
  friendDeviceIds: string[]
): Promise<EmergencySession[]> {
  // Simple implementation - production me query optimize karna
  const sessions: EmergencySession[] = [];

  // Read all emergencies and filter locally (OK for small datasets)
  const snap = await get(ref(rtdb, 'emergencies'));
  const data = snap.exists() ? snap.val() : {};

  Object.values(data).forEach((s: any) => {
    if (s && s.status === 'active' && friendDeviceIds.includes(s.deviceId)) {
      sessions.push(s as EmergencySession);
    }
  });

  return sessions;
}