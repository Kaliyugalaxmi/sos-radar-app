// app/(tabs)/SOSMapScreen.tsx
// SOS Map — Fully Responsive, No Overlaps, Safe Area Fixed

import { Ionicons } from '@expo/vector-icons';
import { ref as dbRef, get } from 'firebase/database';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rtdb } from '../../config/firebase';
import {
  subscribeFriendLocation,
  subscribeHelperLocations,
  updateHelperLocation,
  updateLiveLocation,
} from '../../services/emergency';
import { Coordinates, getCurrentLocation, watchLocation } from '../../services/location';

function useScale() {
  const { width } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.82), 1.25);
  const s = (size: number) => Math.round(size * scale);
  return { width, s };
}

function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

export interface SOSMapProps {
  sessionId: string;
  role: 'victim' | 'helper';
  myDeviceId: string;
  myNickname?: string;
  initialVictimLocation?: Coordinates;
  onClose?: () => void;
}

export default function SOSMapScreen({
  sessionId,
  role,
  myDeviceId,
  myNickname = 'You',
  initialVictimLocation,
  onClose,
}: SOSMapProps) {
  const { width, s } = useScale();
  const insets = useSafeAreaInsets();

  const [victimLoc, setVictimLoc] = useState<Coordinates | null>(initialVictimLocation ?? null);
  const [helperLoc, setHelperLoc] = useState<Coordinates | null>(null);
  const [helperName, setHelperName] = useState('Helper');
  const [victimName, setVictimName] = useState<string | null>(null);
  const [myLoc, setMyLoc] = useState<Coordinates | null>(
    role === 'victim' ? (initialVictimLocation ?? null) : null
  );
  const [distance, setDistance] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const mapRef = useRef<MapView>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const stopSub = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (role === 'victim') {
      stopWatch.current = watchLocation(async (coords) => {
        setMyLoc(coords);
        setVictimLoc(coords);
        setLastUpdated(new Date());
        await updateLiveLocation(sessionId, coords);
      });
      stopSub.current = subscribeHelperLocations(sessionId, (helpers) => {
        if (helpers.length > 0) {
          const h = helpers[0];
          if (h.latitude != null && h.longitude != null) {
            setHelperLoc({ latitude: h.latitude, longitude: h.longitude });
            setHelperName(h.nickname);
            setLastUpdated(new Date());
          }
        }
      });
    } else {
      getCurrentLocation().then((coords) => {
        if (coords) {
          setMyLoc(coords);
          updateHelperLocation(sessionId, myDeviceId, coords, myNickname);
        }
      });

      stopWatch.current = watchLocation(async (coords) => {
        setMyLoc(coords);
        setHelperLoc(coords);
        await updateHelperLocation(sessionId, myDeviceId, coords, myNickname);
        setLastUpdated(new Date());
      });

      const fetchVictimInitialLocation = async () => {
        try {
          const snap = await get(dbRef(rtdb, `live_locations/${sessionId}`));
          const data = snap.val();
          if (data) {
            const lat = data.latitude ?? data.lat ?? data.location?.lat;
            const lon = data.longitude ?? data.lng ?? data.lon ?? data.location?.lng ?? data.location?.lon;
            if (lat != null && lon != null) {
              setVictimLoc({ latitude: lat, longitude: lon });
              setLastUpdated(new Date());
            }
          }
        } catch (e) {
          console.warn('[SOSMapScreen] Error fetching initial victim location:', e);
        }
      };

      fetchVictimInitialLocation().then(() => {
        stopSub.current = subscribeFriendLocation(sessionId, (loc) => {
          setVictimLoc(loc);
          setLastUpdated(new Date());
        });
      });

      (async () => {
        try {
          const snap = await get(dbRef(rtdb, `emergencies/${sessionId}`));
          const sessionObj: any = snap.exists() ? snap.val() : null;
          const vId = sessionObj?.deviceId ?? null;
          if (vId) {
            const userSnap = await get(dbRef(rtdb, `users/${vId}`));
            if (userSnap.exists()) setVictimName(userSnap.val()?.nickname ?? vId.slice(0, 8));
          }
        } catch (e) {
          console.warn('fetch victim name error', e);
        }
      })();
    }

    return () => {
      stopWatch.current?.();
      stopSub.current?.();
    };
  }, [sessionId, role, myDeviceId]);

  useEffect(() => {
    const other = role === 'victim' ? helperLoc : victimLoc;
    if (myLoc && other) {
      setDistance(haversineKm(myLoc, other));
    } else {
      setDistance(null);
    }
  }, [myLoc, helperLoc, victimLoc, role]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const points: Coordinates[] = [];
    if (victimLoc) points.push(victimLoc);
    if (helperLoc) points.push(helperLoc);
    if (points.length >= 2) {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 130, right: 60, bottom: 200, left: 60 },
        animated: true,
      });
    }
  }, [victimLoc, helperLoc, mapReady]);

  const myMarkerCoord = myLoc;
  const otherCoord = role === 'victim' ? helperLoc : victimLoc;
  const myColor = role === 'victim' ? '#FF3B30' : '#30D158';
  const otherColor = role === 'victim' ? '#30D158' : '#FF3B30';
  const myLabel = role === 'victim' ? '🚨 You' : '🏃 You';
  const otherLabel = role === 'victim'
    ? `${helperName} — coming`
    : (victimName ? `${victimName} — needs help` : 'Needs help');
  const isNearby = distance !== null && distance < 0.3;

  const centerForMap = myMarkerCoord ?? victimLoc;

  // Safe bottom: account for phone's home bar / navigation bar
  const safeBottom = Math.max(insets.bottom, 8) + s(12);

  // Legend: max 55% of screen width so it never overlaps waiting banner
  const legendMaxWidth = Math.min(Math.round(width * 0.55), 220);
  // Waiting banner: max 42% of screen width
  const waitingMaxWidth = Math.min(Math.round(width * 0.42), 180);

  async function fetchLiveLocationNow() {
    try {
      const snap = await get(dbRef(rtdb, `live_locations/${sessionId}`));
      const data = snap.val();
      if (data) {
        const lat = data.latitude ?? data.lat ?? data.location?.lat;
        const lon = data.longitude ?? data.lng ?? data.lon ?? data.location?.lng ?? data.location?.lon;
        if (lat != null && lon != null) {
          setVictimLoc({ latitude: lat, longitude: lon });
          setLastUpdated(new Date());
        }
      }
    } catch (err) {
      console.warn('manual fetch live location error', err);
    }
  }

  return (
    <View style={styles.container}>

      {/* ── Distance Badge — top, left+right margin for proper centering ── */}
      <View
        style={[
          styles.distanceBadge,
          {
            paddingHorizontal: s(14),
            paddingVertical: s(8),
            borderRadius: s(20),
            left: s(12),
            right: s(12),
            top: s(14),
          },
          isNearby && styles.distanceBadgeClose,
        ]}
      >
        <Ionicons name="navigate-circle" size={s(18)} color={isNearby ? '#30D158' : '#FF3B30'} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.distanceValue, { fontSize: s(18) }, isNearby && { color: '#30D158' }]}>
            {distance !== null ? formatDistance(distance) : 'Calculating...'}
          </Text>
          <Text style={[styles.distanceLabel, { fontSize: s(10) }]}>
            {role === 'victim'
              ? otherCoord ? 'Helper is this far away' : 'Waiting for helper...'
              : victimName ? `Distance to ${victimName}` : 'Distance to person in need'}
          </Text>
        </View>
        {isNearby && (
          <View style={[styles.nearBadge, { borderRadius: s(6), paddingHorizontal: s(6), paddingVertical: s(2) }]}>
            <Text style={[styles.nearText, { fontSize: s(9) }]}>NEARBY!</Text>
          </View>
        )}
      </View>

      {/* ── Map ── */}
      {centerForMap ? (
        <MapView
          ref={mapRef}
          style={styles.map}
          mapType="standard"
          showsUserLocation={false}
          showsMyLocationButton={false}
          initialRegion={{
            latitude: centerForMap.latitude,
            longitude: centerForMap.longitude,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          }}
          onMapReady={() => setMapReady(true)}
        >
          {myMarkerCoord && (
            <Marker
              coordinate={myMarkerCoord}
              title={myLabel}
              description={role === 'victim' ? 'Your SOS location' : `${myNickname} — coming to help`}
              pinColor={myColor}
            />
          )}
          {otherCoord && (
            <Marker
              coordinate={otherCoord}
              title={otherLabel}
              description={role === 'victim' ? 'Helper is here' : 'Person who needs help'}
              pinColor={otherColor}
            />
          )}
          {myMarkerCoord && otherCoord && (
            <>
              <Polyline
                coordinates={[myMarkerCoord, otherCoord]}
                strokeColor="#00000066"
                strokeWidth={6}
                lineCap="round"
                geodesic
              />
              <Polyline
                coordinates={[myMarkerCoord, otherCoord]}
                strokeColor={role === 'victim' ? '#30D158' : '#FF3B30'}
                strokeWidth={3}
                lineDashPattern={[8, 6]}
                lineCap="round"
                geodesic
              />
            </>
          )}
          {myMarkerCoord && otherCoord && distance !== null && (() => {
            const mid = {
              latitude: (myMarkerCoord.latitude + otherCoord.latitude) / 2,
              longitude: (myMarkerCoord.longitude + otherCoord.longitude) / 2,
            };
            return (
              <Marker coordinate={mid} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={[styles.distanceMarker, { borderRadius: s(6), paddingHorizontal: s(7), paddingVertical: s(4) }]}>
                  <Text style={[styles.distanceMarkerText, { fontSize: s(11) }]}>{formatDistance(distance)}</Text>
                </View>
              </Marker>
            );
          })()}
        </MapView>
      ) : (
        <View style={styles.loadingMap}>
          <ActivityIndicator size="large" color="#FF3B30" />
          <Text style={[styles.loadingText, { fontSize: s(15) }]}>Loading map...</Text>
        </View>
      )}

      {/* ── Legend card (bottom-left) — compact rectangle ── */}
      <View style={[
        styles.legend,
        {
          bottom: safeBottom,
          left: s(12),
          borderRadius: s(6),
          paddingHorizontal: s(10),
          paddingVertical: s(7),
        },
      ]}>
        {/* My row */}
        <View style={[styles.legendRow, { gap: s(6) }]}>
          <View style={[styles.legendDot, { backgroundColor: myColor, width: s(7), height: s(7), borderRadius: s(3.5) }]} />
          <Text style={[styles.legendText, { fontSize: s(11) }]} numberOfLines={1}>{myLabel}</Text>
        </View>
        {/* Other row */}
        {otherCoord && (
          <View style={[styles.legendRow, { gap: s(6), marginTop: s(3) }]}>
            <View style={[styles.legendDot, { backgroundColor: otherColor, width: s(7), height: s(7), borderRadius: s(3.5) }]} />
            <Text style={[styles.legendText, { fontSize: s(11) }]} numberOfLines={1}>{otherLabel}</Text>
          </View>
        )}
        {/* Refresh inline — tiny, right after labels */}
        <TouchableOpacity
          style={[styles.refreshBtn, { borderRadius: s(4), paddingHorizontal: s(6), paddingVertical: s(3), marginTop: s(5) }]}
          onPress={fetchLiveLocationNow}
        >
          <Ionicons name="refresh" size={s(10)} color="#888" />
          <Text style={[styles.refreshBtnText, { fontSize: s(9) }]}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* ── Close / Back button (top-right) ── */}
      {onClose && (
        <TouchableOpacity
          style={[styles.closeBtn, { top: s(12), right: s(12), width: s(40), height: s(40), borderRadius: s(20) }]}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <Ionicons name="close" size={s(20)} color="#fff" />
        </TouchableOpacity>
      )}

      {/* ── Waiting banner (bottom-right) — safe area aware, max width limited ── */}
      {role === 'victim' && !otherCoord && (
        <View style={[
          styles.waitingBanner,
          {
            bottom: safeBottom,
            right: s(12),
            borderRadius: s(12),
            padding: s(10),
            maxWidth: waitingMaxWidth,
          },
        ]}>
          <ActivityIndicator size="small" color="#FF9500" />
          <Text style={[styles.waitingText, { fontSize: s(11) }]}>
            Notified your contacts — they're on their way...
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  map: { flex: 1 },

  loadingMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: { color: '#555' },

  // Distance badge — absolute top, left+right set at render time
  distanceBadge: {
    position: 'absolute',
    zIndex: 10,
    backgroundColor: 'rgba(8,0,0,0.92)',
    borderWidth: 1.5,
    borderColor: '#FF3B30',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#FF3B30',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  distanceBadgeClose: {
    borderColor: '#30D158',
    shadowColor: '#30D158',
    backgroundColor: 'rgba(0,8,0,0.92)',
  },
  distanceValue: {
    color: '#FF3B30',
    fontWeight: '800',
    lineHeight: 22,
  },
  distanceLabel: {
    color: '#666',
    marginTop: 1,
  },
  nearBadge: {
    backgroundColor: '#30D158',
  },
  nearText: { color: '#000', fontWeight: '800' },

  legend: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendDot: {},
  legendText: { color: '#fff', fontWeight: '600', flex: 1 },
  updatedAt: { color: '#444' },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignSelf: 'flex-start',
  },
  refreshBtnText: { color: '#777', fontWeight: '600' },

  closeBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    zIndex: 10,
  },

  waitingBanner: {
    position: 'absolute',
    backgroundColor: 'rgba(20,14,0,0.94)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FF9500',
  },
  waitingText: {
    color: '#FF9500',
    lineHeight: 16,
    flex: 1,
  },

  distanceMarker: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: '#333',
  },
  distanceMarkerText: { color: '#fff', fontWeight: '700' },
});
