export async function getExpoPushToken(): Promise<string | null> {
  try {
    // Avoid importing expo-notifications at module load (it can auto-register and warn in Expo Go)
    const Constants = await import('expo-constants');
    // If running in Expo Go, skip push token registration (not supported on Android in Expo Go)
    if (Constants?.default?.appOwnership === 'expo') {
      console.warn('Running in Expo Go - skipping push token registration. Use a development build to test push notifications.');
      return null;
    }

    const Notifications = await import('expo-notifications');
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch (error) {
    console.warn('Push token error', error);
    return null;
  }
}

export async function sendExpoPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, any>
) {
  try {
    const payload: any = {
      to: expoPushToken,
      title,
      body,
      sound: 'default',
      priority: 'high',
    };
    if (data) payload.data = data;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('Send push error', error);
  }
}
