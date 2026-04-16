// services/sms.ts
import * as SMS from 'expo-sms';
import { Contact } from '../store/useAppStore';
import { Coordinates, getAddressFromCoords } from './location';

// Send emergency SMS to saved contacts
export async function sendEmergencySMS(
  contacts: Contact[],
  location: Coordinates,
  deviceId: string
): Promise<boolean> {
  try {
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) {
      console.warn('SMS not available on this device');
      return false;
    }

    const address = await getAddressFromCoords(location);
    const mapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;

    const message = `🚨 EMERGENCY ALERT 🚨

  I am in trouble and need immediate help.

  📍 Location: ${address}
  🗺️ Live Map: ${mapsLink}

  This message was automatically sent by the SOS Safety App.
  Please respond immediately or call 112.`;

    const phoneNumbers = contacts.map((c) => c.phone);

    const { result } = await SMS.sendSMSAsync(phoneNumbers, message);
    return result === 'sent' || result === 'unknown';
  } catch (error) {
    console.error('SMS send error:', error);
    return false;
  }
}

// Test SMS bhejo (single contact ko)
export async function sendTestSMS(contact: Contact): Promise<boolean> {
  try {
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) return false;

    const { result } = await SMS.sendSMSAsync(
      [contact.phone],
      `✅ SOS App Test: ${contact.name}, this is a test message. In a real emergency you would receive the same alert. The app is working properly! 🛡️`
    );

    return result === 'sent' || result === 'unknown';
  } catch {
    return false;
  }
}