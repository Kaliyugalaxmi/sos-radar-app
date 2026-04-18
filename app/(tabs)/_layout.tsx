// app/(tabs)/_layout.tsx
// Responsive Tab Bar — fixed height, no clipping, clean SOS icon
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../../store/useAppStore';

export default function TabsLayout() {
  const { isSOSActive } = useAppStore();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Scale clamped to 0.8–1.15 so icons never blow up on tablets
  const scale = Math.min(Math.max(width / 375, 0.8), 1.15);
  const iconSz = Math.round(22 * scale);
  const labelSz = Math.round(10 * scale);

  // Exact tab bar height: 56px usable + bottom safe area
  const BAR_H = 56 + Math.max(insets.bottom, 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0A0A0A',
          borderTopWidth: 1,
          borderTopColor: '#1C1C1C',
          height: BAR_H,
          paddingBottom: Math.max(insets.bottom, 2),
          paddingTop: 6,
          paddingHorizontal: 4,
          // Prevent Android from adding extra space
          elevation: 0,
        },
        tabBarActiveTintColor: '#FF3B30',
        tabBarInactiveTintColor: '#3D3D3D',
        tabBarLabelStyle: {
          fontSize: labelSz,
          fontWeight: '600',
          letterSpacing: 0.3,
          marginTop: 2,
        },
        // Remove the default gap between icon and label
        tabBarIconStyle: { marginBottom: -2 },
        tabBarItemStyle: {
          paddingVertical: 0,
          flex: 1,
        },
      }}
    >
      {/* ─── SOS Tab ─── */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'SOS',
          tabBarLabel: ({ color }) => (
            <Text style={[styles.label, { fontSize: labelSz, color }]}>SOS</Text>
          ),
          tabBarIcon: ({ focused }) => (
            <View style={styles.sosWrapper}>
              <View
                style={[
                  styles.sosChip,
                  focused && !isSOSActive && styles.sosChipFocused,
                  isSOSActive && styles.sosChipActive,
                ]}
              >
                <Ionicons
                  name={isSOSActive ? 'alert-circle' : 'alert-circle-outline'}
                  size={iconSz + 2}
                  color={isSOSActive || focused ? '#fff' : '#3D3D3D'}
                />
              </View>
              {isSOSActive && <View style={styles.activeDot} />}
            </View>
          ),
        }}
      />

      {/* ─── Radar Tab ─── */}
      <Tabs.Screen
        name="radar"
        options={{
          title: 'Radar',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'radio' : 'radio-outline'}
              size={iconSz}
              color={color}
            />
          ),
        }}
      />

      {/* ─── Contacts Tab ─── */}
      <Tabs.Screen
        name="sos"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={iconSz}
              color={color}
            />
          ),
        }}
      />

      {/* ─── Hidden screens ─── */}
      <Tabs.Screen name="sos-map" options={{ href: null }} />
      <Tabs.Screen name="SOSMapScreen" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  // SOS icon container — big enough so the chip never clips
  sosWrapper: {
    width: 48,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: Platform.OS === 'ios' ? 'visible' : 'hidden',
  },
  sosChipFocused: {
    backgroundColor: 'rgba(255,59,48,0.15)',
  },
  sosChipActive: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 5,
  },
  activeDot: {
    position: 'absolute',
    top: 0,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF3B30',
    borderWidth: 1.5,
    borderColor: '#0A0A0A',
  },
});
