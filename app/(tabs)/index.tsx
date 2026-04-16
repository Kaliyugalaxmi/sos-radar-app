// app/(tabs)/index.tsx
// Main SOS Screen
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
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createEmergencySession,
  HelperInfo,
  resolveEmergencySession,
  subscribeHelperLocations,
  updateLiveLocation,
} from '../../services/emergency';
import { Coordinates, getAddressFromCoords, getCurrentLocation, watchLocation } from '../../services/location';
import { sendEmergencySMS } from '../../services/sms';
import { useAppStore } from '../../store/useAppStore';

export default function SOSScreen() {
  const { deviceId, contacts, isSOSActive, activeSessionId, setSOSActive } = useAppStore();

  const [countdown, setCountdown] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [address, setAddress] = useState('Fetching location...');
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  // Helpers jo aa rahe hain
  const [helpers, setHelpers] = useState<HelperInfo[]>([]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopWatchingLocation = useRef<(() => void) | null>(null);
  const stopWatchingHelpers = useRef<(() => void) | null>(null);

  // Pulse animation jab SOS active ho
  useEffect(() => {
    if (isSOSActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isSOSActive]);

  // Helper locations subscribe karo jab SOS active ho
  useEffect(() => {
    if (isSOSActive && activeSessionId) {
      stopWatchingHelpers.current = subscribeHelperLocations(activeSessionId, (h) => {
        setHelpers(h);
      });
    } else {
      stopWatchingHelpers.current?.();
      stopWatchingHelpers.current = null;
      setHelpers([]);
    }
    return () => {
      stopWatchingHelpers.current?.();
    };
  }, [isSOSActive, activeSessionId]);

  // Location fetch on mount
  useEffect(() => {
    fetchLocation();
    return () => {
      stopWatchingLocation.current?.();
    };
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
      Alert.alert(
        'Cancel SOS?',
        'Do you want to stop the SOS alert?',
        [
          { text: 'No, keep it active', style: 'cancel' },
          { text: 'Yes, stop', style: 'destructive', onPress: cancelSOS },
        ]
      );
      return;
    }

    if (contacts.length === 0) {
      Alert.alert(
        'No Contacts',
        'Please add emergency contacts first.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Contacts', onPress: () => router.push('/(tabs)/sos') },
        ]
      );
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
    // ✅ FIX: Pehle check karo, agar location ya deviceId nahi hai toh error dikhao
    if (!deviceId || !currentLocation) {
      Alert.alert('Error', 'Location ya Device ID nahi mili. Dobara try karo.');
      return;
    }

    try {
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);

      const sessionId = await createEmergencySession(deviceId, currentLocation, address);
      setSOSActive(true, sessionId);

      await sendEmergencySMS(contacts, currentLocation, deviceId);

      // Live location tracking shuru karo
      stopWatchingLocation.current = watchLocation(
        async (coords) => {
          setCurrentLocation(coords);
          const newAddr = await getAddressFromCoords(coords);
          setAddress(newAddr);
          await updateLiveLocation(sessionId, coords);
        }
      );

      // ✅ FIX: Sirf ek hi alert — success wala
      Alert.alert(
        '🚨 SOS Activated!',
        `${contacts.length} contacts ko message bheja gaya. Location share ho rahi hai.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('SOS activation error:', error);
      Alert.alert('Error', 'SOS activate karne mein dikkat aayi. Dobara try karo.');
    }
  }

  async function cancelSOS() {
    try {
      stopWatchingLocation.current?.();
      stopWatchingLocation.current = null;

      if (activeSessionId) {
        await resolveEmergencySession(activeSessionId);
      }

      setSOSActive(false);
      setHelpers([]);
      Vibration.cancel();

      // ✅ FIX: Sirf ek hi alert
      Alert.alert('✅ SOS Band Ho Gaya', 'Emergency alert cancel ho gaya. Sab theek ho?');
    } catch (error) {
      console.error('Cancel SOS error:', error);
      setSOSActive(false);
    }
  }

  const isCountingDown = countdown !== null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>SOS Safety</Text>
          <View style={[styles.statusBadge, isSOSActive ? styles.statusActive : styles.statusIdle]}>
            <View style={[styles.statusDot, isSOSActive ? styles.dotActive : styles.dotIdle]} />
            <Text style={[styles.statusText, isSOSActive && styles.statusTextActive]}>
              {isSOSActive ? 'ALERT ACTIVE' : 'Safe'}
            </Text>
          </View>
        </View>

        {/* Location Card */}
        <View style={styles.locationCard}>
          <Ionicons name="location" size={18} color="#FF3B30" />
          <Text style={styles.locationText} numberOfLines={2}>
            {isFetchingLocation ? 'Searching for location...' : address}
          </Text>
          <TouchableOpacity onPress={fetchLocation} style={styles.refreshBtn}>
            <Ionicons name="refresh" size={16} color="#888" />
          </TouchableOpacity>
        </View>

        {/* SOS Button Area */}
        <View style={styles.sosArea}>
          {isSOSActive && (
            <Animated.View style={[styles.sosPulseRing, { transform: [{ scale: pulseAnim }] }]} />
          )}
          {isSOSActive && (
            <Animated.View style={[styles.sosPulseRing2, { transform: [{ scale: pulseAnim }], opacity: 0.4 }]} />
          )}

          <TouchableOpacity
            onPress={isCountingDown ? cancelCountdown : handleSOSPress}
            activeOpacity={0.85}
            style={[
              styles.sosButton,
              isSOSActive && styles.sosButtonActive,
              isCountingDown && styles.sosButtonCounting,
            ]}
          >
            {isCountingDown ? (
              <View style={styles.countdownInner}>
                <Text style={styles.countdownNumber}>{countdown}</Text>
                <Text style={styles.countdownLabel}>Cancel</Text>
              </View>
            ) : (
              <View style={styles.sosInner}>
                <Ionicons
                  name={isSOSActive ? 'stop-circle' : 'alert-circle'}
                  size={48}
                  color="#fff"
                />
                <Text style={styles.sosText}>{isSOSActive ? 'STOP' : 'SOS'}</Text>
                {!isSOSActive && <Text style={styles.sosSubText}>Press to activate</Text>}
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Info text */}
        {!isSOSActive && !isCountingDown && (
          <Text style={styles.infoText}>
            Press the button → 3 second countdown → SMS + location will be sent to {contacts.length} contacts
          </Text>
        )}

        {/* SOS Active Info */}
        {isSOSActive && (
          <View style={styles.activeInfo}>
            <Text style={styles.activeInfoTitle}>🚨 Alert Active Hai</Text>
            <Text style={styles.activeInfoText}>• Location har 5 seconds update ho rahi hai</Text>
            <Text style={styles.activeInfoText}>• {contacts.length} contacts ko SMS gaya</Text>
            <Text style={styles.activeInfoText}>• Dost radar par dikh rahe hain</Text>

            {/* ─── Helpers Section ─── */}
            {helpers.length > 0 ? (
              <View style={styles.helpersSection}>
                <Text style={styles.helpersSectionTitle}>
                  🏃 {helpers.length} dost aa rahe hain!
                </Text>
                {helpers.map((h) => (
                  <View key={h.deviceId} style={styles.helperRow}>
                    <View style={styles.helperDot} />
                    <Text style={styles.helperName}>{h.nickname}</Text>
                    <Text style={styles.helperStatus}>Aa raha hai →</Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.viewOnMapBtn}
                  onPress={() => router.push('/(tabs)/radar')}
                >
                  <Ionicons name="map" size={16} color="#fff" />
                  <Text style={styles.viewOnMapText}>Map par dekho</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.activeInfoText}>• Koi dost abhi tak accept nahi kiya</Text>
            )}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/sos')}
          >
            <Ionicons name="people" size={22} color="#FF3B30" />
            <Text style={styles.actionLabel}>Contacts</Text>
            <Text style={styles.actionCount}>{contacts.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/radar')}
          >
            <Ionicons name="radio" size={22} color="#FF9500" />
            <Text style={styles.actionLabel}>Radar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => Linking_call112()}
          >
            <Ionicons name="call" size={22} color="#30D158" />
            <Text style={styles.actionLabel}>112 Call</Text>
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { padding: 20, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitle: { color: '#fff', fontSize: 28, fontWeight: '800' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
    backgroundColor: '#1a1a1a',
  },
  statusActive: { backgroundColor: '#3a0a0a', borderWidth: 1, borderColor: '#FF3B30' },
  statusIdle: {},
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: '#FF3B30' },
  dotIdle: { backgroundColor: '#30D158' },
  statusText: { color: '#888', fontSize: 12, fontWeight: '700' },
  statusTextActive: { color: '#FF3B30' },

  locationCard: {
    backgroundColor: '#161616',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  locationText: { flex: 1, color: '#ccc', fontSize: 13 },
  refreshBtn: { padding: 4 },

  sosArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 260,
    marginBottom: 20,
  },
  sosPulseRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: '#FF3B30',
  },
  sosPulseRing2: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 20,
  },
  sosButtonActive: { backgroundColor: '#CC1010' },
  sosButtonCounting: { backgroundColor: '#FF9500', shadowColor: '#FF9500' },
  sosInner: { alignItems: 'center', gap: 4 },
  sosText: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 4 },
  sosSubText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  countdownInner: { alignItems: 'center' },
  countdownNumber: { color: '#fff', fontSize: 64, fontWeight: '900' },
  countdownLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },

  infoText: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
    paddingHorizontal: 20,
  },

  activeInfo: {
    backgroundColor: '#1a0505',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FF3B30',
    marginBottom: 30,
    gap: 8,
  },
  activeInfoTitle: { color: '#FF3B30', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  activeInfoText: { color: '#ccc', fontSize: 13, lineHeight: 20 },

  // Helpers
  helpersSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#3a0808',
    paddingTop: 12,
    gap: 8,
  },
  helpersSectionTitle: { color: '#FF9500', fontWeight: '700', fontSize: 14 },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  helperDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#30D158',
  },
  helperName: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  helperStatus: { color: '#30D158', fontSize: 12 },
  viewOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    padding: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  viewOnMapText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  quickActions: { flexDirection: 'row', gap: 12 },
  actionCard: {
    flex: 1,
    backgroundColor: '#161616',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  actionLabel: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  actionCount: { color: '#FF3B30', fontSize: 18, fontWeight: '800' },
});