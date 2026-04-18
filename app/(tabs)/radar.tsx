import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  HelperInfo,
  getActiveFriendEmergencies,
  removeHelperLocation,
  subscribeFriendLocation,
  subscribeHelperLocations,
} from '../../services/emergency';
import {
  acceptFriendRequest,
  rejectFriendRequest,
  sendFriendRequest,
} from '../../services/friends';
import { Coordinates, getCurrentLocation } from '../../services/location';
import { useAppStore } from '../../store/useAppStore';

// ─── Radar config ─────────────────────────────────────────────────────────────
const INITIAL_RADIUS_KM = 2;       // Phase 1: 2km
const EXPANDED_RADIUS_KM = 10;     // Phase 2: 10km
const EXPAND_AFTER_MS = 60_000;    // Expand after 1 minute

// ─── Scale helper ─────────────────────────────────────────────────────────────
function useScale() {
  const { width, height } = useWindowDimensions();
  const BASE = 375;
  const scale = Math.min(Math.max(width / BASE, 0.8), 1.3);
  const s = (size: number) => Math.round(size * scale);
  return { width, height, s };
}

// Haversine distance (km)
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

interface FriendLocation extends Coordinates {
  deviceId: string;
  nickname: string;
  updatedAt?: number;
}

export default function RadarScreen() {
  const {
    deviceId, friends, pendingRequests, outgoingRequests, helpingState, setHelpingState,
    setFriends, setPendingRequests, setOutgoingRequests,
  } = useAppStore();
  const router = useRouter();
  const { width, height, s } = useScale();

  const { helpingSessionId, friendNickname } = useLocalSearchParams<{
    helpingSessionId?: string;
    friendNickname?: string;
  }>();

  const [myLocation, setMyLocation] = useState<Coordinates | null>(null);
  const [friendLocations, setFriendLocations] = useState<FriendLocation[]>([]);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendIdInput, setFriendIdInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sosFriendLocation, setSosFriendLocation] = useState<(Coordinates & { updatedAt?: number }) | null>(null);
  const [helpers, setHelpers] = useState<HelperInfo[]>([]);
  const [distanceToSos, setDistanceToSos] = useState<number | null>(null);

  // ─── Radar radius state ────────────────────────────────────────────────────
  const [currentRadiusKm, setCurrentRadiusKm] = useState<number>(INITIAL_RADIUS_KM);
  const [radarExpanded, setRadarExpanded] = useState(false);
  const [expandCountdown, setExpandCountdown] = useState<number>(EXPAND_AFTER_MS / 1000); // seconds
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sosStartTimeRef = useRef<number | null>(null);

  const mapRef = useRef<MapView>(null);
  const unsubscribers = useRef<(() => void)[]>([]);
  const unsubscribersForFriendsEmergencies = useRef<(() => void)[]>([]);

  const activeHelpingSessionId = helpingState?.sessionId ?? helpingSessionId ?? null;
  const activeHelpingNickname = helpingState?.friendNickname ?? friendNickname ?? 'Friend';
  const isHelpingMode = !!activeHelpingSessionId;

  const BOTTOM_SHEET_BOTTOM = s(90);

  const { isSOSActive, activeSessionId } = useAppStore();

  // ─── Friends filtered by current radar radius ──────────────────────────────
  const friendsInRadar = (friends ?? []).filter((f) => {
    const fl = friendLocations.find((l) => l.deviceId === f.deviceId);
    if (!fl || !myLocation) return true; // location unknown — dikhao
    const dist = haversineKm(myLocation, fl);
    return dist <= currentRadiusKm;
  });

  // ─── Radar expand logic — Starts when SOS is active ───────────────────────
  useEffect(() => {
    if (!isSOSActive) {
      // SOS ended — reset radar
      clearExpandTimers();
      setCurrentRadiusKm(INITIAL_RADIUS_KM);
      setRadarExpanded(false);
      setExpandCountdown(EXPAND_AFTER_MS / 1000);
      return;
    }

    // SOS started — check if anyone responds
    const hasHelper = helpers.length > 0;
    if (hasHelper) {
      // Helper arrived — no need to expand
      clearExpandTimers();
      return;
    }

    // No one arrived — start countdown
    if (!sosStartTimeRef.current) {
      sosStartTimeRef.current = Date.now();
    }

    startExpandCountdown();

    return () => clearExpandTimers();
  }, [isSOSActive]);

  // Cancel expand when helper arrives
  useEffect(() => {
    if (helpers.length > 0 && isSOSActive) {
      clearExpandTimers();
      console.log('[Radar] Helper arrived, expand cancelled');
    }
  }, [helpers]);

  function startExpandCountdown() {
    clearExpandTimers();

    // Countdown timer
    countdownIntervalRef.current = setInterval(() => {
      setExpandCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Expand timer
    expandTimerRef.current = setTimeout(() => {
      // Check if helpers have arrived
      const currentHelpers = useAppStore.getState().helpingState;
      const helpersCount = helpers.length;
      if (helpersCount === 0) {
        setCurrentRadiusKm(EXPANDED_RADIUS_KM);
        setRadarExpanded(true);
        console.log('[Radar] No one responded — expanded to 10km');
        Alert.alert(
          '📡 Radar Expanded',
          'Nearby friends did not respond.\nExpanding alert to 10km radius to reach more friends.',

          [{ text: 'OK' }]
        );
      }
    }, EXPAND_AFTER_MS);
  }

  function clearExpandTimers() {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }

  // ─── Standard effects ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchMyLocation();
    return () => {
      unsubscribers.current.forEach((u) => u());
      unsubscribersForFriendsEmergencies.current.forEach((u) => u());
      clearExpandTimers();
    };
  }, []);

  useEffect(() => {
    if (myLocation && sosFriendLocation) {
      setDistanceToSos(haversineKm(myLocation, sosFriendLocation));
    }
  }, [myLocation, sosFriendLocation]);

  useEffect(() => {
    if (!isHelpingMode || !activeHelpingSessionId) return;

    const { get: fbGet, ref: fbRef } = require('firebase/database');
    const { rtdb: db } = require('../../config/firebase');
    fbGet(fbRef(db, `live_locations/${activeHelpingSessionId}`)).then((snap: any) => {
      if (!snap.exists()) return;
      const d = snap.val();
      const lat = d?.latitude ?? d?.lat ?? d?.location?.lat;
      const lon = d?.longitude ?? d?.lng ?? d?.lon ?? d?.location?.lng ?? d?.location?.lon;
      if (lat != null && lon != null) {
        const loc = { latitude: lat, longitude: lon, updatedAt: d?.updatedAt ?? Date.now() };
        setSosFriendLocation(loc);
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: lat, longitude: lon,
            latitudeDelta: 0.01, longitudeDelta: 0.01,
          }, 800);
        }
      }
    }).catch(() => {});

    const unsub = subscribeFriendLocation(activeHelpingSessionId, (loc) => {
      setSosFriendLocation(loc);
      if (mapRef.current && loc) {
        mapRef.current.animateToRegion({
          latitude: loc.latitude, longitude: loc.longitude,
          latitudeDelta: 0.01, longitudeDelta: 0.01,
        }, 1000);
      }
    });
    unsubscribers.current.push(unsub);
    return () => unsub();
  }, [activeHelpingSessionId, isHelpingMode]);

  useEffect(() => {
    if (!isSOSActive || !activeSessionId) return;
    const unsub = subscribeHelperLocations(activeSessionId, setHelpers);
    unsubscribers.current.push(unsub);
    return () => unsub();
  }, [isSOSActive, activeSessionId]);

  useEffect(() => {
    unsubscribersForFriendsEmergencies.current.forEach((u) => u());
    unsubscribersForFriendsEmergencies.current = [];
    const friendIdsInEmergency = (friends ?? []).filter((f) => f.isInEmergency).map((f) => f.deviceId);
    if (friendIdsInEmergency.length === 0) return;
    getActiveFriendEmergencies(friendIdsInEmergency).then((sessions) => {
      sessions.forEach((session) => {
        const friend = (friends ?? []).find((f) => f.deviceId === session.deviceId);
        if (!friend) return;
        const unsub = subscribeFriendLocation(session.sessionId, (loc) => {
          setFriendLocations((prev) => {
            const existing = prev.findIndex((fl) => fl.deviceId === friend.deviceId);
            const updated: FriendLocation = { ...loc, deviceId: friend.deviceId, nickname: friend.nickname };
            if (existing >= 0) { const n = [...prev]; n[existing] = updated; return n; }
            return [...prev, updated];
          });
        });
        unsubscribersForFriendsEmergencies.current.push(unsub);
      });
    }).catch(() => {});
    return () => {
      unsubscribersForFriendsEmergencies.current.forEach((u) => u());
      unsubscribersForFriendsEmergencies.current = [];
    };
  }, [friends]);

  async function fetchMyLocation() {
    const coords = await getCurrentLocation();
    if (coords) setMyLocation(coords);
  }

  async function stopHelping() {
    if (!activeHelpingSessionId || !deviceId) return;
    Alert.alert('Stop Helping?', 'Have you finished helping or can you not go?', [
      { text: 'Continue helping', style: 'cancel' },
      {
        text: 'Stop', style: 'destructive',
        onPress: async () => {
          await removeHelperLocation(activeHelpingSessionId, deviceId);
          setHelpingState(null);
          setSosFriendLocation(null);
        },
      },
    ]);
  }

  async function handleSendFriendRequest() {
    if (!deviceId || !friendIdInput.trim()) return;
    if (friendIdInput.trim() === deviceId) { Alert.alert('Error', "This is your own ID 😅"); return; }
    setIsLoading(true);
    const result = await sendFriendRequest(deviceId, friendIdInput.trim());
    setIsLoading(false);
    setFriendIdInput('');
    setShowAddFriend(false);
    setOutgoingRequests([...(outgoingRequests ?? []), friendIdInput.trim()]);
    Alert.alert(result.success ? '✅' : '❌', result.message);
  }

  async function handleAcceptRequest(fromId: string) {
    if (!deviceId) return;
    await acceptFriendRequest(deviceId, fromId);
    setPendingRequests((pendingRequests ?? []).filter((id) => id !== fromId));
    Alert.alert('✅', 'Friend request accepted!');
  }

  async function handleRejectRequest(fromId: string) {
    if (!deviceId) return;
    await rejectFriendRequest(deviceId, fromId);
    setPendingRequests((pendingRequests ?? []).filter((id) => id !== fromId));
  }

  const initialRegion = myLocation
    ? { latitude: myLocation.latitude, longitude: myLocation.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 19.076, longitude: 72.8777, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  const pendingCount = (pendingRequests ?? []).length;

  return (
    <SafeAreaView style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        mapType={Platform.OS === 'android' ? 'standard' : 'mutedStandard'}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {myLocation && (
          <Circle
            center={myLocation} radius={100}
            fillColor="rgba(0,122,255,0.12)" strokeColor="rgba(0,122,255,0.5)" strokeWidth={2}
          />
        )}

        {/* ─── Radar radius circle ─── */}
        {myLocation && isSOSActive && (
          <>
            <Circle
              center={myLocation}
              radius={currentRadiusKm * 1000}
              fillColor={radarExpanded ? 'rgba(255,149,0,0.06)' : 'rgba(255,59,48,0.06)'}
              strokeColor={radarExpanded ? 'rgba(255,149,0,0.5)' : 'rgba(255,59,48,0.4)'}
              strokeWidth={2}
            />
            {/* Inner 2km circle (reference) when expanded */}
            {radarExpanded && (
              <Circle
                center={myLocation}
                radius={INITIAL_RADIUS_KM * 1000}
                fillColor="transparent"
                strokeColor="rgba(255,59,48,0.2)"
                strokeWidth={1}
              />
            )}
          </>
        )}

        {isHelpingMode && sosFriendLocation && (
          <>
            <Marker
              coordinate={{ latitude: sosFriendLocation.latitude, longitude: sosFriendLocation.longitude }}
              title={`🚨 ${activeHelpingNickname}`} description="They need help!"
            >
              <View style={styles.sosFriendMarker}>
                <Text style={styles.markerEmoji}>🚨</Text>
              </View>
            </Marker>
            <Circle
              center={{ latitude: sosFriendLocation.latitude, longitude: sosFriendLocation.longitude }}
              radius={200} fillColor="rgba(255,59,48,0.12)" strokeColor="rgba(255,59,48,0.55)" strokeWidth={2}
            />
          </>
        )}

        {isSOSActive && helpers.map((h) =>
          h.latitude && h.longitude ? (
            <Marker key={h.deviceId} coordinate={{ latitude: h.latitude!, longitude: h.longitude! }}
              title={`🏃 ${h.nickname}`} description="Coming to help you!">
              <View style={styles.helperMarker}><Text style={styles.markerEmoji}>🏃</Text></View>
            </Marker>
          ) : null
        )}

        {!isHelpingMode && friendLocations.map((fl, idx) => (
          <Marker key={fl.deviceId ?? `fl_${idx}`}
            coordinate={{ latitude: fl.latitude, longitude: fl.longitude }}
            title={`🚨 ${fl.nickname}`} description="SOS Active!">
            <View style={styles.sosFriendMarker}><Text style={styles.markerEmoji}>🚨</Text></View>
          </Marker>
        ))}
      </MapView>

      {/* ─── Top Overlay ─── */}
      <View style={[styles.topOverlay, { padding: s(16), paddingTop: s(48) }]}>
        <View style={[styles.topBar, { marginBottom: s(10) }]}>
          <Text style={[styles.title, { fontSize: s(21) }]}>
            {isHelpingMode ? `Helping ${activeHelpingNickname}` : 'Radar'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(8) }}>
            {isHelpingMode && distanceToSos !== null && (
              <View style={[styles.distanceBadge, { paddingHorizontal: s(10), paddingVertical: s(6), borderRadius: s(12) }]}>
                <Text style={[styles.distanceBadgeText, { fontSize: s(12) }]}>
                  📍 {formatDistance(distanceToSos)}
                </Text>
              </View>
            )}
            <View style={[styles.topActions, { gap: s(8) }]}>
              <TouchableOpacity
                style={[styles.iconBtn, { padding: s(10), borderRadius: s(22) }]}
                onPress={() => mapRef.current?.animateToRegion(initialRegion, 1000)}
              >
                <Ionicons name="locate" size={s(19)} color="#fff" />
              </TouchableOpacity>
              {!isHelpingMode && (
                <TouchableOpacity
                  style={[styles.iconBtn, { padding: s(10), borderRadius: s(22) }, pendingCount > 0 && styles.iconBtnAlert]}
                  onPress={() => setShowAddFriend(true)}
                >
                  <Ionicons name="person-add" size={s(19)} color="#fff" />
                  {pendingCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={[styles.badgeText, { fontSize: s(10) }]}>{pendingCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Device ID Card */}
        <View style={[styles.deviceIdCard, { borderRadius: s(12), padding: s(12) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(6), marginBottom: s(4) }}>
            <View style={styles.deviceIdDot} />
            <Text style={[styles.deviceIdLabel, { fontSize: s(11) }]}>My Device ID</Text>
          </View>
          <Text style={[styles.deviceIdValue, { fontSize: s(12) }]} selectable>
            {deviceId ?? 'Loading...'}
          </Text>
          <View style={[styles.deviceIdActions, { gap: s(6), marginTop: s(8) }]}>
            <TouchableOpacity
              style={[styles.smallBtn, { paddingHorizontal: s(12), paddingVertical: s(6), borderRadius: s(8) }]}
              onPress={async () => {
                if (!deviceId) return Alert.alert('Error', 'Device ID not available');
                try {
                  const Clip = await import('expo-clipboard');
                  await Clip.setStringAsync(deviceId);
                  Alert.alert('Copied', 'Device ID copied!');
                } catch { Alert.alert('Error', 'Copy manually'); }
              }}
            >
              <Ionicons name="copy-outline" size={s(12)} color="#aaa" style={{ marginRight: 4 }} />
              <Text style={[styles.smallBtnText, { fontSize: s(12) }]}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallBtn, { paddingHorizontal: s(12), paddingVertical: s(6), borderRadius: s(8) }]}
              onPress={async () => {
                if (!deviceId) return Alert.alert('Error', 'Device ID not available');
                try { await Share.share({ message: deviceId }); } catch { Alert.alert('Error', 'Share failed'); }
              }}
            >
              <Ionicons name="share-outline" size={s(12)} color="#aaa" style={{ marginRight: 4 }} />
              <Text style={[styles.smallBtnText, { fontSize: s(12) }]}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ─── Radar Expand Banner (SOS active, waiting for response) ─── */}
      {isSOSActive && !radarExpanded && helpers.length === 0 && (
        <View style={[styles.radarBanner, {
          top: s(200), left: s(16), right: s(16),
          borderRadius: s(14), padding: s(12),
        }]}>
          <Ionicons name="radio-outline" size={s(16)} color="#FF3B30" />
          <View style={{ flex: 1, marginLeft: s(8) }}>
            <Text style={[styles.radarBannerTitle, { fontSize: s(13) }]}>
              📡 Alerted friends within 2km
            </Text>
            <Text style={[styles.radarBannerSub, { fontSize: s(11) }]}>
              If no one responds in {expandCountdown}s, expanding to 10km
            </Text>
          </View>
        </View>
      )}

      {/* ─── Radar Expanded Banner ─── */}
      {isSOSActive && radarExpanded && (
        <View style={[styles.radarExpandedBanner, {
          top: s(200), left: s(16), right: s(16),
          borderRadius: s(14), padding: s(12),
        }]}>
          <Ionicons name="radio-outline" size={s(16)} color="#FF9500" />
          <View style={{ flex: 1, marginLeft: s(8) }}>
            <Text style={[styles.radarExpandedTitle, { fontSize: s(13) }]}>
              📡 Radar expanded to 10km!
            </Text>
            <Text style={[styles.radarExpandedSub, { fontSize: s(11) }]}>
              Nearby friends didn't respond — expanded alert to more friends
            </Text>
          </View>
        </View>
      )}

      {/* ─── Helper Mode Banner ─── */}
      {isHelpingMode && (
        <View style={[styles.helpingBanner, {
          bottom: BOTTOM_SHEET_BOTTOM + s(14),
          left: s(16), right: s(16),
          borderRadius: s(18), padding: s(16),
        }]}>
          <View style={styles.helpingBannerLeft}>
            <Text style={[styles.helpingBannerTitle, { fontSize: s(14) }]}>🏃 Help Mode Active</Text>
            <Text style={[styles.helpingBannerSub, { fontSize: s(12) }]}>
              {sosFriendLocation
                ? `${activeHelpingNickname}'s location updating live`
                : `Searching ${activeHelpingNickname}'s location...`}
            </Text>
            {sosFriendLocation && (
              <TouchableOpacity
                style={[styles.openMapBtn, { borderRadius: s(8), paddingHorizontal: s(10), paddingVertical: s(5), marginTop: s(8) }]}
                onPress={() => router.push({
                  pathname: '/sos-map',
                  params: {
                    sessionId: activeHelpingSessionId!,
                    role: 'helper',
                    victimLat: sosFriendLocation.latitude.toString(),
                    victimLon: sosFriendLocation.longitude.toString(),
                  },
                })}
              >
                <Ionicons name="map" size={s(13)} color="#30D158" />
                <Text style={[styles.openMapBtnText, { fontSize: s(12) }]}>Open Distance Map</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.stopHelpBtn, { paddingHorizontal: s(14), paddingVertical: s(9), borderRadius: s(10) }]}
            onPress={stopHelping}
          >
            <Text style={[styles.stopHelpBtnText, { fontSize: s(13) }]}>Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Bottom Sheet: Friends ─── */}
      {!isHelpingMode && (
        <View style={[styles.bottomSheet, {
          bottom: BOTTOM_SHEET_BOTTOM,
          left: s(16), right: s(16),
          borderRadius: s(18), padding: s(14),
        }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: s(10) }}>
            <Text style={[styles.bottomTitle, { fontSize: s(14) }]}>
              Friends{friendsInRadar.length > 0 ? ` (${friendsInRadar.length}${currentRadiusKm === INITIAL_RADIUS_KM ? ' · 2km' : ' · 10km'})` : ''}
            </Text>
            <TouchableOpacity onPress={() => setShowAddFriend(true)}>
              <Text style={[{ color: '#FF3B30', fontSize: s(12), fontWeight: '700' }]}>+ Add</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {friendsInRadar.length === 0 ? (
              <Text style={[styles.emptyText, { fontSize: s(13) }]}>
                {(friends ?? []).length === 0
                  ? 'No friends yet — tap "+ Add" to connect'
                  : `No friends within ${currentRadiusKm}km`}
              </Text>
            ) : (
              friendsInRadar.map((f, idx) => (
                <View
                  key={f.deviceId ?? `friend_${idx}`}
                  style={[styles.friendChip, f.isInEmergency && styles.friendChipEmergency, { borderRadius: s(20), paddingHorizontal: s(12), paddingVertical: s(8), marginRight: s(8) }]}
                >
                  <View style={[styles.friendDot, f.isInEmergency ? styles.dotEmergency : styles.dotSafe]} />
                  <Text style={[styles.friendChipText, { fontSize: s(13) }]}>{f.nickname}</Text>
                  {f.isInEmergency && <Text>🚨</Text>}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {/* ─── Add Friend Modal ─── */}
      <Modal visible={showAddFriend} animationType="slide" presentationStyle="overFullScreen" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { padding: s(24), paddingBottom: s(44) }]}>
            <View style={styles.modalHandle} />
            <Text style={[styles.modalTitle, { fontSize: s(22), marginBottom: s(20) }]}>Friends</Text>

            {(pendingRequests ?? []).length > 0 && (
              <View style={[styles.section, { marginBottom: s(22) }]}>
                <Text style={[styles.sectionTitle, { fontSize: s(12), marginBottom: s(12) }]}>
                  Pending Requests ({(pendingRequests ?? []).length})
                </Text>
                {(pendingRequests ?? []).map((fromId) => (
                  <View key={fromId} style={[styles.requestRow, { gap: s(10), marginBottom: s(10) }]}>
                    <Text style={[styles.requestId, { fontSize: s(13) }]}>{fromId.slice(0, 12)}...</Text>
                    <TouchableOpacity
                      style={[styles.requestBtn, styles.acceptBtn, { paddingHorizontal: s(12), paddingVertical: s(7), borderRadius: s(8) }]}
                      onPress={() => handleAcceptRequest(fromId)}
                    >
                      <Text style={[styles.requestBtnText, { fontSize: s(13) }]}>✓ Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.requestBtn, styles.rejectBtn, { paddingHorizontal: s(12), paddingVertical: s(7), borderRadius: s(8) }]}
                      onPress={() => handleRejectRequest(fromId)}
                    >
                      <Text style={[styles.requestBtnText, { fontSize: s(13) }]}>✗</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View style={[styles.section, { marginBottom: s(20) }]}>
              <Text style={[styles.sectionTitle, { fontSize: s(12), marginBottom: s(12) }]}>Add Friend by Device ID</Text>
              <TextInput
                style={[styles.input, { fontSize: s(14), padding: s(14), marginBottom: s(10), borderRadius: s(12) }]}
                placeholder="Paste friend's Device ID..."
                placeholderTextColor="#555"
                value={friendIdInput}
                onChangeText={setFriendIdInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.pasteBtn, { padding: s(12), borderRadius: s(10), marginBottom: s(10) }]}
                onPress={async () => {
                  try {
                    const Clip = await import('expo-clipboard');
                    const text = await Clip.getStringAsync();
                    if (text) setFriendIdInput(text.trim());
                  } catch { Alert.alert('Error', 'Paste manually'); }
                }}
              >
                <Ionicons name="clipboard-outline" size={s(15)} color="#888" />
                <Text style={[styles.pasteBtnText, { fontSize: s(14) }]}>Paste from clipboard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, isLoading && styles.sendBtnDisabled, { padding: s(14), borderRadius: s(12) }]}
                onPress={handleSendFriendRequest}
                disabled={isLoading}
              >
                <Text style={[styles.sendBtnText, { fontSize: s(15) }]}>
                  {isLoading ? 'Sending...' : 'Send Request'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.closeBtn, { padding: s(14) }]} onPress={() => setShowAddFriend(false)}>
              <Text style={[styles.closeBtnText, { fontSize: s(15) }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff', fontWeight: '800', textShadowColor: '#000', textShadowRadius: 10, flex: 1 },
  topActions: { flexDirection: 'row' },
  iconBtn: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  iconBtnAlert: { borderColor: '#FF3B30' },
  badge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#FF3B30', borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontWeight: '800' },

  distanceBadge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  distanceBadgeText: { color: '#fff', fontWeight: '800' },

  deviceIdCard: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  deviceIdDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#30D158' },
  deviceIdLabel: { color: '#666', fontWeight: '600' },
  deviceIdValue: { color: '#ccc', fontFamily: 'monospace' },
  deviceIdActions: { flexDirection: 'row' },
  smallBtn: {
    backgroundColor: '#181818',
    flexDirection: 'row',
    alignItems: 'center',
  },
  smallBtnText: { color: '#aaa', fontWeight: '600' },

  // Radar banners
  radarBanner: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,0,0,0.88)',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  radarBannerTitle: { color: '#FF3B30', fontWeight: '700' },
  radarBannerSub: { color: '#888', marginTop: 2 },

  radarExpandedBanner: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(12,8,0,0.90)',
    borderWidth: 1,
    borderColor: '#FF9500',
  },
  radarExpandedTitle: { color: '#FF9500', fontWeight: '700' },
  radarExpandedSub: { color: '#888', marginTop: 2 },

  sosFriendMarker: {
    backgroundColor: '#FF3B30', borderRadius: 20, padding: 8,
    borderWidth: 2, borderColor: '#fff',
  },
  helperMarker: {
    backgroundColor: '#30D158', borderRadius: 20, padding: 8,
    borderWidth: 2, borderColor: '#fff',
  },
  markerEmoji: { fontSize: 18 },

  helpingBanner: {
    position: 'absolute',
    backgroundColor: 'rgba(10,30,10,0.96)',
    borderWidth: 1, borderColor: '#30D158',
    flexDirection: 'row',
    alignItems: 'center',
  },
  helpingBannerLeft: { flex: 1 },
  helpingBannerTitle: { color: '#30D158', fontWeight: '800' },
  helpingBannerSub: { color: '#999', marginTop: 2 },
  stopHelpBtn: { backgroundColor: '#FF3B30' },
  stopHelpBtnText: { color: '#fff', fontWeight: '700' },
  openMapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(48,209,88,0.12)',
    borderWidth: 1, borderColor: '#30D158',
  },
  openMapBtnText: { color: '#30D158', fontWeight: '700' },

  bottomSheet: {
    position: 'absolute',
    backgroundColor: 'rgba(8,8,8,0.92)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  bottomTitle: { color: '#fff', fontWeight: '700' },
  emptyText: { color: '#444' },
  friendChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#222',
  },
  friendChipEmergency: { borderColor: '#FF3B30', backgroundColor: '#150404' },
  friendDot: { width: 7, height: 7, borderRadius: 3.5 },
  dotSafe: { backgroundColor: '#30D158' },
  dotEmergency: { backgroundColor: '#FF3B30' },
  friendChipText: { color: '#ccc', fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#0e0e0e',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderTopColor: '#222',
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#333', alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { color: '#fff', fontWeight: '800' },
  section: {},
  sectionTitle: { color: '#555', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  requestRow: { flexDirection: 'row', alignItems: 'center' },
  requestId: { flex: 1, color: '#aaa', fontFamily: 'monospace' },
  requestBtn: {},
  acceptBtn: { backgroundColor: '#0f2a0f' },
  rejectBtn: { backgroundColor: '#2a0f0f' },
  requestBtnText: { color: '#fff', fontWeight: '700' },
  input: {
    backgroundColor: '#181818',
    color: '#fff',
    borderWidth: 1, borderColor: '#2a2a2a',
    fontFamily: 'monospace',
  },
  pasteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#181818',
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  pasteBtnText: { color: '#888' },
  sendBtn: { backgroundColor: '#FF3B30', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontWeight: '700' },
  closeBtn: { alignItems: 'center' },
  closeBtnText: { color: '#555' },
});