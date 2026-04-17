
import { Ionicons } from '@expo/vector-icons';
import { ref as dbRef, get } from 'firebase/database';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { rtdb } from '../../config/firebase';
import {
    subscribeFriendLocation,
    subscribeHelperLocations,
    updateHelperLocation,
} from '../../services/emergency';
import { Coordinates, getCurrentLocation, watchLocation } from '../../services/location';

// ─── Haversine Distance ────────────────────────────────────────────────────────

function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface SOSMapProps {
  sessionId: string;
  /** 'victim' = person who pressed SOS, 'helper' = friend coming to help */
  role: 'victim' | 'helper';
  myDeviceId: string;
  myNickname?: string;
  /** Pass victim's known location so map loads instantly (no blank screen) */
  initialVictimLocation?: Coordinates;
  onClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SOSMapScreen({
  sessionId,
  role,
  myDeviceId,
  myNickname = 'You',
  initialVictimLocation,
  onClose,
}: SOSMapProps) {
  // Victim's location (red pin)
  const [victimLoc, setVictimLoc] = useState<Coordinates | null>(
    role === 'victim' ? (initialVictimLocation ?? null) : (initialVictimLocation ?? null)
  );
  // Helper's location (green pin)
  const [helperLoc, setHelperLoc] = useState<Coordinates | null>(null);
  const [helperName, setHelperName] = useState('Helper');
  const [victimName, setVictimName] = useState<string | null>(null);
  // My own current location
  const [myLoc, setMyLoc] = useState<Coordinates | null>(
    role === 'victim' ? (initialVictimLocation ?? null) : null
  );
  const [distance, setDistance] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const mapRef = useRef<MapView>(null);
  const stopWatch = useRef<(() => void) | null>(null);
  const stopSub = useRef<(() => void) | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollCount = useRef(0);

  // ── Location subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    if (role === 'victim') {
      // Track own location and push to Firebase
      stopWatch.current = watchLocation((coords) => {
        setMyLoc(coords);
        setVictimLoc(coords);
        setLastUpdated(new Date());
      });

      // Subscribe to helper(s) locations
      stopSub.current = subscribeHelperLocations(sessionId, (helpers) => {
        console.log('[SOSMapScreen] Helper locations updated:', { sessionId, helpers });
        if (helpers.length > 0) {
          const h = helpers[0]; // Show nearest / first helper
          if (h.latitude != null && h.longitude != null) {
            setHelperLoc({ latitude: h.latitude, longitude: h.longitude });
            setHelperName(h.nickname);
            setLastUpdated(new Date());
          }
        }
      });
    } else {
      // ── HELPER MODE ──
      console.log('[SOSMapScreen] Helper mode initialized', { sessionId, myDeviceId });
      
      // Get initial location immediately
      getCurrentLocation().then((coords) => {
        if (coords) {
          console.log('[SOSMapScreen] Got helper initial location:', coords);
          setMyLoc(coords);
          updateHelperLocation(sessionId, myDeviceId, coords, myNickname);
        }
      });

      // Watch own location → update Firebase every 5s
      stopWatch.current = watchLocation(async (coords) => {
        setMyLoc(coords);
        setHelperLoc(coords); // helper's own marker
        await updateHelperLocation(sessionId, myDeviceId, coords, myNickname);
        setLastUpdated(new Date());
      });

      // ✅ FIX: Fetch victim's initial location synchronously FIRST
      const fetchVictimInitialLocation = async () => {
        try {
          console.log('[SOSMapScreen] Fetching victim initial location...', { sessionId });
          const snap = await get(dbRef(rtdb, `live_locations/${sessionId}`));
          const data = snap.val();
          
          if (data) {
            const lat = data.latitude ?? data.lat ?? data.location?.lat;
            const lon = data.longitude ?? data.lng ?? data.lon ?? data.location?.lng ?? data.location?.lon;
            if (lat != null && lon != null) {
              const loc = { latitude: lat, longitude: lon, updatedAt: data.updatedAt ?? Date.now() };
              console.log('[SOSMapScreen] Initial victim location fetched:', loc);
              setVictimLoc(loc);
              setLastUpdated(new Date());
            }
          } else {
            console.warn('[SOSMapScreen] No victim location data found in initial fetch');
          }
        } catch (e) {
          console.warn('[SOSMapScreen] Error fetching initial victim location:', e);
        }
      };

      // Fetch initial location first, then subscribe for real-time updates
      fetchVictimInitialLocation().then(() => {
        // Subscribe to victim's live location for real-time updates
        console.log('[SOSMapScreen] Setting up subscribeFriendLocation for real-time updates', { sessionId });
        stopSub.current = subscribeFriendLocation(sessionId, (loc) => {
          console.log('[SOSMapScreen] Victim location updated via subscription:', { sessionId, loc });
          setVictimLoc(loc);
          setLastUpdated(new Date());
        });
      });

      // Fetch victim's nickname from the emergency session to show on helper screen
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
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    };
  }, [sessionId, role, myDeviceId]);

  // ── Distance calculation ────────────────────────────────────────────────────
  useEffect(() => {
    // Compute distance when we have my location and the other person's location,
    // regardless of the `role` prop. This makes the helper view resilient if
    // the route param was incorrect or delayed.
    const other = otherCoord; // either victimLoc or helperLoc depending on role
    if (myLoc && other) {
      const d = haversineKm(myLoc, other);
      try { console.log('[SOSMap] distance calc', { sessionId, role, a: myLoc, b: other, distance: d }); } catch {}
      setDistance(d);
    } else {
      try { console.log('[SOSMap] distance skipped — missing coords', { sessionId, role, myLoc, other }); } catch {}
      setDistance(null);
    }
  }, [myLoc, helperLoc, victimLoc, role]);

  // ── Fit map to show both markers ────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const points: Coordinates[] = [];
    if (victimLoc) points.push(victimLoc);
    if (helperLoc) points.push(helperLoc);
    if (points.length >= 2) {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: 120, right: 60, bottom: 140, left: 60 },
        animated: true,
      });
    }
  }, [victimLoc, helperLoc, mapReady]);

  // ── Which marker am I (my pin) and which is the other ──────────────────────
  const myMarkerCoord = role === 'victim' ? myLoc : myLoc;
  const otherCoord = role === 'victim' ? helperLoc : victimLoc;
  const myColor = role === 'victim' ? '#FF3B30' : '#30D158';
  const otherColor = role === 'victim' ? '#30D158' : '#FF3B30';
  const myLabel = role === 'victim' ? '🚨 You' : '🏃 You';
  const otherLabel = role === 'victim' ? `${helperName} coming` : (victimName ? `${victimName} — needs help` : '🆘 Needs help');

  const centerForMap = myMarkerCoord ?? victimLoc;

  async function fetchLiveLocationNow() {
    try {
      const snap = await get(dbRef(rtdb, `live_locations/${sessionId}`));
      const data = snap.val();
      if (data) {
        const lat = data.latitude ?? data.lat ?? data.location?.lat;
        const lon = data.longitude ?? data.lng ?? data.lon ?? data.location?.lng ?? data.location?.lon;
        if (lat != null && lon != null) {
          const loc = { latitude: lat, longitude: lon, updatedAt: data.updatedAt ?? Date.now() };
          setVictimLoc(loc);
          setLastUpdated(new Date());
          console.log('[SOSMap] manual fetch live location', sessionId, loc);
          return;
        }
      }
      console.log('[SOSMap] manual fetch: no live location found', sessionId);
    } catch (err) {
      console.warn('manual fetch live location error', err);
    }
  }

  return (
    <View style={styles.container}>

      {/* Debug overlay (dev and helper diagnostic) */}
      {( __DEV__ || (role === 'helper' && (!victimLoc || distance === null)) ) && (
        <View style={styles.debugBox}>
          <Text style={styles.debugTitle}>DBG</Text>
          <Text style={styles.debugText}>role: {role}</Text>
          <Text style={styles.debugText}>myLoc: {myLoc ? `${myLoc.latitude.toFixed(5)}, ${myLoc.longitude.toFixed(5)}` : '—'}</Text>
          <Text style={styles.debugText}>victimLoc: {victimLoc ? `${victimLoc.latitude.toFixed(5)}, ${victimLoc.longitude.toFixed(5)}` : '—'}</Text>
          <Text style={styles.debugText}>helperLoc: {helperLoc ? `${helperLoc.latitude.toFixed(5)}, ${helperLoc.longitude.toFixed(5)}` : '—'}</Text>
        </View>
      )}

      {/* ── Distance Badge ── */}
      <View style={[
        styles.distanceBadge,
        // push the badge down a bit on helper route so it isn't hidden by surrounding headers
        role === 'helper' && { top: 90 },
        distance !== null && distance < 0.3 && styles.distanceBadgeClose,
      ]}>
        <Ionicons name="navigate-circle" size={18} color="#FF3B30" />
        <View>
          <Text style={styles.distanceValue}>
            {distance !== null ? formatDistance(distance) : 'Calculating...'}
          </Text>
          <Text style={styles.distanceLabel}>
            {role === 'victim'
              ? otherCoord ? 'Helper is this far' : 'Waiting for helper...'
              : victimName ? `Distance to ${victimName}` : 'You are this far from them'}
          </Text>
        </View>
        {distance !== null && distance < 0.3 && (
          <View style={styles.nearBadge}>
            <Text style={styles.nearText}>NEARBY!</Text>
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
          {/* My pin */}
          {myMarkerCoord && (
            <Marker
              coordinate={myMarkerCoord}
              title={myLabel}
              description={role === 'victim' ? 'Your SOS location' : `${myNickname} — coming to help`}
              pinColor={myColor}
            />
          )}

          {/* Other person's pin */}
          {otherCoord && (
            <Marker
              coordinate={otherCoord}
              title={otherLabel}
              description={role === 'victim' ? 'Helper is here' : 'Person who needs help'}
              pinColor={otherColor}
            />
          )}

          {/* Dotted / highlighted line between them (background + foreground for visibility) */}
          {myMarkerCoord && otherCoord && (
            <>
              <Polyline
                coordinates={[myMarkerCoord, otherCoord]}
                strokeColor={role === 'victim' ? '#00000066' : '#00000066'}
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
          {/* Distance label at midpoint */}
          {myMarkerCoord && otherCoord && distance !== null && (
            (() => {
              const mid = {
                latitude: (myMarkerCoord.latitude + otherCoord.latitude) / 2,
                longitude: (myMarkerCoord.longitude + otherCoord.longitude) / 2,
              };
              return (
                <Marker coordinate={mid} anchor={{ x: 0.5, y: 0.5 }}>
                  <View style={styles.distanceMarker}>
                    <Text style={styles.distanceMarkerText}>{formatDistance(distance)}</Text>
                  </View>
                </Marker>
              );
            })()
          )}
        </MapView>
      ) : (
        <View style={styles.loadingMap}>
          <ActivityIndicator size="large" color="#FF3B30" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

      {/* ── Legend ── */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: myColor }]} />
          <Text style={styles.legendText}>{myLabel}</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtnSmall} onPress={fetchLiveLocationNow}>
          <Text style={styles.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>
        {otherCoord && (
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: otherColor }]} />
            <Text style={styles.legendText}>{otherLabel}</Text>
          </View>
        )}
        {lastUpdated && (
          <Text style={styles.updatedAt}>
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
        )}
      </View>

      {/* ── Close / Back button ── */}
      {onClose && (
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Ionicons name="close" size={18} color="#fff" />
        </TouchableOpacity>
      )}

      {/* ── Helper not arrived yet message ── */}
      {role === 'victim' && !otherCoord && (
        <View style={styles.waitingBanner}>
          <ActivityIndicator size="small" color="#FF9500" />
          <Text style={styles.waitingText}>
            Notified your friend — they're on their way...
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  map: { flex: 1 },

  loadingMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: { color: '#555', fontSize: 15 },

  // Distance badge at top
  distanceBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: 'rgba(10,0,0,0.92)',
    borderWidth: 1.5,
    borderColor: '#FF3B30',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#FF3B30',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  distanceBadgeClose: {
    borderColor: '#30D158',
    shadowColor: '#30D158',
  },
  distanceValue: {
    color: '#FF3B30',
    fontWeight: '800',
    fontSize: 20,
    lineHeight: 22,
  },
  distanceLabel: {
    color: '#888',
    fontSize: 11,
    marginTop: 1,
  },
  nearBadge: {
    backgroundColor: '#30D158',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nearText: { color: '#000', fontSize: 10, fontWeight: '800' },

  debugBox: {
    position: 'absolute',
    top: 70,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
    borderRadius: 8,
    zIndex: 50,
  },
  debugTitle: { color: '#FF3B30', fontWeight: '800', marginBottom: 6 },
  debugText: { color: '#fff', fontSize: 11, lineHeight: 14 },

  // Legend bottom-left
  legend: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  updatedAt: { color: '#444', fontSize: 10, marginTop: 4 },

  // Close button top-right
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },

  // Waiting banner bottom-right
  waitingBanner: {
    position: 'absolute',
    bottom: 40,
    right: 16,
    backgroundColor: 'rgba(26,18,0,0.92)',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#FF9500',
    maxWidth: 180,
  },
  waitingText: {
    color: '#FF9500',
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },
  distanceMarker: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  distanceMarkerText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  refreshBtnSmall: {
    position: 'absolute',
    top: 6,
    right: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  refreshBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});