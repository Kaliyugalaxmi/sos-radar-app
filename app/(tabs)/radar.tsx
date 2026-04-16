// app/(tabs)/radar.tsx
// Radar Screen — friends ki location + helper mode
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from "react-native-safe-area-context";
import {
    HelperInfo,
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

interface FriendLocation extends Coordinates {
  deviceId: string;
  nickname: string;
  updatedAt?: number;
}

export default function RadarScreen() {
  const { deviceId, friends, pendingRequests, outgoingRequests, helpingState, setHelpingState,
          setFriends, setPendingRequests, setOutgoingRequests } = useAppStore();

  // URL params — jab notification se aao ya _layout se navigate ho
  const { helpingSessionId, friendNickname } = useLocalSearchParams<{
    helpingSessionId?: string;
    friendNickname?: string;
  }>();

  const [myLocation, setMyLocation] = useState<Coordinates | null>(null);
  const [friendLocations, setFriendLocations] = useState<FriendLocation[]>([]);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [friendIdInput, setFriendIdInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Helper mode: SOS person ki live location
  const [sosFriendLocation, setSosFriendLocation] = useState<(Coordinates & { updatedAt?: number }) | null>(null);
  // SOS person ke helpers (agar mai SOS person hoon)
  const [helpers, setHelpers] = useState<HelperInfo[]>([]);

  const mapRef = useRef<MapView>(null);
  const unsubscribers = useRef<(() => void)[]>([]);

  // Active helping session — ya store se ya URL params se
  const activeHelpingSessionId = helpingState?.sessionId ?? helpingSessionId ?? null;
  const activeHelpingNickname = helpingState?.friendNickname ?? friendNickname ?? 'Dost';
  const isHelpingMode = !!activeHelpingSessionId;

  useEffect(() => {
    fetchMyLocation();
    return () => {
      unsubscribers.current.forEach((u) => u());
    };
  }, []);

  // Helper mode: SOS person ki location subscribe karo
  useEffect(() => {
    if (!isHelpingMode || !activeHelpingSessionId) return;

    const unsub = subscribeFriendLocation(activeHelpingSessionId, (loc) => {
      setSosFriendLocation(loc);
      // Map ko uski location par le jao
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: loc.latitude,
          longitude: loc.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      }
    });

    unsubscribers.current.push(unsub);
    return () => unsub();
  }, [activeHelpingSessionId, isHelpingMode]);

  // Agar main SOS person hoon, helpers subscribe karo
  const { isSOSActive, activeSessionId } = useAppStore();
  useEffect(() => {
    if (!isSOSActive || !activeSessionId) return;

    const unsub = subscribeHelperLocations(activeSessionId, (h) => setHelpers(h));
    unsubscribers.current.push(unsub);
    return () => unsub();
  }, [isSOSActive, activeSessionId]);

  // Normal mode: Friends ki emergency locations subscribe karo
  useEffect(() => {
    unsubscribers.current.forEach((u) => u());
    unsubscribers.current = [];

    (friends ?? [])
      .filter((f) => f.isInEmergency)
      .forEach((friend) => {
        const sessionId = `sos_${friend.deviceId}_latest`;
        const unsub = subscribeFriendLocation(sessionId, (loc) => {
          setFriendLocations((prev) => {
            const existing = prev.findIndex((fl) => fl.deviceId === friend.deviceId);
            const updated: FriendLocation = { ...loc, deviceId: friend.deviceId, nickname: friend.nickname };
            if (existing >= 0) {
              const newArr = [...prev];
              newArr[existing] = updated;
              return newArr;
            }
            return [...prev, updated];
          });
        });
        unsubscribers.current.push(unsub);
      });
  }, [friends]);

  async function fetchMyLocation() {
    const coords = await getCurrentLocation();
    if (coords) setMyLocation(coords);
  }

  async function stopHelping() {
    if (!activeHelpingSessionId || !deviceId) return;
    Alert.alert(
      'Help Band Karo?',
      'Kya tumne madad kar di ya ja nahi sakte?',
      [
        { text: 'Continue helping', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            await removeHelperLocation(activeHelpingSessionId, deviceId);
            setHelpingState(null);
            setSosFriendLocation(null);
          },
        },
      ]
    );
  }

  async function handleSendFriendRequest() {
    if (!deviceId || !friendIdInput.trim()) return;
    if (friendIdInput.trim() === deviceId) {
      Alert.alert('Error', "Ye tumhara apna ID hai 😅");
      return;
    }
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
        {/* Meri location ring */}
        {myLocation && (
          <Circle
            center={myLocation}
            radius={100}
            fillColor="rgba(0,122,255,0.15)"
            strokeColor="rgba(0,122,255,0.5)"
            strokeWidth={2}
          />
        )}

        {/* ─── Helper Mode: SOS person ki location ─── */}
        {isHelpingMode && sosFriendLocation && (
          <>
            <Marker
              coordinate={{ latitude: sosFriendLocation.latitude, longitude: sosFriendLocation.longitude }}
              title={`🚨 ${activeHelpingNickname}`}
              description="Inhe madad chahiye!"
            >
              <View style={styles.sosFriendMarker}>
                <Text style={styles.markerEmoji}>🚨</Text>
              </View>
            </Marker>
            <Circle
              center={{ latitude: sosFriendLocation.latitude, longitude: sosFriendLocation.longitude }}
              radius={200}
              fillColor="rgba(255,59,48,0.15)"
              strokeColor="rgba(255,59,48,0.6)"
              strokeWidth={2}
            />
          </>
        )}

        {/* ─── SOS Person Mode: Helpers ki locations ─── */}
        {isSOSActive && helpers.map((h) => h.latitude && h.longitude ? (
          <Marker
            key={h.deviceId}
            coordinate={{ latitude: h.latitude!, longitude: h.longitude! }}
            title={`🏃 ${h.nickname}`}
            description="Aa raha hai tumhari madad karne!"
          >
            <View style={styles.helperMarker}>
              <Text style={styles.markerEmoji}>🏃</Text>
            </View>
          </Marker>
        ) : null)}

        {/* Normal: Friends ki emergency locations */}
        {!isHelpingMode && friendLocations.map((fl, idx) => (
          <Marker
            key={fl.deviceId ?? `fl_${idx}`}
            coordinate={{ latitude: fl.latitude, longitude: fl.longitude }}
            title={`🚨 ${fl.nickname}`}
            description="SOS Active!"
          >
            <View style={styles.sosFriendMarker}>
              <Text style={styles.markerEmoji}>🚨</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* ─── Top Bar ─── */}
      <View style={styles.topOverlay}>
        <View style={styles.topBar}>
          <Text style={styles.title}>
            {isHelpingMode ? `Helping ${activeHelpingNickname}` : 'Radar'}
          </Text>
          <View style={styles.topActions}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => mapRef.current?.animateToRegion(initialRegion, 1000)}
            >
              <Ionicons name="locate" size={20} color="#fff" />
            </TouchableOpacity>
            {!isHelpingMode && (
              <TouchableOpacity
                style={[styles.iconBtn, (pendingRequests ?? []).length > 0 && styles.iconBtnAlert]}
                onPress={() => setShowAddFriend(true)}
              >
                <Ionicons name="person-add" size={20} color="#fff" />
                {(pendingRequests ?? []).length > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{(pendingRequests ?? []).length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Device ID */}
        <View style={styles.deviceIdCard}>
          <Text style={styles.deviceIdLabel}>My Device ID:</Text>
          <Text style={styles.deviceIdValue} selectable>{deviceId ?? 'Loading...'}</Text>
        </View>
      </View>

      {/* ─── Helper Mode Banner ─── */}
      {isHelpingMode && (
        <View style={styles.helpingBanner}>
          <View style={styles.helpingBannerLeft}>
            <Text style={styles.helpingBannerTitle}>🏃 Help Mode Active</Text>
            <Text style={styles.helpingBannerSub}>
              {sosFriendLocation
                ? `${activeHelpingNickname} ki location live update ho rahi hai`
                : `${activeHelpingNickname} ki location dhundh raha hoon...`}
            </Text>
          </View>
          <TouchableOpacity style={styles.stopHelpBtn} onPress={stopHelping}>
            <Text style={styles.stopHelpBtnText}>Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── Bottom Sheet: Friends ─── */}
      {!isHelpingMode && (
        <View style={styles.bottomSheet}>
          <Text style={styles.bottomTitle}>Friends ({(friends ?? []).length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(friends ?? []).length === 0 ? (
              <Text style={styles.emptyText}>No friends yet — tap "+" to add</Text>
            ) : (
              (friends ?? []).map((f, idx) => (
                <View key={f.deviceId ?? `friend_${idx}`}
                  style={[styles.friendChip, f.isInEmergency && styles.friendChipEmergency]}>
                  <View style={[styles.friendDot, f.isInEmergency ? styles.dotEmergency : styles.dotSafe]} />
                  <Text style={styles.friendChipText}>{f.nickname}</Text>
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
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Friends</Text>

            {(pendingRequests ?? []).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Pending Requests ({(pendingRequests ?? []).length})</Text>
                {(pendingRequests ?? []).map((fromId) => (
                  <View key={fromId} style={styles.requestRow}>
                    <Text style={styles.requestId}>{fromId.slice(0, 12)}...</Text>
                    <TouchableOpacity style={[styles.requestBtn, styles.acceptBtn]} onPress={() => handleAcceptRequest(fromId)}>
                      <Text style={styles.requestBtnText}>✓ Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.requestBtn, styles.rejectBtn]} onPress={() => handleRejectRequest(fromId)}>
                      <Text style={styles.requestBtnText}>✗</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Add Friend by Device ID</Text>
              <TextInput
                style={styles.input}
                placeholder="Paste friend's Device ID..."
                placeholderTextColor="#666"
                value={friendIdInput}
                onChangeText={setFriendIdInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <TouchableOpacity
                style={[styles.sendBtn, isLoading && styles.sendBtnDisabled]}
                onPress={handleSendFriendRequest}
                disabled={isLoading}
              >
                <Text style={styles.sendBtnText}>{isLoading ? 'Sending...' : 'Send Request'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowAddFriend(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, padding: 16, paddingTop: 50 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 10 },
  topActions: { flexDirection: 'row', gap: 10 },
  iconBtn: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 22,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  iconBtnAlert: { borderColor: '#FF3B30' },
  badge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#FF3B30', borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  deviceIdCard: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  deviceIdLabel: { color: '#888', fontSize: 11, marginBottom: 4 },
  deviceIdValue: { color: '#fff', fontSize: 12, fontFamily: 'monospace' },

  sosFriendMarker: {
    backgroundColor: '#FF3B30', borderRadius: 20, padding: 8,
    borderWidth: 2, borderColor: '#fff',
  },
  helperMarker: {
    backgroundColor: '#30D158', borderRadius: 20, padding: 8,
    borderWidth: 2, borderColor: '#fff',
  },
  markerEmoji: { fontSize: 18 },

  // Helper mode banner
  helpingBanner: {
    position: 'absolute',
    bottom: 100,
    left: 16, right: 16,
    backgroundColor: 'rgba(20,60,20,0.95)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#30D158',
    flexDirection: 'row',
    alignItems: 'center',
  },
  helpingBannerLeft: { flex: 1 },
  helpingBannerTitle: { color: '#30D158', fontWeight: '800', fontSize: 15 },
  helpingBannerSub: { color: '#ccc', fontSize: 12, marginTop: 2 },
  stopHelpBtn: {
    backgroundColor: '#FF3B30',
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  stopHelpBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  bottomSheet: {
    position: 'absolute', bottom: 90, left: 16, right: 16,
    backgroundColor: 'rgba(10,10,10,0.9)',
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  bottomTitle: { color: '#fff', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  emptyText: { color: '#555', fontSize: 13 },
  friendChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8,
    marginRight: 8, gap: 6,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  friendChipEmergency: { borderColor: '#FF3B30', backgroundColor: '#1a0505' },
  friendDot: { width: 8, height: 8, borderRadius: 4 },
  dotSafe: { backgroundColor: '#30D158' },
  dotEmergency: { backgroundColor: '#FF3B30' },
  friendChipText: { color: '#ccc', fontSize: 13, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase' },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  requestId: { flex: 1, color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  requestBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  acceptBtn: { backgroundColor: '#1a3a1a' },
  rejectBtn: { backgroundColor: '#3a1a1a' },
  requestBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  input: {
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a',
    marginBottom: 12, fontFamily: 'monospace',
  },
  sendBtn: { backgroundColor: '#FF3B30', borderRadius: 10, padding: 14, alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  closeBtn: { marginTop: 10, alignItems: 'center', padding: 14 },
  closeBtnText: { color: '#888', fontSize: 15 },
});