// app/(tabs)/_layout.tsx
// Tab Bar Layout — Responsive, no clipping, proper SOS icon
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../../store/useAppStore';

export default function TabsLayout() {
  const { isSOSActive } = useAppStore();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const scale = Math.min(Math.max(width / 375, 0.82), 1.2);
  const iconSize = Math.round(24 * scale);
  const sosIconSize = Math.round(25 * scale);

  // Tab bar total height: safe bottom inset + visible bar height
  // Use a fixed visible height of 52px so labels+icons always fit
  const visibleBarHeight = 52;
  const tabBarHeight = visibleBarHeight + Math.max(insets.bottom, 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#080808',
          borderTopColor: '#181818',
          borderTopWidth: 1,
          // Fixed height avoids squishing on non-standard phones
          height: tabBarHeight,
          // Padding so content centers in the visible area
          paddingBottom: Math.max(insets.bottom, 0) + 4,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#FF3B30',
        tabBarInactiveTintColor: '#444',
        tabBarLabelStyle: {
          fontSize: Math.round(10 * scale),
          fontWeight: '600',
          letterSpacing: 0.2,
          // Remove any default margin that may shift things
          marginTop: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'SOS',
          tabBarIcon: ({ color, focused }) => (
            // Outer wrapper: fixed size so the red pill never clips
            <View style={styles.sosTabOuter}>
              <View style={[
                styles.sosTab,
                isSOSActive && styles.sosTabActive,
                focused && !isSOSActive && styles.sosTabFocused,
              ]}>
                <Ionicons
                  name={isSOSActive ? 'alert-circle' : 'alert-circle-outline'}
                  size={sosIconSize}
                  color={isSOSActive ? '#fff' : color}
                />
                {isSOSActive && <View style={styles.sosActiveDot} />}
              </View>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="radar"
        options={{
          title: 'Radar',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'radio' : 'radio-outline'}
              size={iconSize}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="sos"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={iconSize}
              color={color}
            />
          ),
        }}
      />

      {/* ─── Hide from tab bar ─── */}
      <Tabs.Screen name="sos-map" options={{ href: null }} />
      <Tabs.Screen name="SOSMapScreen" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper gives the icon a stable, clipping-free area
  sosTabOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    // Enough space so the red pill + shadow never clips
    width: 44,
    height: 36,
  },
  sosTab: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    // overflow visible so shadow shows on iOS
    overflow: Platform.OS === 'ios' ? 'visible' : 'hidden',
  },
  sosTabFocused: {
    backgroundColor: 'rgba(255,59,48,0.12)',
  },
  sosTabActive: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  sosActiveDot: {
    position: 'absolute',
    top: 2, right: 2,
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
});
