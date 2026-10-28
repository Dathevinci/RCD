# 🛡️ Prashnaa — Consent-First WebRTC Remote Desktop & Live Support

**Prashnaa** is a fast, zero-command, permission-gated remote desktop & assistance tool built with **WebRTC (PeerJS P2P)** and a lightweight native Windows Helper (`RemoteAssist-Helper.exe`).

It runs directly on **GitHub Pages** (`index.html` and `partner.html`) with no terminal commands required for either partner.

## ✨ Key Features

1. **1-Click Partner Link & Auto-Reconnect**:
   - Send the 1-Click Partner Link (`partner.html?room=...`) to your partner.
   - Automatic mid-session recovery: if a brief Wi-Fi or network hiccup occurs, Prashnaa keeps the screen stream alive and automatically reconnects both video and mouse/keyboard control without requiring the partner to re-share their screen.
2. **Zero-CMD Windows Mouse & Keyboard Helper (`RemoteAssist-Helper.exe`)**:
   - Tiny (~16 KB) native Windows helper compiled from `RemoteAssistHelper.cs`.
   - Uses persistent HTTP Keep-Alive on `127.0.0.1:3847` with coalesced pointer movement so sockets never clog or drop during fast mouse movement.
   - Supports full cursor movement, left/right/double clicks, drag & drop, scroll wheel, `Show Desktop` (`Win+D`), `Open File Explorer`, `Copy` (`Ctrl+C`), `Paste` (`Ctrl+V`), `Quick Type`, and keyboard forwarding.
3. **Explicit Consent & Instant Kill Switch**:
   - Your partner can toggle mouse/keyboard control ON or OFF in real time or click **STOP SHARING NOW** at any instant.
4. **Live Latency Monitor & Collapsible Chat**:
   - Real-time P2P ping indicator (`ms`), manual **Refresh Stream** button, and bidirectional live chat on both the Controller dashboard and Simple Partner page.

---

## 🚀 Usage on GitHub Pages

1. **Controller (You)**:
   - Open `index.html`.
   - Click **📋 Copy Partner Link** and send it to your partner.
2. **Partner (Being Helped)**:
   - Opens your link (`partner.html?room=...`).
   - **Step 1**: Clicks **Download & Open Prashnaa Helper** (`RemoteAssist-Helper.exe`) to enable mouse & file control.
   - **Step 2**: Clicks **Allow & Share Entire Screen** and selects the **Entire Screen** tab.

---

## 🛠️ Building the Windows Helper (`RemoteAssist-Helper.exe`)

To recompile `RemoteAssistHelper.cs` on Windows using the built-in .NET Framework compiler:

```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:winexe /out:RemoteAssist-Helper.exe RemoteAssistHelper.cs
```
