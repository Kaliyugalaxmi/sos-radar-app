// services/friends.ts
import { get, ref, set, update } from 'firebase/database';
import { rtdb } from '../config/firebase';
import { sendExpoPushNotification } from './notifications';

export interface FriendRequest {
  fromDeviceId: string;
  toDeviceId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: any;
}

export interface UserProfile {
  deviceId: string;
  nickname: string;
  friends: string[]; // accepted friend device IDs
  pendingRequests: string[];
  pushToken?: string | null;
  outgoingRequests?: string[];
  createdAt: any;
}

// Create or fetch user profile
export async function getOrCreateProfile(
  deviceId: string,
  nickname?: string
): Promise<UserProfile> {
  const profileRef = ref(rtdb, `users/${deviceId}`);
  const snap = await get(profileRef);

  if (snap.exists()) {
    return snap.val() as UserProfile;
  }

  // Create new profile
  const newProfile: UserProfile = {
    deviceId,
    nickname: nickname ?? `User_${deviceId.slice(0, 6)}`,
    friends: [],
    pendingRequests: [],
    pushToken: null,
    outgoingRequests: [],
    createdAt: Date.now(),
  };

  await set(profileRef, newProfile);
  return newProfile;
}

// Update nickname
export async function updateNickname(
  deviceId: string,
  nickname: string
): Promise<void> {
  await update(ref(rtdb, `users/${deviceId}`), { nickname });
}

export async function updatePushToken(deviceId: string, pushToken: string | null): Promise<void> {
  try {
    await update(ref(rtdb, `users/${deviceId}`), { pushToken });
  } catch (err) {
    console.warn('updatePushToken error', err);
  }
}

// Send friend request (via deviceId)
export async function sendFriendRequest(
  fromDeviceId: string,
  toDeviceId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Check if user exists
    const toUserSnap = await get(ref(rtdb, `users/${toDeviceId}`));
    if (!toUserSnap.exists()) {
      return { success: false, message: 'This ID does not match any user.' };
    }

    const requestId = `${fromDeviceId}_${toDeviceId}`;
    await set(ref(rtdb, `friend_requests/${requestId}`), {
      fromDeviceId,
      toDeviceId,
      status: 'pending',
      createdAt: Date.now(),
    });

    // Add to receiver's pending requests (read-modify-write)
    const pendingRef = ref(rtdb, `users/${toDeviceId}/pendingRequests`);
    const pendingSnap = await get(pendingRef);
    const arr: string[] = pendingSnap.exists() ? pendingSnap.val() : [];
    if (!arr.includes(fromDeviceId)) {
      arr.push(fromDeviceId);
      await update(ref(rtdb, `users/${toDeviceId}`), { pendingRequests: arr });
    }

    // Add to sender's outgoingRequests
    try {
      const outgoingRef = ref(rtdb, `users/${fromDeviceId}/outgoingRequests`);
      const outgoingSnap = await get(outgoingRef);
      const outArr: string[] = outgoingSnap.exists() ? outgoingSnap.val() : [];
      if (!outArr.includes(toDeviceId)) {
        outArr.push(toDeviceId);
        await update(ref(rtdb, `users/${fromDeviceId}`), { outgoingRequests: outArr });
      }
    } catch (err) {
      console.warn('update sender outgoingRequests error', err);
    }

    // Try to notify receiver via Expo push token if available
    try {
      const toUser = toUserSnap.val();
      const token = toUser?.pushToken ?? null;
      if (token) {
        const title = 'New Friend Request';
        const body = `You have a friend request from ${fromDeviceId}`;
        await sendExpoPushNotification(token, title, body);
      }
    } catch (err) {
      console.warn('notify friend request error', err);
    }

    return { success: true, message: 'Friend request sent!' };
  } catch (error) {
    return { success: false, message: 'Error sending request.' };
  }
}

