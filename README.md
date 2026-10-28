# 🛡️ RemoteAssist — Consent-First WebRTC Remote Desktop & Support

A transparent, permission-gated remote desktop & assistance tool built with **Node.js, Socket.IO, and WebRTC**.

## Key Security & Permission Guarantees

1. **One-Time 6-Digit Session ID + 4-Digit Security PIN**: Automatically rotates after every disconnected session or on demand.
2. **Explicit Incoming Request Modal**: Even with the Session ID and PIN, the Host laptop displays an approval modal (`Approve (Screen + Control)`, `Approve View-Only`, or `Decline`).
3. **Browser/OS Native Screen Picker (`getDisplayMedia`)**: The Host chooses whether to share their entire screen, a single window, or a single browser tab.
4. **Live Permission Toggle & Kill Switch**: The Host can toggle **Allow Remote Mouse & Keyboard Control** ON or OFF in real time, or press **Stop Session Now** (or `SPACE` in the agent terminal) to immediately revoke control.

---

## Quick Start

### 1. Start the Web & Signaling Server
```bash
npm start
```
Open `http://localhost:3000` in your browser.

### 2. Enable OS-Level Mouse & Keyboard Control on the Host Laptop (Optional)
In a second terminal on the **Host Laptop** (the laptop being shared), run:
```bash
npm run agent
```
- `host-agent.js` binds strictly to `127.0.0.1:3847` (local loopback only).
- It will only move the mouse or press keys when the Host explicitly toggles **"Allow Remote Mouse & Keyboard Control"** ON in the Host dashboard.
- Press `SPACE` at any time inside the agent terminal to immediately pause/resume OS input control.

---

## Connecting Two Laptops Over the Internet

Because WebRTC requires a **Signaling Server** to exchange initial connection offers and **HTTPS** for `getDisplayMedia()` when accessed from a non-localhost domain, you have two easy options to use this over the Internet:

### Option A: Instant HTTPS Tunnel from Your Laptop (Fastest)
Run `npm start` on one laptop, then expose port `3000` over HTTPS using Cloudflare Tunnel or LocalTunnel:
```bash
npx localtunnel --port 3000
```
or with Cloudflare (`cloudflared`):
```bash
cloudflared tunnel --url http://localhost:3000
```
Share the generated `https://...` URL with the other laptop! Both laptops open that URL:
- **Laptop A (Being Helped)** stays on the **Share This Laptop (Host)** tab, runs `npm run agent` locally if they want to grant mouse/keyboard control, and shares their 6-digit Session ID + 4-digit PIN.
- **Laptop B (Controller)** switches to the **Control Another Laptop** tab, enters the Session ID + PIN, and waits for Laptop A to click **Approve**.

### Option B: Deploy `server.js` to Render / Railway / Fly.io
Deploy this folder as a standard Node.js web service (`npm start`). It automatically provides an `https://` URL that both laptops can open from anywhere in the world.
