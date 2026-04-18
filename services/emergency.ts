// services/emergency.ts
import { get, onValue, ref, set, update } from 'firebase/database';
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

// Create emergency session in Firebase when SOS is pressed
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

// Update SOS person's live location (every 5 seconds)
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

// Resolve/close the session
export async function resolveEmergencySession(sessionId: string): Promise<void> {
  // Notify helpers that the session has been resolved
  try {
    const helpersSnap = await get(ref(rtdb, `emergencies/${sessionId}/helpers`));
    const helpersObj = helpersSnap.exists() ? helpersSnap.val() : null;
    const helperIds = helpersObj ? Object.keys(helpersObj) : [];
    // Fetch session owner (victim) to include their name in notifications
    const sessionSnap = await get(ref(rtdb, `emergencies/${sessionId}`));
    const sessionObj: any = sessionSnap.exists() ? sessionSnap.val() : null;
    const victimId: string | null = sessionObj ? sessionObj.deviceId ?? null : null;
    let victimNick = 'Friend';
    if (victimId) {
      try {
        const vSnap = await get(ref(rtdb, `users/${victimId}`));
        if (vSnap.exists()) victimNick = vSnap.val()?.nickname ?? victimId;
      } catch {}
    }
    if (helperIds.length > 0) {
      await Promise.all(
        helperIds.map(async (helperId) => {
          try {
            const userSnap = await get(ref(rtdb, `users/${helperId}`));
            if (!userSnap.exists()) return;
            const token: string | null = userSnap.val()?.pushToken ?? null;
            if (token) {
              // Notify helper that the victim is safe now, include victim's name
              await sendExpoPushNotification(
                token,
                `✅ ${victimNick} is safe`,
                `${victimNick} is safe now!`,
                { sessionId, fromDeviceId: victimId, fromNick: victimNick }
              );
            }
            // Record that helper was notified with structured data
            await update(ref(rtdb, `users/${helperId}/notifications`), {
              lastHelpEndedFor: { sessionId, fromDeviceId: victimId, fromNick: victimNick, timestamp: Date.now() },
            });
          } catch (err) {
            console.warn('notify helper on resolve error', err);
          }
        })
      );
    }
  } catch (err) {
    console.warn('resolve notify helpers error', err);
  }

  await update(ref(rtdb, `emergencies/${sessionId}`), {
    status: 'resolved',
    resolvedAt: Date.now(),
  });
  await set(ref(rtdb, `live_locations/${sessionId}`), null);
  // Clear helper locations
  await set(ref(rtdb, `helper_locations/${sessionId}`), null);
}

// Subscribe to SOS person's live location (helper sees it)
export function subscribeFriendLocation(
  sessionId: string,
  onUpdate: (location: Coordinates & { updatedAt: number }) => void
): () => void {
  const locationRef = ref(rtdb, `live_locations/${sessionId}`);
  
  // Helper function to normalize location data
  function normalizeLocation(raw: any): (Coordinates & { updatedAt: number }) | null {
    if (!raw) return null;
    const data: any = {};
    
    if (raw.latitude != null && raw.longitude != null) {
      data.latitude = raw.latitude;
      data.longitude = raw.longitude;
    } else if (raw.lat != null && (raw.lon != null || raw.lng != null)) {
      data.latitude = raw.lat;
      data.longitude = raw.lon ?? raw.lng;
    } else if (raw.location && raw.location.lat != null) {
      data.latitude = raw.location.lat;
      data.longitude = raw.location.lng ?? raw.location.lon;
    }
    
    if (data.latitude == null || data.longitude == null) return null;
    
    data.updatedAt = raw.updatedAt ?? Date.now();
    return data as Coordinates & { updatedAt: number };
  }
  
  // Set up the listener
  const unsubscribe = onValue(
    locationRef, 
    (snapshot) => {
      const raw = snapshot.val();
      console.log('[subscribeFriendLocation] Firebase snapshot:', { sessionId, raw });
      
      const normalized = normalizeLocation(raw);
      if (normalized) {
        console.log('[subscribeFriendLocation] Normalized location:', { sessionId, normalized });
        onUpdate(normalized);
      } else {
        console.warn('[subscribeFriendLocation] Could not normalize location data:', { sessionId, raw });
      }
    },
    (error) => {
      console.error('[subscribeFriendLocation] Firebase error:', { sessionId, error });
    }
  );
  
  return () => {
    console.log('[subscribeFriendLocation] Unsubscribing from:', sessionId);
    unsubscribe();
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

// Helper accepted the request
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

// Update helper's live location (SOS person will see)
export async function updateHelperLocation(
  sessionId: string,
  helperDeviceId: string,
  location: Coordinates,
  helperNickname?: string
): Promise<void> {
  const payload: any = {
    ...location,
    updatedAt: Date.now(),
  };
  // Include nickname so victim's subscribeHelperLocations receives complete data
  if (helperNickname) {
    payload.nickname = helperNickname;
  }
  await set(ref(rtdb, `helper_locations/${sessionId}/${helperDeviceId}`), payload);
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
  
  const unsubscribe = onValue(
    helpersRef,
    (snapshot) => {
      const raw = snapshot.val() ?? {};
      console.log('[subscribeHelperLocations] Firebase snapshot:', { sessionId, raw });
      
      const helpers: HelperInfo[] = Object.entries(raw)
        .filter(([_, loc]: [string, any]) => loc != null) // Skip null entries
        .map(([deviceId, loc]: [string, any]) => {
          const latitude = loc?.latitude ?? loc?.lat ?? loc?.location?.lat ?? null;
          const longitude = loc?.longitude ?? loc?.lng ?? loc?.lon ?? loc?.location?.lng ?? loc?.location?.lon ?? null;
          return {
            deviceId,
            nickname: loc?.nickname ?? deviceId.slice(0, 8),
            status: 'coming' as const,
            acceptedAt: loc?.acceptedAt ?? 0,
            latitude: latitude ?? undefined,
            longitude: longitude ?? undefined,
            updatedAt: loc?.updatedAt ?? null,
          } as HelperInfo;
        });
      
      console.log('[subscribeHelperLocations] Processed helpers:', { sessionId, count: helpers.length, helpers });
      onUpdate(helpers);
    },
    (error) => {
      console.error('[subscribeHelperLocations] Firebase error:', { sessionId, error });
      onUpdate([]); // Return empty array on error
    }
  );
  
  return () => {
    console.log('[subscribeHelperLocations] Unsubscribing from:', sessionId);
    unsubscribe();
  };
}

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