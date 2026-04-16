// services/location.ts
import * as Location from 'expo-location';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

// Permission maango
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

// Background permission (live tracking ke liye)
export async function requestBackgroundPermission(): Promise<boolean> {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}

// Ek baar current location fetch karo
export async function getCurrentLocation(): Promise<Coordinates | null> {
  try {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
    };
  } catch (error) {
    console.error('Location fetch error:', error);
    return null;
  }
}

// Live location watch (SOS active hone par)
export function watchLocation(
  onUpdate: (coords: Coordinates) => void,
  onError?: (error: string) => void
): () => void {
  let subscription: Location.LocationSubscription | null = null;

  Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,    // Har 5 seconds
      distanceInterval: 10,  // Ya 10 meter movement par
    },
    (location) => {
      onUpdate({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
      });
    }
  ).then((sub) => {
    subscription = sub;
  }).catch((err) => {
    onError?.(err.message);
  });

  // Cleanup function return karo
  return () => {
    subscription?.remove();
  };
}

// Address from coordinates
export async function getAddressFromCoords(coords: Coordinates): Promise<string> {
  try {
    const result = await Location.reverseGeocodeAsync(coords);
    if (result.length > 0) {
      const addr = result[0];
      return `${addr.street ?? ''}, ${addr.city ?? ''}, ${addr.region ?? ''}`.trim();
    }
    return `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
  } catch {
    return `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
  }
}