# 📱 Phone Control — Secure PC Remote Desktop

<p align="center">
  <img src="assets/touchpad-preview.png" width="280" alt="Touchpad Mode" />
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/keyboard-preview.png" width="280" alt="Keyboard & Mini-Touchpad Mode" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Windows-blue.svg" alt="Platform: Linux | Windows">
  <img src="https://img.shields.io/badge/Latency-%3C1ms-brightgreen.svg" alt="Latency: <1ms">
  <img src="https://img.shields.io/badge/Security-Hardened%20by%20Default-success.svg" alt="Security: Hardened">
  <img src="https://img.shields.io/badge/PWA-Ready-purple.svg" alt="PWA: Ready">
</p>

Turn any smartphone (iOS / Android) into an ultra-low-latency wireless trackpad, keyboard, and media controller for your PC (**Linux & Windows**) — without installing any apps on your phone.

Scan a QR code from your terminal and pair instantly.

```
                                                     ┌──(Linux Pipe)──► uinput C Driver ──► /dev/uinput (Wayland/X11)
                                                     │
Smartphone Browser ──(WebSocket Wi-Fi)──► Node Server
                                                     │
                                                     └──(Win32 Pipe)──► windows_driver ──► SendInput (Windows OS)
```

---

## ✨ Features

- **📱 Zero App Installation**: Works on any mobile browser (Safari, Chrome, Firefox) as a full PWA.
- **⚡ Sub-millisecond Latency**: Direct kernel input simulation via `/dev/uinput` (Linux) and high-performance Win32 `SendInput` (Windows).
- **🎯 Dynamic Touchpad**:
  - 1 finger: Smooth cursor glide with velocity acceleration curve.
  - 1 finger tap: Left click.
  - 2 fingers tap: Right click.
  - 2 fingers scroll: Fluid horizontal and vertical mouse wheel scrolling.
  - Long press hold: Drag and drop (windows, text selection).
  - Physical buttons: Left, Middle, and Right mouse buttons.
- **🎛️ Dual-Mode Keyboard & Mini-Touchpad**:
  - Move the cursor and click directly from the **Teclado** tab without switching tabs.
  - Dedicated **Fast Scroll Rail**: Slide one finger along the vertical edge for high-speed scrolling with tactile haptic ticks.
- **⌨️ Native Mobile Keyboard**:
  - Use your phone's native keyboard (auto-complete, accents, emojis, and **speech-to-text dictation**).
  - Full Unicode typing support on Windows and Linux (`á`, `é`, `í`, `ñ`, symbols).
  - Quick modifiers: `Ctrl`, `Alt`, `Shift`, `Super` (Windows key) with sticky toggle states.
  - Symmetrical D-Pad (`▲`, `◀`, `▼`, `▶`).
  - Direct shortcuts: `Ctrl+C`, `Ctrl+V`, `Ctrl+Z`, `Ctrl+A`, `Alt+Tab`, `Close App` (`Alt+F4` on Windows / `Super+Q` on Linux).
- **🎵 Multimedia, Video & Presentation**:
  - Hardware volume controls (Windows audio overlay / Linux `wpctl`).
  - Media playback controls: Play/Pause, Next, Prev.
  - **Video Seeking**: Instant jump forward / backward (-10s, -5s, +5s, +10s) optimized for YouTube, Netflix, Disney+, Prime Video, VLC, and HTML5 players.
  - Quick Touchpad media bar: Access `Play/Pause`, `-5s`, and `+5s` directly from the touchpad without switching tabs.
  - Presentation mode: Next/Prev slide (`PageUp` / `PageDown`).
- **🔋 Battery & Screen Saver**:
  - Uses the **Screen Wake Lock API** so your phone screen never turns off while using it.
  - Tactile haptic feedback (`navigator.vibrate`) on clicks and key presses.
  - Responsive dark OLED interface (<2% phone battery usage).

---

## 🛡️ Security Architecture (Hardened by Default)

Built following modern cybersecurity audit principles:

1. **🔒 Cryptographic Timing-Safe Authentication**:
   - Each session generates an entropy-backed hex token.
   - Verified via `crypto.timingSafeEqual` to eliminate side-channel timing attacks.
   - Unauthorized attempts reject all input emulation.
2. **🚫 Cross-Site WebSocket Hijacking (CSWSH) Defense**:
   - Validates the `Origin` header on every WebSocket upgrade. Malicious websites cannot connect in the background.
3. **🧱 LAN-Only Firewall Integration**:
   - Linux: `manage-firewall.sh` (UFW restricted to local subnet).
   - Windows: `manage-firewall.ps1` / `manage-firewall.bat` (`New-NetFirewallRule` restricted to `LocalSubnet`).
4. **🛑 IP Rate-Limiting & Brute-Force Shield**:
   - Enforces a threshold of 5 failed attempts before temporarily blacklisting an IP address.
5. **🛡️ Safe Memory & Process Isolation**:
   - Drivers use 0 heap leaks and block cleanly on standard input when idle.
   - All input coordinates and keycodes are strictly bounds-checked and clamped.
6. **🌐 Dynamic Port & Multi-Interface Resolution**:
   - Automatically detects active ports and avoids collisions (`EADDRINUSE`).
   - Surfaces all available network interfaces (Wi-Fi, Ethernet, Hotspot, Tailscale).

---

## 🚀 Quick Start

### 1. Requirements

- **Node.js** v18+ and `pnpm` (or `npm`)
- **OS**:
  - **Linux**: `gcc` or `clang`, `make`
  - **Windows**: Windows 10/11 (uses built-in `csc.exe` of .NET Framework, zero extra tools required!)

### 2. Setup (One-time command)

#### On Windows:
Run with PowerShell:
```powershell
git clone https://github.com/programadorisgod/phone-control.git
cd phone-control
.\setup.ps1
```
*(Or double-click `setup.bat` directly from File Explorer)*

#### On Linux:
```bash
git clone https://github.com/programadorisgod/phone-control.git
cd phone-control
./setup.sh
```

### 3. Start

#### On Windows:
```powershell
.\start.ps1
```
*(Or double-click `start.bat`)*

#### On Linux:
```bash
./start.sh
```

A QR code and local URL will appear in your terminal. Point your smartphone's camera at the terminal to connect!

---

## ⚙️ Configuration & Settings

All settings can be customized in real-time from the **Ajustes** tab on your phone:
- **Pointer Sensitivity**: 0.4x to 2.5x
- **Scroll Sensitivity**: 0.5x to 2.0x
- **Dynamic Acceleration**: On / Off
- **Natural Scrolling**: Inverted scroll On / Off
- **Haptic Vibration**: On / Off
- **Wake Lock (Keep Screen Awake)**: On / Off

---

## 🛡️ Firewall Management

### On Windows:
```powershell
# Check status
.\manage-firewall.bat status

# Restrict port 5252 strictly to your local Wi-Fi / LAN (Run as Admin)
.\manage-firewall.bat allow-lan 5252

# Remove rule
.\manage-firewall.bat remove
```

### On Linux:
```bash
# Check status
./manage-firewall.sh status

# Restrict port 5252 to local LAN
./manage-firewall.sh allow-lan 5252
```

---

## 📄 License

MIT License. Free for personal and commercial use.
