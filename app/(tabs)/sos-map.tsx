// app/(tabs)/sos-map.tsx
// Full-screen SOS map route — opened by victim or helper
// Route params: sessionId, role, victimLat?, victimLon?

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SOSMapScreen from '../../app/(tabs)/SOSMapScreen';
import { useAppStore } from '../../store/useAppStore';

function useScale() {
  const { width } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.85), 1.2);
  const s = (size: number) => Math.round(size * scale);
  return { s };
}

export default function SOSMapRoute() {
  const router = useRouter();
  const { sessionId, role, victimLat, victimLon } = useLocalSearchParams<{
    sessionId: string;
    role: string;
    victimLat?: string;
    victimLon?: string;
  }>();
  const { deviceId, nickname } = useAppStore();
  const { s } = useScale();

  const initialVictimLocation =
    victimLat && victimLon
      ? { latitude: parseFloat(victimLat), longitude: parseFloat(victimLon) }
      : undefined;

  const isVictim = role === 'victim';

  if (!sessionId || !deviceId) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={s(48)} color="#FF3B30" />
        <Text style={[styles.errorText, { fontSize: s(16) }]}>Session not found.</Text>
        <TouchableOpacity
          style={[styles.backLink, { paddingHorizontal: s(24), paddingVertical: s(12), borderRadius: s(12) }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.backLinkText, { fontSize: s(15) }]}>← Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingHorizontal: s(16), paddingVertical: s(12) }]}>
        <TouchableOpacity
          style={[styles.backBtn, { width: s(36), height: s(36), borderRadius: s(18) }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={s(19)} color="#fff" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { fontSize: s(16) }]}>
            {isVictim ? 'Navigate to Help' : '🏃 Help Mode'}
          </Text>
          <Text style={[styles.headerSub, { fontSize: s(12) }]}>
            Live location tracking
          </Text>
        </View>

        <View style={[styles.liveTag, { borderRadius: s(12), paddingHorizontal: s(8), paddingVertical: s(4) }]}>
          <View style={styles.liveDot} />
          <Text style={[styles.liveText, { fontSize: s(10) }]}>LIVE</Text>
        </View>
      </View>

      {/* ── Map ── */}
      <SOSMapScreen
        sessionId={sessionId}
        role={isVictim ? 'victim' : 'helper'}
        myDeviceId={deviceId}
        myNickname={nickname}
        initialVictimLocation={initialVictimLocation}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#080808',
    borderBottomWidth: 1,
    borderBottomColor: '#181818',
    gap: 12,
  },
  backBtn: {
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: '#fff', fontWeight: '700' },
  headerSub: { color: '#555', marginTop: 2 },

  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a0505',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#FF3B30',
  },
  liveText: { color: '#FF3B30', fontWeight: '800' },

  errorContainer: {
    flex: 1,
    backgroundColor: '#080808',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  errorText: { color: '#fff', fontWeight: '600' },
  backLink: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  backLinkText: { color: '#FF3B30', fontWeight: '700' },
});
