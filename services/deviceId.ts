// services/deviceId.ts

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'sos_device_unique_id';

export async function getOrCreateDeviceId(): Promise<string> {
  try {
    // check existing id
    const existingId = await SecureStore.getItemAsync(DEVICE_ID_KEY);

    if (existingId) {
      return existingId;
    }

    // generate new safe UUID (Expo supported)
    const newId = await Crypto.randomUUID();

    await SecureStore.setItemAsync(DEVICE_ID_KEY, newId);

    return newId;
  } catch (error) {
    console.error('Device ID error:', error);

    // fallback (last option)
    const fallbackId = `device_${Date.now()}`;

    return fallbackId;
  }
}

export async function getDeviceId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(DEVICE_ID_KEY);
  } catch {
    return null;
  }
}