// Friend request accept karo
export async function acceptFriendRequest(
  myDeviceId: string,
  fromDeviceId: string
): Promise<void> {
  const requestId = `${fromDeviceId}_${myDeviceId}`;
  await update(ref(rtdb, `friend_requests/${requestId}`), { status: 'accepted' });

  // Add to both friends lists (read-modify-write)
  const myFriendsRef = ref(rtdb, `users/${myDeviceId}/friends`);
  const myFriendsSnap = await get(myFriendsRef);
  const myFriends: string[] = myFriendsSnap.exists() ? myFriendsSnap.val() : [];
  if (!myFriends.includes(fromDeviceId)) myFriends.push(fromDeviceId);

  const fromFriendsRef = ref(rtdb, `users/${fromDeviceId}/friends`);
  const fromFriendsSnap = await get(fromFriendsRef);
  const fromFriends: string[] = fromFriendsSnap.exists() ? fromFriendsSnap.val() : [];
  if (!fromFriends.includes(myDeviceId)) fromFriends.push(myDeviceId);

  // Remove pending request from my list
  const myPendingRef = ref(rtdb, `users/${myDeviceId}/pendingRequests`);
  const myPendingSnap = await get(myPendingRef);
  const pendingArr: string[] = myPendingSnap.exists() ? myPendingSnap.val() : [];
  const filtered = pendingArr.filter((id) => id !== fromDeviceId);

  await update(ref(rtdb, `users/${myDeviceId}`), {
    friends: myFriends,
    pendingRequests: filtered,
  });

  await update(ref(rtdb, `users/${fromDeviceId}`), { friends: fromFriends });

  // Remove from sender's outgoingRequests
  try {
    const senderOutgoingRef = ref(rtdb, `users/${fromDeviceId}/outgoingRequests`);
    const senderOutgoingSnap = await get(senderOutgoingRef);
    const senderOutgoing: string[] = senderOutgoingSnap.exists() ? senderOutgoingSnap.val() : [];
    const filteredSenderOutgoing = senderOutgoing.filter((id) => id !== myDeviceId);
    await update(ref(rtdb, `users/${fromDeviceId}`), { outgoingRequests: filteredSenderOutgoing });
  } catch (err) {
    console.warn('cleanup sender outgoingRequests error', err);
  }
}

// Reject friend request
export async function rejectFriendRequest(
  myDeviceId: string,
  fromDeviceId: string
): Promise<void> {
  const requestId = `${fromDeviceId}_${myDeviceId}`;
  await update(ref(rtdb, `friend_requests/${requestId}`), { status: 'rejected' });

  const myPendingRef = ref(rtdb, `users/${myDeviceId}/pendingRequests`);
  const myPendingSnap = await get(myPendingRef);
  const pendingArr: string[] = myPendingSnap.exists() ? myPendingSnap.val() : [];
  const filtered = pendingArr.filter((id) => id !== fromDeviceId);
  await update(ref(rtdb, `users/${myDeviceId}`), { pendingRequests: filtered });

  // Remove from sender's outgoingRequests as well
  try {
    const senderOutgoingRef = ref(rtdb, `users/${fromDeviceId}/outgoingRequests`);
    const senderOutgoingSnap = await get(senderOutgoingRef);
    const senderOutgoing: string[] = senderOutgoingSnap.exists() ? senderOutgoingSnap.val() : [];
    const filteredSenderOutgoing = senderOutgoing.filter((id) => id !== myDeviceId);
    await update(ref(rtdb, `users/${fromDeviceId}`), { outgoingRequests: filteredSenderOutgoing });
  } catch (err) {
    console.warn('cleanup sender outgoingRequests error', err);
  }
}

// Remove friend
export async function removeFriend(
  myDeviceId: string,
  friendDeviceId: string
): Promise<void> {
  const myFriendsRef = ref(rtdb, `users/${myDeviceId}/friends`);
  const myFriendsSnap = await get(myFriendsRef);
  const myFriends: string[] = myFriendsSnap.exists() ? myFriendsSnap.val() : [];
  await update(ref(rtdb, `users/${myDeviceId}`), { friends: myFriends.filter((id) => id !== friendDeviceId) });

  const friendFriendsRef = ref(rtdb, `users/${friendDeviceId}/friends`);
  const friendFriendsSnap = await get(friendFriendsRef);
  const friendFriends: string[] = friendFriendsSnap.exists() ? friendFriendsSnap.val() : [];
  await update(ref(rtdb, `users/${friendDeviceId}`), { friends: friendFriends.filter((id) => id !== myDeviceId) });
}