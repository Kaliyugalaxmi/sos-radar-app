# 🔴 SOS Radar Safety App

> A real-time women safety and emergency response mobile application built with **React Native (Expo)** and **Firebase**.

---

## 📱 Overview

SOS Radar enables fast, reliable communication during emergencies through a **trusted, closed safety network**. Users build their network via a friend request system (device ID-based, upgradeable to authentication).

When an SOS is triggered, alerts are sent **in parallel** to:
- 📞 Selected emergency contacts from the phonebook
- 📡 Nearby trusted friends detected via a radar-based geolocation system

If a nearby trusted friend responds with **"I'm coming"**, both users enter **real-time mutual location tracking** until the situation is resolved.

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center">
      <img src="home.jpeg" width="220" alt="SOS Home Screen" />
      <br/>
      <b>SOS Home</b>
      <br/>
      <sub>Hold-to-activate SOS · Location display · Contacts, Radar & 112 shortcuts</sub>
    </td>
    <td align="center">
      <img src="radar.jpeg" width="220" alt="Radar Screen" />
      <br/>
      <b>Radar</b>
      <br/>
      <sub>Live map · Nearby friends within 2km · Device ID sharing</sub>
    </td>
    <td align="center">
      <img src="contacts.jpeg" width="220" alt="Emergency Contacts Screen" />
      <br/>
      <b>Emergency Contacts</b>
      <br/>
      <sub>Add / manage contacts · SMS alert on SOS trigger</sub>
    </td>
  </tr>
</table>

---

## 🚨 Key Features

| Feature | Description |
|---|---|
| 🔴 Hold-to-activate SOS | 3-second countdown prevents accidental triggers — sends SMS + live location |
| 📍 Live Location Display | Shows current city/region on home screen with refresh |
| ✅ Safe Status Indicator | Green "Safe" badge visible on home screen at all times |
| 👥 Emergency Contacts | Add phonebook contacts who receive SMS alerts on SOS |
| 📡 Radar — Nearby Friends | Google Maps view showing trusted friends within 2km radius |
| 🆔 Device ID Network | Unique device ID used to add trusted friends (no account required) |
| 📢 112 Quick Call | One-tap emergency services call directly from the home screen |
| 🔥 Firebase Real-time DB | Instant location and alert updates across all connected devices |
| 🔐 Closed Network | Only verified friends appear on radar — no unknown users |

---

## 🔄 How It Works

```
1. User opens app → current location detected (e.g. Vasai-Virar, Maharashtra)
        │
        ▼
2. User holds SOS button → 3-second countdown begins
        │
        ▼
3. Alert sent simultaneously to:
   ├── 📞 Emergency contacts (SMS + live location link)
   └── 📡 Nearby trusted friends on radar (push alert)
        │
        ▼
4. Friend responds → "I'm Coming"
        │
        ▼
5. Live mutual location tracking begins on map
        │
        ▼
6. User marks themselves Safe → session ends


