// app/(tabs)/index.tsx
// Main SOS Screen — Fully Responsive + Enhanced UI
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createEmergencySession,
  HelperInfo,
  resolveEmergencySession,
  subscribeHelperLocations,
  updateLiveLocation,
} from '../../services/emergency';
import {
  Coordinates,
  getAddressFromCoords,
  getCurrentLocation,
  watchLocation,
} from '../../services/location';
import { sendEmergencySMS } from '../../services/sms';
import { useAppStore } from '../../store/useAppStore';

// ─── Responsive Scale Helper ───────────────────────────────────────────────
function useScale() {
  const { width, height } = useWindowDimensions();
  const BASE = 375;
  const scale = Math.min(Math.max(width / BASE, 0.78), 1.3);
  const vs = Math.min(Math.max(height / 812, 0.75), 1.3);
  const s = (size: number) => Math.round(size * scale);
  const vs2 = (size: number) => Math.round(size * vs);
  return { width, height, scale, s, vs: vs2 };
}

export default function SOSScreen() {
  const { deviceId, contacts, isSOSActive, activeSessionId, setSOSActive } = useAppStore();
  const { width, height, s, vs } = useScale();

  const [countdown, setCountdown] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [address, setAddress] = useState('Fetching location...');
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [helpers, setHelpers] = useState<HelperInfo[]>([]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopWatchingLocation = useRef<(() => void) | null>(null);
  const stopWatchingHelpers = useRef<(() => void) | null>(null);

  // SOS button: 42% of screen width, bounded — smaller on very small screens
  const SOS_BTN = Math.min(Math.max(width * 0.42, 148), 210);
  const RING1 = SOS_BTN + 40;
  const RING2 = SOS_BTN + 78;
  // SOS area height: use vertical scale to prevent overflow on short screens
  const SOS_AREA_H = Math.min(RING2 + 32, height * 0.38);

  useEffect(() => {
    if (isSOSActive) {
      const loop1 = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      );
      const loop2 = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim2, { toValue: 1.15, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulseAnim2, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ])
      );
      loop1.start();
      loop2.start();
    } else {
      pulseAnim.setValue(1);
      pulseAnim2.setValue(1);
    }
  }, [isSOSActive]);

  useEffect(() => {
    if (isSOSActive && activeSessionId) {
      stopWatchingHelpers.current = subscribeHelperLocations(activeSessionId, setHelpers);
    } else {
      stopWatchingHelpers.current?.();
      stopWatchingHelpers.current = null;
      setHelpers([]);
    }
    return () => { stopWatchingHelpers.current?.(); };
  }, [isSOSActive, activeSessionId]);

  useEffect(() => {
    fetchLocation();
    return () => { stopWatchingLocation.current?.(); };
  }, []);

  async function fetchLocation() {
    setIsFetchingLocation(true);
    const coords = await getCurrentLocation();
    if (coords) {
      setCurrentLocation(coords);
      const addr = await getAddressFromCoords(coords);
      setAddress(addr);
    } else {
      setAddress('Location access not granted');
    }
    setIsFetchingLocation(false);
  }

  function handleSOSPress() {
    if (isSOSActive) {
      Alert.alert('Cancel SOS?', 'Do you want to stop the SOS alert?', [
        { text: 'No, keep it active', style: 'cancel' },
        { text: 'Yes, stop', style: 'destructive', onPress: cancelSOS },
      ]);
      return;
    }
    if (contacts.length === 0) {
      Alert.alert('No Contacts', 'Please add emergency contacts first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add Contacts', onPress: () => router.push('/(tabs)/sos') },
      ]);
      return;
    }
    startCountdown();
  }

  function startCountdown() {
    setCountdown(3);
    Vibration.vibrate([0, 200, 100, 200]);
    let count = 3;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);
      Vibration.vibrate(100);
      if (count <= 0) {
        clearInterval(countdownRef.current!);
        setCountdown(null);
        activateSOS();
      }
    }, 1000);
  }

  function cancelCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      setCountdown(null);
    }
  }

  async function activateSOS() {
    if (!deviceId || !currentLocation) {
      Alert.alert('Error', 'Location or device ID not found. Please try again.');
      return;
    }
    try {
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);
      const sessionId = await createEmergencySession(deviceId, currentLocation, address);
      setSOSActive(true, sessionId);
      await sendEmergencySMS(contacts, currentLocation, deviceId);
      stopWatchingLocation.current = watchLocation(async (coords) => {
        setCurrentLocation(coords);
        const newAddr = await getAddressFromCoords(coords);
        setAddress(newAddr);
        await updateLiveLocation(sessionId, coords);
      });
      Alert.alert('🚨 SOS Activated!', `Notified ${contacts.length} contacts. Sharing location.`, [{ text: 'OK' }]);
    } catch (error) {
      Alert.alert('Error', 'Failed to activate SOS. Please try again.');
    }
  }

  async function cancelSOS() {
    try {
      stopWatchingLocation.current?.();
      stopWatchingLocation.current = null;
      if (activeSessionId) await resolveEmergencySession(activeSessionId);
      setSOSActive(false);
      setHelpers([]);
      Vibration.cancel();
      Alert.alert('✅ SOS Cancelled', 'Emergency alert cancelled. Are you okay?');
    } catch {
      setSOSActive(false);
    }
  }

  const isCountingDown = countdown !== null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: s(20), paddingTop: s(16), paddingBottom: s(32) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─── */}
        <View style={[styles.header, { marginBottom: s(14) }]}>
          <View>
            <Text style={[styles.headerTitle, { fontSize: s(26) }]}>SOS Safety</Text>
            <Text style={[styles.headerSub, { fontSize: s(12) }]}>Emergency Response</Text>
          </View>
          <View style={[styles.statusBadge, isSOSActive ? styles.statusActive : styles.statusIdle]}>
            <View style={[styles.statusDot, isSOSActive ? styles.dotActive : styles.dotIdle]} />
            <Text style={[styles.statusText, { fontSize: s(11) }, isSOSActive && styles.statusTextActive]}>
              {isSOSActive ? 'ALERT ACTIVE' : 'Safe'}
            </Text>
          </View>
        </View>

        {/* ─── Location Card ─── */}
        <TouchableOpacity
          style={[styles.locationCard, { padding: s(13), marginBottom: s(24) }]}
          onPress={fetchLocation}
          activeOpacity={0.8}
        >
          <View style={styles.locationIconWrap}>
            <Ionicons name="location" size={s(16)} color="#FF3B30" />
          </View>
          <Text style={[styles.locationText, { fontSize: s(13) }]} numberOfLines={2}>
            {isFetchingLocation ? 'Searching location...' : address}
          </Text>
          <View style={{ padding: s(6) }}>
            <Ionicons name="refresh" size={s(15)} color={isFetchingLocation ? '#FF9500' : '#555'} />
          </View>
        </TouchableOpacity>

        {/* ─── SOS Button Area ─── */}
        <View style={[styles.sosArea, { height: SOS_AREA_H, marginBottom: s(16) }]}>
          {isSOSActive && (
            <Animated.View style={[
              styles.sosPulseRing,
              {
                width: RING2, height: RING2, borderRadius: RING2 / 2,
                transform: [{ scale: pulseAnim2 }], opacity: 0.35,
              },
            ]} />
          )}
          {isSOSActive && (
            <Animated.View style={[
              styles.sosPulseRing,
              {
                width: RING1, height: RING1, borderRadius: RING1 / 2,
                transform: [{ scale: pulseAnim }], borderWidth: 2.5,
              },
            ]} />
          )}

          <TouchableOpacity
            onPress={isCountingDown ? cancelCountdown : handleSOSPress}
            activeOpacity={0.85}
            style={[
              styles.sosButton,
              { width: SOS_BTN, height: SOS_BTN, borderRadius: SOS_BTN / 2 },
              isSOSActive && styles.sosButtonActive,
              isCountingDown && styles.sosButtonCounting,
            ]}
          >
            {isCountingDown ? (
              <View style={styles.countdownInner}>
                <Text style={[styles.countdownNumber, { fontSize: s(56) }]}>{countdown}</Text>
                <Text style={[styles.countdownLabel, { fontSize: s(12) }]}>Tap to Cancel</Text>
              </View>
            ) : (
              <View style={styles.sosInner}>
                <Ionicons
                  name={isSOSActive ? 'stop-circle' : 'alert-circle'}
                  size={s(44)}
                  color="#fff"
                />
                <Text style={[styles.sosText, { fontSize: s(19), letterSpacing: s(4) }]}>
                  {isSOSActive ? 'STOP' : 'SOS'}
                </Text>
                {!isSOSActive && (
                  <Text style={[styles.sosSubText, { fontSize: s(11) }]}>Hold to activate</Text>
                )}
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ─── Info Text ─── */}
        {!isSOSActive && !isCountingDown && (
          <Text style={[styles.infoText, { fontSize: s(13), marginBottom: s(22) }]}>
            Press → 3 second countdown → SMS + live location sent to {contacts.length} contacts
          </Text>
        )}

        {/* ─── Active Info ─── */}
        {isSOSActive && (
          <View style={[styles.activeInfo, { padding: s(14), marginBottom: s(22) }]}>
            <View style={styles.activeInfoHeader}>
              <View style={styles.activePulse} />
              <Text style={[styles.activeInfoTitle, { fontSize: s(14) }]}>🚨 Alert Active</Text>
            </View>
            <View style={styles.activeInfoDivider} />
            <Text style={[styles.activeInfoText, { fontSize: s(12) }]}>• Location updates every 5 seconds</Text>
            <Text style={[styles.activeInfoText, { fontSize: s(12) }]}>• SMS sent to {contacts.length} contacts</Text>
            <Text style={[styles.activeInfoText, { fontSize: s(12) }]}>• Friends visible on the radar</Text>

            {helpers.length > 0 ? (
              <View style={styles.helpersSection}>
                <Text style={[styles.helpersSectionTitle, { fontSize: s(12) }]}>
                  🏃 {helpers.length} {helpers.length === 1 ? 'friend is' : 'friends are'} coming!
                </Text>
                {helpers.map((h) => (
                  <View key={h.deviceId} style={styles.helperRow}>
                    <View style={styles.helperDot} />
                    <Text style={[styles.helperName, { fontSize: s(12) }]}>{h.nickname}</Text>
                    <Text style={[styles.helperStatus, { fontSize: s(11) }]}>On the way →</Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={[styles.viewOnMapBtn, { padding: s(9) }]}
                  onPress={() =>
                    router.push({
                      pathname: '/sos-map',
                      params: {
                        sessionId: activeSessionId!,
                        role: 'victim',
                        victimLat: currentLocation?.latitude?.toString() ?? '',
                        victimLon: currentLocation?.longitude?.toString() ?? '',
                      },
                    })
                  }
                >
                  <Ionicons name="map" size={s(14)} color="#fff" />
                  <Text style={[styles.viewOnMapText, { fontSize: s(12) }]}>View on map</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[styles.activeInfoText, { fontSize: s(12) }]}>• No friend has accepted yet</Text>
            )}
          </View>
        )}

        {/* ─── Quick Actions ─── */}
        {/* Use minWidth:0 + flexShrink so cards never overflow on small screens */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.actionCard, { padding: s(14) }]}
            onPress={() => router.push('/(tabs)/sos')}
          >
            <View style={[styles.actionIconWrap, { borderRadius: s(10), padding: s(7) }]}>
              <Ionicons name="people" size={s(19)} color="#FF3B30" />
            </View>
            <Text style={[styles.actionLabel, { fontSize: s(10) }]}>Contacts</Text>
            <Text style={[styles.actionCount, { fontSize: s(16) }]}>{contacts.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { padding: s(14) }]}
            onPress={() => router.push('/(tabs)/radar')}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(255,149,0,0.15)', borderRadius: s(10), padding: s(7) }]}>
              <Ionicons name="radio" size={s(19)} color="#FF9500" />
            </View>
            <Text style={[styles.actionLabel, { fontSize: s(10) }]}>Radar</Text>
            <Text style={[styles.actionCount, { fontSize: s(16), color: '#FF9500' }]}>📡</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { padding: s(14) }]}
            onPress={() => Linking_call112()}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(48,209,88,0.15)', borderRadius: s(10), padding: s(7) }]}>
              <Ionicons name="call" size={s(19)} color="#30D158" />
            </View>
            <Text style={[styles.actionLabel, { fontSize: s(10) }]}>112 Call</Text>
            <Text style={[styles.actionCount, { fontSize: s(16), color: '#30D158' }]}>📞</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Linking_call112() {
  const { Linking } = require('react-native');
  Linking.openURL('tel:112');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  scroll: { flexGrow: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontWeight: '800' },
  headerSub: { color: '#555', marginTop: 2, fontWeight: '500' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    // Prevent badge from getting too wide and breaking layout
    flexShrink: 1,
    maxWidth: 140,
  },
  statusActive: { backgroundColor: '#2a0808', borderColor: '#FF3B30' },
  statusIdle: {},
  statusDot: { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  dotActive: { backgroundColor: '#FF3B30' },
  dotIdle: { backgroundColor: '#30D158' },
  statusText: { color: '#666', fontWeight: '700' },
  statusTextActive: { color: '#FF3B30' },

  locationCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#222',
  },
  locationIconWrap: {
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderRadius: 8,
    padding: 6,
    flexShrink: 0,
  },
  locationText: { flex: 1, color: '#bbb', lineHeight: 18 },

  sosArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosPulseRing: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#FF3B30',
  },
  sosButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 18,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  sosButtonActive: {
    backgroundColor: '#CC0F0F',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  sosButtonCounting: {
    backgroundColor: '#FF9500',
    shadowColor: '#FF9500',
    borderColor: 'rgba(255,255,255,0.2)',
  },
  sosInner: { alignItems: 'center', gap: 4 },
  sosText: { color: '#fff', fontWeight: '900' },
  sosSubText: { color: 'rgba(255,255,255,0.65)' },
  countdownInner: { alignItems: 'center' },
  countdownNumber: { color: '#fff', fontWeight: '900' },
  countdownLabel: { color: 'rgba(255,255,255,0.75)' },

  infoText: {
    color: '#444',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },

  activeInfo: {
    backgroundColor: '#110404',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FF3B30',
    gap: 6,
  },
  activeInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  activePulse: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  activeInfoTitle: { color: '#FF3B30', fontWeight: '700' },
  activeInfoDivider: { height: 1, backgroundColor: '#2a0808', marginVertical: 4 },
  activeInfoText: { color: '#ccc', lineHeight: 19 },
  helpersSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a0808',
    paddingTop: 10,
    gap: 6,
  },
  helpersSectionTitle: { color: '#FF9500', fontWeight: '700' },
  helperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helperDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#30D158', flexShrink: 0 },
  helperName: { color: '#fff', fontWeight: '600', flex: 1 },
  helperStatus: { color: '#30D158' },
  viewOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  viewOnMapText: { color: '#fff', fontWeight: '700' },

  // Quick Actions — each card flex:1 with minWidth:0 prevents overflow
  quickActions: { flexDirection: 'row', gap: 8 },
  actionCard: {
    flex: 1,
    minWidth: 0,          // KEY: allows flex to shrink below natural width
    backgroundColor: '#111',
    borderRadius: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  actionIconWrap: {
    backgroundColor: 'rgba(255,59,48,0.15)',
  },
  actionLabel: { color: '#666', fontWeight: '600' },
  actionCount: { color: '#FF3B30', fontWeight: '800' },
});
