// app/sos-map.tsx
// Full-screen SOS map — opened by victim to see helper, or helper to see victim
// Route params: sessionId, role ('victim' | 'helper'), victimLat, victimLon (optional pre-seed)

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SOSMapScreen from '../../app/(tabs)/SOSMapScreen';
import { useAppStore } from '../../store/useAppStore';

export default function SOSMapRoute() {
  const router = useRouter();
  const { sessionId, role, victimLat, victimLon } = useLocalSearchParams<{
    sessionId: string;
    role: string; // 'victim' | 'helper'
    victimLat?: string;
    victimLon?: string;
  }>();

  const { deviceId, nickname } = useAppStore();

  // Pre-seed victim location so map doesn't start blank
  const initialVictimLocation =
    victimLat && victimLon
      ? { latitude: parseFloat(victimLat), longitude: parseFloat(victimLon) }
      : undefined;

  const isVictim = role === 'victim';

  if (!sessionId || !deviceId) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>Session not found.</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="light" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isVictim ? '🚨 Helper Location' : '🏃 Help'}
          </Text>
          <Text style={styles.headerSub}>
            {isVictim
              ? 'See where your friend is'
              : 'Reach the victim'}
          </Text>
        </View>

        {/* Live indicator */}
        <View style={styles.liveTag}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub: { color: '#555', fontSize: 12, marginTop: 1 },

  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a0505',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF3B30',
  },
  liveText: { color: '#FF3B30', fontSize: 10, fontWeight: '800' },

  // Error state
  errorContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  errorText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backLink: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
  },
  backLinkText: { color: '#FF3B30', fontWeight: '700', fontSize: 15 },
});