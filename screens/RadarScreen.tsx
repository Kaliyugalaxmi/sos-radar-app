import React, { useEffect, useRef } from "react";
import {
    Animated,
    Dimensions,
    Easing,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useRadar } from "../hooks/useRadar";

const { width } = Dimensions.get("window");
const RADAR_SIZE = width * 0.82;
const CENTER = RADAR_SIZE / 2;

// ─── Radar Sweep Animation ────────────────────────────────────────────────────

const RadarSweep = ({ active }: { active: boolean }) => {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 2500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      rotation.stopAnimation();
      rotation.setValue(0);
    }
  }, [active]);

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View
      style={[styles.sweepWrapper, { transform: [{ rotate }] }]}
    >
      {/* Conic-style sweep using a thin triangle */}
      <View style={styles.sweepLine} />
    </Animated.View>
  );
};

// ─── Contact Blip on Radar ────────────────────────────────────────────────────

const ContactBlip = ({
  contact,
  maxRadius,
}: {
  contact: { name: string; distance: number };
  maxRadius: number;
}) => {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.6, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Map distance to pixel position on radar
  const ratio = Math.min(contact.distance / maxRadius, 0.95);
  const px = CENTER + ratio * CENTER * Math.cos(Math.random() * 2 * Math.PI - Math.PI);
  const py = CENTER + ratio * CENTER * Math.sin(Math.random() * 2 * Math.PI - Math.PI);

  return (
    <View style={[styles.blipContainer, { left: px - 6, top: py - 6 }]}>
      <Animated.View style={[styles.blipDot, { transform: [{ scale: pulse }] }]} />
      <Text style={styles.blipLabel}>{contact.name.split(" ")[0]}</Text>
    </View>
  );
};

// ─── Main Radar Screen ────────────────────────────────────────────────────────

export default function RadarScreen() {
  const {
    nearbyContacts,
    currentRadius,
    scanning,
    statusMsg,
    startScan,
  } = useRadar();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📡 Nearby Contacts</Text>
      <Text style={styles.status}>{statusMsg}</Text>

      {/* ── Radar Circle ── */}
      <View style={styles.radar}>
        {/* Concentric rings */}
        {[0.25, 0.5, 0.75, 1].map((scale, i) => (
          <View
            key={i}
            style={[
              styles.ring,
              {
                width: RADAR_SIZE * scale,
                height: RADAR_SIZE * scale,
                borderRadius: (RADAR_SIZE * scale) / 2,
                top: CENTER - (RADAR_SIZE * scale) / 2,
                left: CENTER - (RADAR_SIZE * scale) / 2,
              },
            ]}
          />
        ))}

        {/* Crosshair lines */}
        <View style={styles.crossH} />
        <View style={styles.crossV} />

        {/* Sweep */}
        <RadarSweep active={scanning} />

        {/* Center dot (me) */}
        <View style={styles.centerDot} />

        {/* Contact blips */}
        {nearbyContacts.map((c, i) => (
          <ContactBlip key={i} contact={c} maxRadius={currentRadius} />
        ))}
      </View>

      {/* ── Radius label ── */}
      <Text style={styles.radiusLabel}>Radius: {currentRadius} km</Text>

      {/* ── Contacts List ── */}
      {nearbyContacts.length > 0 && (
        <View style={styles.contactList}>
          {nearbyContacts.map((c, i) => (
            <View key={i} style={styles.contactRow}>
              <View style={styles.greenDot} />
              <Text style={styles.contactName}>{c.name}</Text>
              <Text style={styles.contactDist}>{c.distance.toFixed(2)} km away</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Scan Button ── */}
      <TouchableOpacity
        style={[styles.scanBtn, scanning && styles.scanBtnActive]}
        onPress={startScan}
        disabled={scanning}
        activeOpacity={0.8}
      >
        <Text style={styles.scanBtnText}>
          {scanning ? "Scanning..." : "Start Scan"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050d0f",
    alignItems: "center",
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  title: {
    color: "#00ff88",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 6,
  },
  status: {
    color: "#5affb0",
    fontSize: 13,
    marginBottom: 24,
    textAlign: "center",
  },
  radar: {
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    borderRadius: RADAR_SIZE / 2,
    backgroundColor: "#071a10",
    position: "relative",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#00ff8844",
  },
  ring: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "#00ff8830",
  },
  crossH: {
    position: "absolute",
    width: "100%",
    height: 1,
    backgroundColor: "#00ff8820",
    top: CENTER,
  },
  crossV: {
    position: "absolute",
    width: 1,
    height: "100%",
    backgroundColor: "#00ff8820",
    left: CENTER,
  },
  sweepWrapper: {
    position: "absolute",
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    top: 0,
    left: 0,
    transformOrigin: `${CENTER}px ${CENTER}px`,
  },
  sweepLine: {
    position: "absolute",
    width: CENTER,
    height: 2,
    backgroundColor: "#00ff88bb",
    top: CENTER - 1,
    left: CENTER,
    shadowColor: "#00ff88",
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  centerDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#00ff88",
    top: CENTER - 6,
    left: CENTER - 6,
    shadowColor: "#00ff88",
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 6,
  },
  blipContainer: {
    position: "absolute",
    alignItems: "center",
  },
  blipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#ff4444",
    shadowColor: "#ff4444",
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  blipLabel: {
    color: "#ff8888",
    fontSize: 9,
    marginTop: 2,
  },
  radiusLabel: {
    color: "#00ff8866",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  contactList: {
    width: "100%",
    marginTop: 8,
    gap: 8,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0d2318",
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#00ff88",
  },
  contactName: {
    color: "white",
    fontSize: 14,
    flex: 1,
    fontWeight: "600",
  },
  contactDist: {
    color: "#5affb0",
    fontSize: 12,
  },
  scanBtn: {
    marginTop: 24,
    backgroundColor: "#00ff88",
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 30,
  },
  scanBtnActive: {
    backgroundColor: "#005533",
  },
  scanBtnText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 16,
  },
});