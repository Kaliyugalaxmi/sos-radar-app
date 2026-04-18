// app/(tabs)/index.tsx
// SOS Main Screen — Enhanced UI + Custom Modals + Fast2SMS
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
  useWindowDimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  HelperInfo,
  createEmergencySession,
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

// ─── Responsive scale ─────────────────────────────────────────────────────────
function useScale() {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.78), 1.3);
  const vs = Math.min(Math.max(height / 812, 0.75), 1.3);
  return {
    width,
    height,
    s: (n: number) => Math.round(n * scale),
    vs: (n: number) => Math.round(n * vs),
  };
}

// ─── Custom Alert Modal ───────────────────────────────────────────────────────
type AlertButton = { label: string; onPress?: () => void; variant?: 'default' | 'destructive' | 'primary' };

interface CustomAlertProps {
  visible: boolean;
  icon?: string;
  iconColor?: string;
  title: string;
  message?: string;
  buttons: AlertButton[];
  onClose: () => void;
}

function CustomAlert({ visible, icon, iconColor = '#FF3B30', title, message, buttons, onClose }: CustomAlertProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, damping: 18, stiffness: 260, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 140, useNativeDriver: true }).start();
      scaleAnim.setValue(0.88);
    }
  }, [visible]);

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Animated.View style={[styles.alertOverlay, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.alertBox, { transform: [{ scale: scaleAnim }] }]}>
          {icon && (
            <View style={[styles.alertIconWrap, { backgroundColor: iconColor + '18' }]}>
              <Ionicons name={icon as any} size={32} color={iconColor} />
            </View>
          )}
          <Text style={styles.alertTitle}>{title}</Text>
          {message ? <Text style={styles.alertMessage}>{message}</Text> : null}
          <View style={[styles.alertBtns, buttons.length > 2 && { flexDirection: 'column' }]}>
            {buttons.map((btn, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.alertBtn,
                  btn.variant === 'destructive' && styles.alertBtnDestructive,
                  btn.variant === 'primary' && styles.alertBtnPrimary,
                  buttons.length === 1 && { flex: 1 },
                  buttons.length > 2 && { width: '100%', marginBottom: 8 },
                ]}
                onPress={() => { btn.onPress?.(); onClose(); }}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.alertBtnText,
                    btn.variant === 'destructive' && styles.alertBtnTextDestructive,
                    btn.variant === 'primary' && styles.alertBtnTextPrimary,
                  ]}
                >
                  {btn.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Toast notification ───────────────────────────────────────────────────────
interface ToastProps { visible: boolean; message: string; type?: 'success' | 'error' | 'info' }

function Toast({ visible, message, type = 'info' }: ToastProps) {
  const slideAnim = useRef(new Animated.Value(-80)).current;
  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, damping: 16, stiffness: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: -80, duration: 240, easing: Easing.in(Easing.ease), useNativeDriver: true }).start();
    }
  }, [visible]);
  const colors = { success: '#30D158', error: '#FF3B30', info: '#0A84FF' };
  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY: slideAnim }], borderLeftColor: colors[type] }]}>
      <Ionicons
        name={type === 'success' ? 'checkmark-circle' : type === 'error' ? 'alert-circle' : 'information-circle'}
        size={18}
        color={colors[type]}
      />
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SOSScreen() {
  const { deviceId, contacts, isSOSActive, activeSessionId, setSOSActive } = useAppStore();
  const { width, height, s } = useScale();

  const [countdown, setCountdown] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
  const [address, setAddress] = useState('Fetching location...');
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [helpers, setHelpers] = useState<HelperInfo[]>([]);

  // Custom alert state
  const [alertProps, setAlertProps] = useState<Omit<CustomAlertProps, 'onClose' | 'visible'> | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const btnScale = useRef(new Animated.Value(1)).current;
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopWatchingLocation = useRef<(() => void) | null>(null);
  const stopWatchingHelpers = useRef<(() => void) | null>(null);

  const SOS_BTN = Math.min(Math.max(width * 0.42, 148), 210);
  const RING1 = SOS_BTN + 40;
  const RING2 = SOS_BTN + 78;
  const SOS_AREA_H = Math.min(RING2 + 32, height * 0.38);

  function showAlert(props: Omit<CustomAlertProps, 'onClose' | 'visible'>) {
    setAlertProps(props);
    setAlertVisible(true);
  }

  function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }

  // SOS pulse animations
  useEffect(() => {
    if (isSOSActive) {
      const loop1 = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.28, duration: 850, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 850, useNativeDriver: true }),
        ])
      );
      const loop2 = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim2, { toValue: 1.16, duration: 1150, useNativeDriver: true }),
          Animated.timing(pulseAnim2, { toValue: 1, duration: 1150, useNativeDriver: true }),
        ])
      );
      loop1.start();
      loop2.start();
    } else {
      pulseAnim.setValue(1);
      pulseAnim2.setValue(1);
    }
  }, [isSOSActive]);

  // Subscribe helpers when SOS is active
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

  function pressIn() {
    Animated.spring(btnScale, { toValue: 0.93, useNativeDriver: true, damping: 10 }).start();
  }
  function pressOut() {
    Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, damping: 10 }).start();
  }

  function handleSOSPress() {
    if (isSOSActive) {
      showAlert({
        icon: 'stop-circle',
        iconColor: '#FF3B30',
        title: 'Cancel SOS Alert?',
        message: 'This will stop the emergency alert and notify all contacts you are safe.',
        buttons: [
          { label: 'Keep Active', variant: 'default' },
          { label: 'Yes, Cancel SOS', variant: 'destructive', onPress: cancelSOS },
        ],
      });
      return;
    }
    if (contacts.length === 0) {
      showAlert({
        icon: 'people',
        iconColor: '#FF9500',
        title: 'No Emergency Contacts',
        message: 'Add at least one emergency contact before activating SOS.',
        buttons: [
          { label: 'Cancel', variant: 'default' },
          { label: 'Add Contacts', variant: 'primary', onPress: () => router.push('/(tabs)/sos') },
        ],
      });
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
    showToast('SOS countdown cancelled', 'info');
  }

  async function activateSOS() {
    if (!deviceId || !currentLocation) {
      showAlert({
        icon: 'warning',
        iconColor: '#FF9500',
        title: 'Location Not Found',
        message: 'Could not get your location. Please enable location permissions and try again.',
        buttons: [{ label: 'OK', variant: 'primary' }],
      });
      return;
    }
    try {
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);
      const sessionId = await createEmergencySession(deviceId, currentLocation, address);
      setSOSActive(true, sessionId);

      const smsSent = await sendEmergencySMS(contacts, currentLocation, deviceId);

      stopWatchingLocation.current = watchLocation(async (coords) => {
        setCurrentLocation(coords);
        const newAddr = await getAddressFromCoords(coords);
        setAddress(newAddr);
        await updateLiveLocation(sessionId, coords);
      });

      if (smsSent) {
        showToast(`SOS sent to ${contacts.length} contact${contacts.length > 1 ? 's' : ''} via SMS`, 'success', 4000);
      } else {
        showToast('Alert active — SMS delivery pending', 'info', 4000);
      }

      showAlert({
        icon: 'alert-circle',
        iconColor: '#FF3B30',
        title: '🚨 SOS Activated!',
        message: `Emergency alert sent to ${contacts.length} contact${contacts.length > 1 ? 's' : ''}. Your live location is being shared.`,
        buttons: [{ label: 'Got it', variant: 'primary' }],
      });
    } catch (error) {
      showAlert({
        icon: 'close-circle',
        iconColor: '#FF3B30',
        title: 'Activation Failed',
        message: 'Could not activate SOS. Please try again or call 112.',
        buttons: [
          { label: 'Try Again', variant: 'primary', onPress: activateSOS },
          { label: 'Call 112', variant: 'destructive', onPress: () => Linking.openURL('tel:112') },
        ],
      });
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
      showToast('SOS cancelled. Stay safe!', 'success', 3500);
    } catch {
      setSOSActive(false);
    }
  }

  const isCountingDown = countdown !== null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Toast */}
      <Toast visible={!!toast} message={toast?.message ?? ''} type={toast?.type} />

      {/* Custom Alert */}
      {alertProps && (
        <CustomAlert
          {...alertProps}
          visible={alertVisible}
          onClose={() => setAlertVisible(false)}
        />
      )}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: s(18), paddingTop: s(16), paddingBottom: s(32) }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─── */}
        <View style={[styles.header, { marginBottom: s(14) }]}>
          <View style={{ flex: 1, marginRight: s(12) }}>
            <Text style={[styles.headerTitle, { fontSize: s(26) }]}>SOS Safety</Text>
            <Text style={[styles.headerSub, { fontSize: s(12) }]}>Emergency Response</Text>
          </View>
          <View style={[
            styles.statusBadge,
            isSOSActive ? styles.statusActive : styles.statusIdle,
          ]}>
            <View style={[styles.statusDot, isSOSActive ? styles.dotActive : styles.dotIdle]} />
            <Text style={[
              styles.statusText,
              { fontSize: s(11) },
              isSOSActive && styles.statusTextActive,
            ]}>
              {isSOSActive ? 'ALERT ACTIVE' : 'Safe'}
            </Text>
          </View>
        </View>

        {/* ─── Location Card ─── */}
        <TouchableOpacity
          style={[styles.locationCard, { padding: s(12), marginBottom: s(24) }]}
          onPress={fetchLocation}
          activeOpacity={0.8}
        >
          <View style={styles.locationIconWrap}>
            <Ionicons name="location" size={s(15)} color="#FF3B30" />
          </View>
          <Text style={[styles.locationText, { fontSize: s(13) }]} numberOfLines={2}>
            {isFetchingLocation ? 'Searching...' : address}
          </Text>
          <View style={{ padding: s(6) }}>
            <Ionicons
              name={isFetchingLocation ? 'sync' : 'refresh'}
              size={s(14)}
              color={isFetchingLocation ? '#FF9500' : '#555'}
            />
          </View>
        </TouchableOpacity>

        {/* ─── SOS Button ─── */}
        <View style={[styles.sosArea, { height: SOS_AREA_H, marginBottom: s(16) }]}>
          {isSOSActive && (
            <Animated.View style={[
              styles.pulseRing,
              { width: RING2, height: RING2, borderRadius: RING2 / 2, transform: [{ scale: pulseAnim2 }], opacity: 0.3 },
            ]} />
          )}
          {isSOSActive && (
            <Animated.View style={[
              styles.pulseRing,
              { width: RING1, height: RING1, borderRadius: RING1 / 2, transform: [{ scale: pulseAnim }], borderWidth: 2 },
            ]} />
          )}

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <TouchableOpacity
              onPress={isCountingDown ? cancelCountdown : handleSOSPress}
              onPressIn={pressIn}
              onPressOut={pressOut}
              activeOpacity={1}
              style={[
                styles.sosButton,
                { width: SOS_BTN, height: SOS_BTN, borderRadius: SOS_BTN / 2 },
                isSOSActive && styles.sosButtonActive,
                isCountingDown && styles.sosButtonCounting,
              ]}
            >
              {isCountingDown ? (
                <View style={styles.sosInner}>
                  <Text style={[styles.countdownNum, { fontSize: s(52) }]}>{countdown}</Text>
                  <Text style={[styles.countdownHint, { fontSize: s(11) }]}>Tap to cancel</Text>
                </View>
              ) : (
                <View style={styles.sosInner}>
                  <Ionicons
                    name={isSOSActive ? 'stop-circle' : 'alert-circle'}
                    size={s(42)}
                    color="#fff"
                  />
                  <Text style={[styles.sosText, { fontSize: s(20), letterSpacing: s(5) }]}>
                    {isSOSActive ? 'STOP' : 'SOS'}
                  </Text>
                  {!isSOSActive && (
                    <Text style={[styles.sosHint, { fontSize: s(11) }]}>Hold to activate</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ─── Info row ─── */}
        {!isSOSActive && !isCountingDown && (
          <Text style={[styles.infoText, { fontSize: s(13), marginBottom: s(22) }]}>
            Press → 3 second countdown → SMS + live{'\n'}location sent to {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          </Text>
        )}

        {/* ─── Active SOS Card ─── */}
        {isSOSActive && (
          <View style={[styles.activeCard, { padding: s(14), marginBottom: s(22) }]}>
            <View style={styles.activeHeader}>
              <View style={styles.activePulseDot} />
              <Text style={[styles.activeTitle, { fontSize: s(14) }]}>🚨 Alert Active</Text>
            </View>
            <View style={styles.divider} />
            <Text style={[styles.activeItem, { fontSize: s(12) }]}>• Location updates every 5 seconds</Text>
            <Text style={[styles.activeItem, { fontSize: s(12) }]}>• SMS sent via Fast2SMS to {contacts.length} contacts</Text>
            <Text style={[styles.activeItem, { fontSize: s(12) }]}>• Friends visible on the radar</Text>

            {helpers.length > 0 ? (
              <View style={styles.helpersSection}>
                <Text style={[styles.helperTitle, { fontSize: s(12) }]}>
                  🏃 {helpers.length} {helpers.length === 1 ? 'friend is' : 'friends are'} coming!
                </Text>
                {helpers.map((h) => (
                  <View key={h.deviceId} style={styles.helperRow}>
                    <View style={styles.helperDot} />
                    <Text style={[styles.helperName, { fontSize: s(12) }]}>{h.nickname}</Text>
                    <Text style={[styles.helperEta, { fontSize: s(11) }]}>On the way →</Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={[styles.mapBtn, { padding: s(9) }]}
                  onPress={() => router.push({
                    pathname: '/sos-map',
                    params: {
                      sessionId: activeSessionId!,
                      role: 'victim',
                      victimLat: currentLocation?.latitude?.toString() ?? '',
                      victimLon: currentLocation?.longitude?.toString() ?? '',
                    },
                  })}
                >
                  <Ionicons name="map" size={s(13)} color="#fff" />
                  <Text style={[styles.mapBtnText, { fontSize: s(12) }]}>View on map</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[styles.activeItem, { fontSize: s(12) }]}>• Waiting for friends to respond...</Text>
            )}
          </View>
        )}

        {/* ─── Quick Actions ─── */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.actionCard, { padding: s(14) }]}
            onPress={() => router.push('/(tabs)/sos')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255,59,48,0.14)', borderRadius: s(10), padding: s(7) }]}>
              <Ionicons name="people" size={s(19)} color="#FF3B30" />
            </View>
            <Text style={[styles.actionLabel, { fontSize: s(10) }]}>Contacts</Text>
            <Text style={[styles.actionValue, { fontSize: s(16), color: '#FF3B30' }]}>{contacts.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { padding: s(14) }]}
            onPress={() => router.push('/(tabs)/radar')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255,149,0,0.14)', borderRadius: s(10), padding: s(7) }]}>
              <Ionicons name="radio" size={s(19)} color="#FF9500" />
            </View>
            <Text style={[styles.actionLabel, { fontSize: s(10) }]}>Radar</Text>
            <Text style={[styles.actionValue, { fontSize: s(16), color: '#FF9500' }]}>📡</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { padding: s(14) }]}
            onPress={() => Linking.openURL('tel:112')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(48,209,88,0.14)', borderRadius: s(10), padding: s(7) }]}>
              <Ionicons name="call" size={s(19)} color="#30D158" />
            </View>
            <Text style={[styles.actionLabel, { fontSize: s(10) }]}>112 Call</Text>
            <Text style={[styles.actionValue, { fontSize: s(16), color: '#30D158' }]}>📞</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  scroll: { flexGrow: 1 },

  // ─── Header ───────────────────────────────────────────
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontWeight: '800' },
  headerSub: { color: '#555', marginTop: 2, fontWeight: '500' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#232323',
    flexShrink: 0,
  },
  statusActive: { backgroundColor: '#280606', borderColor: '#FF3B30' },
  statusIdle: {},
  statusDot: { width: 7, height: 7, borderRadius: 3.5, flexShrink: 0 },
  dotActive: { backgroundColor: '#FF3B30' },
  dotIdle: { backgroundColor: '#30D158' },
  statusText: { color: '#555', fontWeight: '700' },
  statusTextActive: { color: '#FF3B30' },

  // ─── Location Card ────────────────────────────────────
  locationCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  locationIconWrap: {
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderRadius: 8,
    padding: 6,
    flexShrink: 0,
  },
  locationText: { flex: 1, color: '#bbb', lineHeight: 18 },

  // ─── SOS Area ─────────────────────────────────────────
  sosArea: { alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
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
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 18,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sosButtonActive: { backgroundColor: '#CC0F0F', borderColor: 'rgba(255,255,255,0.18)' },
  sosButtonCounting: { backgroundColor: '#FF9500', shadowColor: '#FF9500', borderColor: 'rgba(255,255,255,0.18)' },
  sosInner: { alignItems: 'center', gap: 4 },
  sosText: { color: '#fff', fontWeight: '900' },
  sosHint: { color: 'rgba(255,255,255,0.6)' },
  countdownNum: { color: '#fff', fontWeight: '900', lineHeight: 60 },
  countdownHint: { color: 'rgba(255,255,255,0.7)' },

  // ─── Info text ────────────────────────────────────────
  infoText: { color: '#444', textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },

  // ─── Active Card ──────────────────────────────────────
  activeCard: {
    backgroundColor: '#0E0303',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FF3B30',
    gap: 6,
  },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activePulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  activeTitle: { color: '#FF3B30', fontWeight: '700' },
  divider: { height: 1, backgroundColor: 'rgba(255,59,48,0.15)', marginVertical: 2 },
  activeItem: { color: '#ccc', lineHeight: 20 },
  helpersSection: { marginTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,59,48,0.15)', paddingTop: 10, gap: 6 },
  helperTitle: { color: '#FF9500', fontWeight: '700' },
  helperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  helperDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#30D158', flexShrink: 0 },
  helperName: { color: '#fff', fontWeight: '600', flex: 1 },
  helperEta: { color: '#30D158' },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  mapBtnText: { color: '#fff', fontWeight: '700' },

  // ─── Quick Actions ────────────────────────────────────
  quickActions: { flexDirection: 'row', gap: 8 },
  actionCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#111',
    borderRadius: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1A1A1A',
  },
  actionIcon: {},
  actionLabel: { color: '#666', fontWeight: '600' },
  actionValue: { fontWeight: '800' },

  // ─── Custom Alert ─────────────────────────────────────
  alertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  alertBox: {
    backgroundColor: '#161616',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#272727',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  alertIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  alertTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 22,
  },
  alertMessage: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  alertBtns: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    flexWrap: 'nowrap',
  },
  alertBtn: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#232323',
    borderWidth: 1,
    borderColor: '#2E2E2E',
  },
  alertBtnDestructive: {
    backgroundColor: 'rgba(255,59,48,0.15)',
    borderColor: 'rgba(255,59,48,0.4)',
  },
  alertBtnPrimary: {
    backgroundColor: '#FF3B30',
    borderColor: '#FF3B30',
  },
  alertBtnText: {
    color: '#aaa',
    fontSize: 14,
    fontWeight: '600',
  },
  alertBtnTextDestructive: { color: '#FF3B30' },
  alertBtnTextPrimary: { color: '#fff' },

  // ─── Toast ────────────────────────────────────────────
  toast: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 999,
  },
  toastText: {
    color: '#ddd',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
});
