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

function useScale() {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(Math.max(width / 375, 0.65), 1.4);
  const vs = Math.min(Math.max(height / 812, 0.7), 1.3);
  return {
    width,
    height,
    s: (n: number) => Math.round(n * scale),
    vs: (n: number) => Math.round(n * vs),
    // Percentage-based utilities
    percentWidth: (percent: number) => Math.round((width * percent) / 100),
    percentHeight: (percent: number) => Math.round((height * percent) / 100),
    // Dynamic sizing with min/max
    dynamicSize: (baseSize: number, minSize: number, maxSize: number) => {
      const scaledSize = baseSize * scale;
      return Math.min(Math.max(scaledSize, minSize), maxSize);
    },
  };
}

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

export default function SOSScreen() {
  const { deviceId, contacts, isSOSActive, activeSessionId, setSOSActive } = useAppStore();
  const { width, height, s, vs, percentWidth, percentHeight, dynamicSize } = useScale();

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

  // Responsive SOS button sizing without hardcoded pixels
  const SOS_BTN = dynamicSize(140, 100, 220);
  const RING1 = SOS_BTN + vs(40);
  const RING2 = SOS_BTN + vs(78);
  const SOS_AREA_H = Math.max(RING2 + vs(40), percentHeight(35));

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
      setAddress(addr.trim().replace(/^,\s*/, ''));
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
        setAddress(newAddr.trim().replace(/^,\s*/, ''));
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
      {!!toast && <Toast visible={!!toast} message={toast?.message ?? ''} type={toast?.type} />}

      {/* Custom Alert */}
      {alertProps && (
        <CustomAlert
          {...alertProps}
          visible={alertVisible}
          onClose={() => setAlertVisible(false)}
        />
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        nestedScrollEnabled={false}
      >
        {/* ─── Header ─── */}
        <View style={styles.headerContainer}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>SOS Safety</Text>
            <Text style={styles.headerSub}>Emergency Response</Text>
          </View>
          <View style={[
            styles.statusBadge,
            isSOSActive ? styles.statusActive : styles.statusIdle,
          ]}>
            <View style={[styles.statusDot, isSOSActive ? styles.dotActive : styles.dotIdle]} />
            <Text style={[
              styles.statusText,
              isSOSActive && styles.statusTextActive,
            ]}>
              {isSOSActive ? 'ALERT ACTIVE' : 'Safe'}
            </Text>
          </View>
        </View>

        {/* ─── Location Card ─── */}
        <TouchableOpacity
          style={styles.locationCard}
          onPress={fetchLocation}
          activeOpacity={0.8}
        >
          <View style={styles.locationIcon}>
            <Ionicons name="location" size={s(15)} color="#FF3B30" />
          </View>
          <Text style={styles.locationText} numberOfLines={2}>
            {isFetchingLocation ? 'Searching...' : address}
          </Text>
          <Ionicons
            name={isFetchingLocation ? 'sync' : 'refresh'}
            size={s(14)}
            color={isFetchingLocation ? '#FF9500' : '#555'}
          />
        </TouchableOpacity>

        {/* ─── SOS Button ─── */}
        <View style={[styles.sosArea, { height: SOS_AREA_H }]}>
          {isSOSActive && (
            <Animated.View style={[
              styles.pulseRing,
              { width: RING2, height: RING2, borderRadius: RING2 / 2, transform: [{ scale: pulseAnim2 }] },
            ]} />
          )}
          {isSOSActive && (
            <Animated.View style={[
              styles.pulseRing,
              { width: RING1, height: RING1, borderRadius: RING1 / 2, transform: [{ scale: pulseAnim }] },
            ]} />
          )}

          <Animated.View style={{ transform: [{ scale: btnScale }], width: SOS_BTN, height: SOS_BTN }}>
            <TouchableOpacity
              onPress={isCountingDown ? cancelCountdown : handleSOSPress}
              onPressIn={pressIn}
              onPressOut={pressOut}
              activeOpacity={1}
              style={[
                styles.sosButton,
                { borderRadius: SOS_BTN / 2 },
                isSOSActive && styles.sosButtonActive,
                isCountingDown && styles.sosButtonCounting,
              ]}
            >
              {isCountingDown ? (
                <View style={styles.sosInner}>
                  <Text style={styles.countdownNum}>{countdown}</Text>
                  <Text style={styles.countdownHint}>Tap to cancel</Text>
                </View>
              ) : (
                <View style={styles.sosInner}>
                  <Ionicons
                    name={isSOSActive ? 'stop-circle' : 'alert-circle'}
                    size={s(40)}
                    color="#fff"
                  />
                  <Text style={styles.sosText}>
                    {isSOSActive ? 'STOP' : 'SOS'}
                  </Text>
                  {!isSOSActive && (
                    <Text style={styles.sosHint}>Hold to activate</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* ─── Info row ─── */}
        {!isSOSActive && !isCountingDown && (
          <Text style={styles.infoText}>
            Press → 3 second countdown → SMS + live{'\n'}location sent to {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          </Text>
        )}

        {/* ─── Active SOS Card ─── */}
        {isSOSActive && (
          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <View style={styles.activePulseDot} />
              <Text style={styles.activeTitle}>🚨 Alert Active</Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.activeItem}>• Location updates every 5 seconds</Text>
            <Text style={styles.activeItem}>• SMS sent to {contacts.length} contacts</Text>
            <Text style={styles.activeItem}>• Friends visible on the radar</Text>

            {helpers.length > 0 ? (
              <View style={styles.helpersSection}>
                <Text style={styles.helperTitle}>
                  🏃 {helpers.length} {helpers.length === 1 ? 'friend is' : 'friends are'} coming!
                </Text>
                {helpers.map((h) => (
                  <View key={h.deviceId} style={styles.helperRow}>
                    <View style={styles.helperDot} />
                    <Text style={styles.helperName}>{h.nickname}</Text>
                    <Text style={styles.helperEta}>On the way →</Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.mapBtn}
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
                  <Text style={styles.mapBtnText}>View on map</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.activeItem}>• Waiting for friends to respond...</Text>
            )}
          </View>
        )}

        {/* ─── Quick Actions ─── */}
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/sos')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255,59,48,0.14)' }]}>
              <Ionicons name="people" size={s(18)} color="#FF3B30" />
            </View>
            <Text style={styles.actionLabel}>Contacts</Text>
            <Text style={[styles.actionValue, { color: '#FF3B30' }]}>{contacts.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/(tabs)/radar')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(255,149,0,0.14)' }]}>
              <Ionicons name="radio" size={s(18)} color="#FF9500" />
            </View>
            <Text style={styles.actionLabel}>Radar</Text>
            <Text style={[styles.actionValue, { color: '#FF9500' }]}>📡</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => Linking.openURL('tel:112')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIcon, { backgroundColor: 'rgba(48,209,88,0.14)' }]}>
              <Ionicons name="call" size={s(18)} color="#30D158" />
            </View>
            <Text style={styles.actionLabel}>112 Call</Text>
            <Text style={[styles.actionValue, { color: '#30D158' }]}>📞</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  scrollContent: { flexGrow: 1, paddingHorizontal: '4%', paddingTop: '2%', paddingBottom: '2%' },

  // ─── Header ───────────────────────────────────────────
  headerContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2%', marginTop: '1%', gap: '2%', width: '100%' },
  headerContent: { flex: 1 },
  headerTitle: { color: '#fff', fontWeight: '900', fontSize: 28, letterSpacing: -0.8 },
  headerSub: { color: '#666', marginTop: 4, fontWeight: '600', fontSize: 12, letterSpacing: 0.3 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: '3%',
    paddingVertical: '1.5%',
    borderRadius: 24,
    gap: 6,
    backgroundColor: '#0F0F0F',
    borderWidth: 1.5,
    borderColor: '#222',
    flexShrink: 0,
  },
  statusActive: { backgroundColor: '#3D0A0A', borderColor: '#FF5244' },
  statusIdle: { borderColor: '#1A3A1A' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#30D158' },
  dotActive: { backgroundColor: '#FF3B30' },
  dotIdle: { backgroundColor: '#30D158' },
  statusText: { color: '#888', fontWeight: '800', fontSize: 11, letterSpacing: 0.5 },
  statusTextActive: { color: '#FF5244' },

  // ─── Location Card ────────────────────────────────────
  locationCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: '2%',
    borderWidth: 1,
    borderColor: '#1F1F1F',
    marginTop: '2%',
    marginBottom: '2%',
    paddingVertical: '3%',
    paddingHorizontal: '3%',
    width: '100%',
  },
  locationIcon: {
    backgroundColor: 'rgba(255,59,48,0.16)',
    borderRadius: 10,
    padding: 8,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationText: { flex: 1, color: '#ddd', lineHeight: 20, fontSize: 13, fontWeight: '500' },

  // ─── SOS Area ─────────────────────────────────────────
  sosArea: { alignItems: 'center', justifyContent: 'center', marginVertical: '2%', width: '100%' },
  pulseRing: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#FF3B30',
    opacity: 0.4,
  },
  sosButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 40,
    elevation: 20,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.15)',
    width: '100%',
    height: '100%',
    aspectRatio: 1,
  },
  sosButtonActive: { backgroundColor: '#D42F2F', borderColor: 'rgba(255,255,255,0.2)', shadowOpacity: 0.8 },
  sosButtonCounting: { backgroundColor: '#FF9500', shadowColor: '#FF9500', borderColor: 'rgba(255,255,255,0.2)', shadowOpacity: 0.7 },
  sosInner: { alignItems: 'center', gap: 4, justifyContent: 'center' },
  sosText: { color: '#fff', fontWeight: '900', letterSpacing: 1.5, fontSize: 18 },
  sosHint: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500' },
  countdownNum: { color: '#fff', fontWeight: '900', fontSize: 48, lineHeight: 50 },
  countdownHint: { color: 'rgba(255,255,255,0.75)', fontWeight: '500', fontSize: 10 },

  // ─── Info text ────────────────────────────────────────
  infoText: { color: '#555', textAlign: 'center', lineHeight: 22, paddingHorizontal: '4%', marginVertical: '3%', fontSize: 12, fontWeight: '500', width: '100%' },

  // ─── Active Card ──────────────────────────────────────
  activeCard: {
    backgroundColor: '#0E0303',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FF4A3A',
    gap: 8,
    marginVertical: '3%',
    paddingHorizontal: '4%',
    paddingVertical: '4%',
    width: '100%',
  },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activePulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30' },
  activeTitle: { color: '#FF5244', fontWeight: '800', fontSize: 14 },
  divider: { height: 1.5, backgroundColor: 'rgba(255,59,48,0.18)', marginVertical: '2%', width: '100%' },
  activeItem: { color: '#ccc', lineHeight: 21, fontSize: 12, fontWeight: '500' },
  helpersSection: { marginTop: '3%', borderTopWidth: 1, borderTopColor: 'rgba(255,59,48,0.18)', paddingTop: 12, gap: 6 },
  helperTitle: { color: '#FF9500', fontWeight: '800', fontSize: 12 },
  helperRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  helperDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#30D158' },
  helperName: { color: '#fff', fontWeight: '600', flex: 1, fontSize: 12 },
  helperEta: { color: '#30D158', fontSize: 11, fontWeight: '600' },
  mapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: '3%',
    paddingHorizontal: '3%',
    paddingVertical: '2.5%',
  },
  mapBtnText: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 0.3 },

  // ─── Quick Actions ────────────────────────────────────
  quickActions: { flexDirection: 'row', gap: '2%', marginTop: '5%', marginBottom: '2%', width: '100%' },
  actionCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#131313',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    paddingVertical: '4%',
    paddingHorizontal: '2%',
  },
  actionIcon: { borderRadius: 12, padding: 8, justifyContent: 'center', alignItems: 'center' },
  actionLabel: { color: '#777', fontWeight: '700', fontSize: 10, letterSpacing: 0.3, textAlign: 'center' },
  actionValue: { fontWeight: '800', fontSize: 16 },

  // ─── Custom Alert ─────────────────────────────────────
  alertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: '6%',
    zIndex: 10000,
  },
  alertBox: {
    backgroundColor: '#161616',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: '90%',
    maxWidth: 360,
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.7,
    shadowRadius: 32,
    elevation: 24,
  },
  alertIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '5%',
  },
  alertTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: '3%',
    lineHeight: 24,
    letterSpacing: 0.3,
  },
  alertMessage: {
    color: '#999',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 23,
    marginBottom: '6%',
    fontWeight: '500',
  },
  alertBtns: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  alertBtn: {
    flex: 1,
    minWidth: 90,
    paddingVertical: 14,
    paddingHorizontal: 16,
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
    top: 64,
    left: 16,
    right: 16,
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#2A2A2A',
    borderLeftWidth: 4,
    zIndex: 9999,
    elevation: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
  },
  toastText: {
    color: '#ddd',
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    lineHeight: 19,
    letterSpacing: 0.2,
    maxHeight: 50,
  },
});
