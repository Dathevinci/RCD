(() => {
  const PEER_PREFIX_HOST = 'ra-host-';
  const PEER_PREFIX_CTRL = 'ra-ctrl-';

  const PEER_CONFIG = {
    pingInterval: 5000,
    config: {
      sdpSemantics: 'unified-plan',
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  };

  function randomDigits(len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += Math.floor(Math.random() * 10).toString();
    }
    if (s[0] === '0') s = '1' + s.slice(1);
    return s;
  }

  function getSavedOrCreateDigits(storageKey, len) {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && saved.length === len && /^\d+$/.test(saved)) {
        return saved;
      }
      const fresh = randomDigits(len);
      sessionStorage.setItem(storageKey, fresh);
      return fresh;
    } catch {
      return randomDigits(len);
    }
  }

  const params = new URLSearchParams(window.location.search);
  const inviteRoomCode = params.get('room');

  const stepReady = document.getElementById('stepReady');
  const stepApprove = document.getElementById('stepApprove');
  const stepActive = document.getElementById('stepActive');

  const partnerConnBadge = document.getElementById('partnerConnBadge');
  const step1Card = document.getElementById('step1Card');
  const partnerHelperDot = document.getElementById('partnerHelperDot');
  const partnerHelperTitle = document.getElementById('partnerHelperTitle');
  const partnerHelperBadge = document.getElementById('partnerHelperBadge');
  const partnerHelperDesc = document.getElementById('partnerHelperDesc');
  const partnerDownloadBtn = document.getElementById('partnerDownloadBtn');
  const activeMissingHelperBtn = document.getElementById('activeMissingHelperBtn');

  const startSimpleShareBtn = document.getElementById('startSimpleShareBtn');
  const simpleAllowControl = document.getElementById('simpleAllowControl');
  const simpleCodeDisplay = document.getElementById('simpleCodeDisplay');

  const simpleHelperName = document.getElementById('simpleHelperName');
  const confirmApproveBtn = document.getElementById('confirmApproveBtn');
  const confirmDeclineBtn = document.getElementById('confirmDeclineBtn');

  const activeStatusIcon = document.getElementById('activeStatusIcon');
  const activeStatusHeading = document.getElementById('activeStatusHeading');
  const activePartnerStatus = document.getElementById('activePartnerStatus');
  const notEntireScreenWarningBtn = document.getElementById('notEntireScreenWarningBtn');
  const simplePreviewVideo = document.getElementById('simplePreviewVideo');
  const simpleRemoteCursor = document.getElementById('simpleRemoteCursor');
  const simpleCursorTag = document.getElementById('simpleCursorTag');
  const activeControlSwitch = document.getElementById('activeControlSwitch');
  const stopSimpleShareBtn = document.getElementById('stopSimpleShareBtn');

  const partnerChatMessages = document.getElementById('partnerChatMessages');
  const partnerChatForm = document.getElementById('partnerChatForm');
  const partnerChatInput = document.getElementById('partnerChatInput');
  const partnerResyncBtn = document.getElementById('partnerResyncBtn');

  let sessionState = {
    sessionId: getSavedOrCreateDigits('prashnaa_partner_id', 6),
    pin: getSavedOrCreateDigits('prashnaa_partner_pin', 4),
    allowControl: true,
    connected: false,
    helperName: 'Your Partner',
    lastControllerPeerId: inviteRoomCode ? PEER_PREFIX_CTRL + inviteRoomCode.replace(/\D/g, '') : null,
    lastRemoteActivityAt: 0
  };

  let peer = null;
  let activeDataConn = null;
  let pendingDataConn = null;
  let pendingReconnectConn = null;
  let pendingReconnectStartedAt = 0;
  let activeMediaCall = null;
  let localStream = null;

  let helperExeActive = false;
  let helperFailStreak = 0;
  let explicitlyStopped = false;
  let partnerReconnectTimer = null;

  // Background tab anti-throttling resources (when Partner's browser is minimized via Win+D)
  let wakeLockSentinel = null;
  let keepAwakeAudioCtx = null;
  let keepAwakeLockRelease = null;

  async function acquireTabKeepAwake() {
    try {
      if ('wakeLock' in navigator && !wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } catch {}

    try {
      if ('locks' in navigator && !keepAwakeLockRelease) {
        navigator.locks.request('prashnaa_partner_active_share', () => {
          return new Promise((resolve) => {
            keepAwakeLockRelease = resolve;
          });
        }).catch(() => {});
      }
    } catch {}

    try {
      if (!keepAwakeAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          keepAwakeAudioCtx = new AudioCtx();
          const osc = keepAwakeAudioCtx.createOscillator();
          const gain = keepAwakeAudioCtx.createGain();
          gain.gain.value = 0.00001;
          osc.connect(gain);
          gain.connect(keepAwakeAudioCtx.destination);
          osc.start();
        }
      } else if (keepAwakeAudioCtx.state === 'suspended') {
        keepAwakeAudioCtx.resume().catch(() => {});
      }
    } catch {}
  }

  function releaseTabKeepAwake() {
    if (wakeLockSentinel) {
      try { wakeLockSentinel.release(); } catch {}
      wakeLockSentinel = null;
    }
    if (keepAwakeLockRelease) {
      try { keepAwakeLockRelease(); } catch {}
      keepAwakeLockRelease = null;
    }
    if (keepAwakeAudioCtx) {
      try { keepAwakeAudioCtx.close(); } catch {}
      keepAwakeAudioCtx = null;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function appendPartnerChat({ senderName, text, self }) {
    if (!partnerChatMessages) return;
    const empty = partnerChatMessages.querySelector('.chat-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `chat-bubble ${self ? 'self' : ''}`;
    div.style.padding = '6px 9px';
    div.style.fontSize = '12.5px';
    div.innerHTML = `<strong style="color:${self ? '#93c5fd' : '#34d399'};">${escapeHtml(senderName || 'Partner')}:</strong> ${escapeHtml(text)}`;
    partnerChatMessages.appendChild(div);
    partnerChatMessages.scrollTop = partnerChatMessages.scrollHeight;
  }

  if (partnerChatForm) {
    partnerChatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = partnerChatInput.value.trim();
      if (!text) return;
      if (activeDataConn && activeDataConn.open) {
        try {
          activeDataConn.send({
            type: 'chat',
            senderName: 'Partner Laptop',
            text
          });
        } catch {}
      }
      appendPartnerChat({ senderName: 'You', text, self: true });
      partnerChatInput.value = '';
    });
  }

  // ==================== UNIFIED SINGLE-FLIGHT LOCAL HELPER BRIDGE (127.0.0.1:3847) ====================
  let helperRequestInFlight = false;
  let pendingMoveEvent = null;
  let pendingScrollDeltaY = 0;
  const helperActionQueue = [];

  function sendToLocalHelper(ev) {
    if (!sessionState.allowControl || !helperExeActive || !ev) return;

    if (ev.type === 'pointer-move') {
      pendingMoveEvent = ev;
      pumpLocalHelperQueue();
      return;
    }

    if (ev.type === 'mouse-scroll') {
      pendingScrollDeltaY += Number(ev.deltaY) || 0;
      pumpLocalHelperQueue();
      return;
    }

    if (
      ev.type === 'mouse-down' ||
      ev.type === 'mouse-up' ||
      ev.type === 'mouse-click' ||
      ev.type === 'mouse-dblclick'
    ) {
      pendingMoveEvent = null;
    }

    if (helperActionQueue.length < 40) {
      helperActionQueue.push(ev);
    }
    pumpLocalHelperQueue();
  }

  function pumpLocalHelperQueue() {
    if (helperRequestInFlight) return;

    let nextPayload = null;
    if (helperActionQueue.length > 0) {
      nextPayload = helperActionQueue.shift();
    } else if (pendingScrollDeltaY !== 0) {
      nextPayload = { type: 'mouse-scroll', deltaY: pendingScrollDeltaY };
      pendingScrollDeltaY = 0;
    } else if (pendingMoveEvent) {
      nextPayload = pendingMoveEvent;
      pendingMoveEvent = null;
    }

    if (!nextPayload) return;
    helperRequestInFlight = true;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);

    fetch('http://127.0.0.1:3847/input', {
      method: 'POST',
      body: JSON.stringify(nextPayload),
      signal: ctrl.signal
    })
      .then((res) => {
        if (res && res.ok) {
          helperFailStreak = 0;
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        helperRequestInFlight = false;
        if (helperActionQueue.length > 0 || pendingScrollDeltaY !== 0 || pendingMoveEvent) {
          pumpLocalHelperQueue();
        }
      });
  }

  function updateMissingHelperWarningVisibility() {
    if (!activeMissingHelperBtn) return;
    if (!helperExeActive && sessionState.allowControl) {
      activeMissingHelperBtn.classList.remove('hidden');
    } else {
      activeMissingHelperBtn.classList.add('hidden');
    }
  }

  async function checkLocalHelperExe() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch('http://127.0.0.1:3847/status', { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (data && data.ok) {
        helperFailStreak = 0;
        const canControl = data.allowControl !== false;
        const changed = helperExeActive !== canControl;
        helperExeActive = canControl;

        if (canControl) {
          if (step1Card) step1Card.classList.add('done');
          partnerHelperDot.className = 'dot online';
          partnerHelperBadge.textContent = '✅ Connected';
          partnerHelperBadge.className = 'badge badge-shield';
          partnerHelperTitle.textContent = 'Step 1 Complete: Prashnaa Helper Running!';
          partnerHelperDesc.textContent = 'Awesome! Now click the green Step 2 button below to share your Entire Screen.';
          if (partnerDownloadBtn) partnerDownloadBtn.classList.add('hidden');
        } else {
          if (step1Card) step1Card.classList.remove('done');
          partnerHelperDot.className = 'dot warning';
          partnerHelperBadge.textContent = 'Paused in Helper';
          partnerHelperBadge.className = 'badge badge-control';
          partnerHelperTitle.textContent = 'Prashnaa Helper is Paused';
          partnerHelperDesc.textContent = 'Check the "Allow Partner Full Mouse & Keyboard Control" box inside the Prashnaa Helper window.';
        }

        updateMissingHelperWarningVisibility();

        if (changed) {
          notifyControllerPermissions();
          if (sessionState.connected) {
            activePartnerStatus.textContent = helperExeActive
              ? 'Full Control Active! Your partner can move your mouse and open files.'
              : 'View-Only Mode: Enable control in Prashnaa Helper for mouse & file access.';
          }
        }
        return;
      }
    } catch {}

    helperFailStreak++;
    if (helperExeActive && helperFailStreak < 3) {
      return;
    }

    const changed = helperExeActive;
    helperExeActive = false;
    if (step1Card) step1Card.classList.remove('done');
    partnerHelperDot.className = 'dot';
    partnerHelperBadge.textContent = 'Required for Full Control';
    partnerHelperBadge.className = 'badge badge-control';
    if (partnerDownloadBtn) partnerDownloadBtn.classList.remove('hidden');
    updateMissingHelperWarningVisibility();
    if (changed) notifyControllerPermissions();
  }

  function notifyControllerPermissions() {
    if (activeDataConn && activeDataConn.open) {
      try {
        activeDataConn.send({
          type: 'permissions-updated',
          allowControl: sessionState.allowControl,
          helperRunning: helperExeActive
        });
      } catch {}
    }
  }

  setInterval(checkLocalHelperExe, 1800);
  checkLocalHelperExe();

  function showStep(stepEl) {
    stepReady.classList.add('hidden');
    stepApprove.classList.add('hidden');
    stepActive.classList.add('hidden');
    stepEl.classList.remove('hidden');
  }

  function cancelPendingReconnectConn() {
    if (pendingReconnectConn) {
      pendingReconnectConn._replaced = true;
      try { pendingReconnectConn.close(); } catch {}
      pendingReconnectConn = null;
      pendingReconnectStartedAt = 0;
    }
  }

  function initPeer() {
    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch {}
    }
    peer = new Peer(PEER_PREFIX_HOST + sessionState.sessionId, PEER_CONFIG);

    peer.on('open', () => {
      if (partnerConnBadge) {
        partnerConnBadge.textContent = '🔒 Cloud P2P Ready';
        partnerConnBadge.className = 'badge badge-shield';
      }
      if (inviteRoomCode) {
        simpleCodeDisplay.textContent = `1-Click Invite Linked (Room ${inviteRoomCode.slice(0, 3)}-${inviteRoomCode.slice(3)})`;
      } else {
        simpleCodeDisplay.innerHTML = `Or give your partner this Code: <strong style="color:#60a5fa;">${sessionState.sessionId.slice(0, 3)}-${sessionState.sessionId.slice(3)}</strong> &amp; PIN: <strong style="color:#34d399;">${sessionState.pin}</strong>`;
      }
    });

    peer.on('disconnected', () => {
      if (peer.destroyed) return;
      if (partnerConnBadge) {
        partnerConnBadge.textContent = '🔄 Reconnecting Cloud...';
        partnerConnBadge.className = 'badge badge-control';
      }
      setTimeout(() => {
        try {
          if (!peer.destroyed && peer.disconnected) peer.reconnect();
        } catch {}
      }, 1000);
    });

    peer.on('error', () => {
      if (peer && !peer.destroyed && peer.disconnected) {
        setTimeout(() => {
          try { peer.reconnect(); } catch {}
        }, 1500);
      }
    });

    peer.on('connection', (conn) => {
      // Cancel any outgoing reconnect attempt so we don't collide with Controller's incoming connection
      cancelPendingReconnectConn();
      if (partnerReconnectTimer) {
        clearTimeout(partnerReconnectTimer);
        partnerReconnectTimer = null;
      }

      conn._partnerDataBound = true;
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        sessionState.lastRemoteActivityAt = Date.now();

        if (msg.type === 'join-request') {
          const isValidPin = String(msg.pin || '').trim() === sessionState.pin;
          const isSameControllerReconnect =
            Boolean(msg.isReconnect) &&
            sessionState.lastControllerPeerId &&
            conn.peer === sessionState.lastControllerPeerId;

          if (!isValidPin && !isSameControllerReconnect) {
            conn.send({ type: 'request-declined', reason: 'Invalid 4-digit PIN.' });
            setTimeout(() => conn.close(), 400);
            return;
          }

          if (localStream && localStream.active) {
            sessionState.helperName = msg.controllerName || sessionState.helperName || 'Your Partner';
            attachPartnerActiveConnection(conn, 'request-approved');
            return;
          }

          pendingDataConn = conn;
          sessionState.helperName = msg.controllerName || 'Your Partner';
          simpleHelperName.textContent = sessionState.helperName;
          showStep(stepApprove);
        } else if (conn === activeDataConn) {
          handleIncomingData(msg);
        }
      });
    });
  }

  initPeer();

  // Periodic watchdog to keep signaling alive and detect silent peer drops
  setInterval(() => {
    if (!peer || peer.destroyed) {
      initPeer();
    } else if (peer.disconnected) {
      try { peer.reconnect(); } catch {}
    }

    if (
      sessionState.connected &&
      !explicitlyStopped &&
      localStream &&
      localStream.active &&
      sessionState.lastRemoteActivityAt > 0 &&
      Date.now() - sessionState.lastRemoteActivityAt > 16000
    ) {
      sessionState.lastRemoteActivityAt = Date.now();
      handleUnexpectedPartnerDisconnect();
    }
  }, 3500);

  async function captureScreen() {
    if (localStream && localStream.active) return localStream;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          cursor: 'always',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      localStream = stream;
      simplePreviewVideo.srcObject = stream;
      acquireTabKeepAwake();

      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        if (settings.displaySurface && settings.displaySurface !== 'monitor') {
          notEntireScreenWarningBtn.classList.remove('hidden');
        } else {
          notEntireScreenWarningBtn.classList.add('hidden');
        }
        track.onended = () => stopSession(true);
      }
      return stream;
    } catch {
      return null;
    }
  }

  function startMediaCallToController(targetPeerId) {
    if (!localStream || !localStream.active || !peer || !targetPeerId) return;
    if (activeMediaCall) {
      activeMediaCall._replaced = true;
      try { activeMediaCall.close(); } catch {}
    }
    const call = peer.call(targetPeerId, localStream);
    activeMediaCall = call;

    if (call) {
      setTimeout(() => {
        const pc = call.peerConnection;
        if (!pc) return;
        let iceTimer = null;
        pc.addEventListener('iceconnectionstatechange', () => {
          if (call._replaced || explicitlyStopped || !localStream || !localStream.active) return;
          const st = pc.iceConnectionState;
          if (st === 'connected' || st === 'completed') {
            if (iceTimer) {
              clearTimeout(iceTimer);
              iceTimer = null;
            }
          } else if (st === 'failed') {
            if (activeDataConn && activeDataConn.open) {
              startMediaCallToController(activeDataConn.peer);
            }
          } else if (st === 'disconnected') {
            if (!iceTimer) {
              iceTimer = setTimeout(() => {
                if (!call._replaced && !explicitlyStopped && pc.iceConnectionState === 'disconnected' && activeDataConn && activeDataConn.open) {
                  startMediaCallToController(activeDataConn.peer);
                }
              }, 4000);
            }
          }
        });
      }, 50);
    }
  }

  if (notEntireScreenWarningBtn) {
    notEntireScreenWarningBtn.addEventListener('click', async () => {
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }
      const stream = await captureScreen();
      if (stream && activeDataConn) {
        startMediaCallToController(activeDataConn.peer);
      }
    });
  }

  if (partnerResyncBtn) {
    partnerResyncBtn.addEventListener('click', () => {
      if (activeDataConn && activeDataConn.peer) {
        startMediaCallToController(activeDataConn.peer);
      } else {
        handleUnexpectedPartnerDisconnect();
      }
    });
  }

  function handleIncomingData(msg) {
    sessionState.lastRemoteActivityAt = Date.now();

    if (msg.type === 'ping') {
      if (activeDataConn && activeDataConn.open) {
        try { activeDataConn.send({ type: 'pong', ts: msg.ts }); } catch {}
      }
      return;
    }
    if (msg.type === 'request-stream-refresh') {
      if (activeDataConn && activeDataConn.peer) {
        startMediaCallToController(activeDataConn.peer);
      }
      return;
    }
    if (msg.type === 'control-input' && msg.event) {
      const ev = msg.event;
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        simpleRemoteCursor.classList.remove('hidden');
        simpleCursorTag.textContent = sessionState.helperName;
        simpleRemoteCursor.style.left = `${ev.x * 100}%`;
        simpleRemoteCursor.style.top = `${ev.y * 100}%`;
      }
      sendToLocalHelper(ev);
    } else if (msg.type === 'chat') {
      appendPartnerChat({ senderName: msg.senderName || 'Partner', text: msg.text, self: false });
    } else if (msg.type === 'end-session') {
      stopSession(true);
    }
  }

  function setActiveConnectedUI() {
    cancelPendingReconnectConn();
    if (partnerReconnectTimer) {
      clearTimeout(partnerReconnectTimer);
      partnerReconnectTimer = null;
    }
    if (activeStatusIcon) activeStatusIcon.textContent = '🟢';
    if (activeStatusHeading) activeStatusHeading.textContent = 'Connected with Partner';
    activePartnerStatus.textContent = helperExeActive
      ? 'Full Control Active! Your partner can move your mouse and open files.'
      : 'Screen shared! Open "RemoteAssist-Helper.exe" below to enable full mouse control.';
    updateMissingHelperWarningVisibility();
    showStep(stepActive);
  }

  function attachPartnerActiveConnection(conn, readyMessageType) {
    if (!conn) return;
    if (activeDataConn && activeDataConn !== conn) {
      activeDataConn._replaced = true;
      try { activeDataConn.close(); } catch {}
    }

    explicitlyStopped = false;
    activeDataConn = conn;
    sessionState.connected = true;
    sessionState.lastControllerPeerId = conn.peer;
    sessionState.lastRemoteActivityAt = Date.now();

    const onOpenSendAndCall = () => {
      if (conn._replaced || explicitlyStopped) return;
      sessionState.lastRemoteActivityAt = Date.now();
      setActiveConnectedUI();
      try {
        conn.send({
          type: readyMessageType || 'partner-invite-ready',
          hostName: 'Partner Laptop',
          allowControl: sessionState.allowControl,
          helperRunning: helperExeActive
        });
      } catch {}

      startMediaCallToController(conn.peer);
    };

    if (conn.open) {
      onOpenSendAndCall();
    } else {
      conn.on('open', onOpenSendAndCall);
    }

    // Bind data listener ONLY if not already bound in peer.on('connection')
    if (!conn._partnerDataBound) {
      conn._partnerDataBound = true;
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (conn === activeDataConn) {
          handleIncomingData(msg);
        }
      });
    }

    if (!conn._partnerCloseBound) {
      conn._partnerCloseBound = true;
      conn.on('close', () => {
        if (conn._replaced || explicitlyStopped) return;
        handleUnexpectedPartnerDisconnect();
      });

      conn.on('error', () => {
        if (conn._replaced || explicitlyStopped) return;
        handleUnexpectedPartnerDisconnect();
      });
    }
  }

  function handleUnexpectedPartnerDisconnect() {
    if (explicitlyStopped || !localStream || !localStream.active) {
      stopSession(true);
      return;
    }

    if (activeStatusIcon) activeStatusIcon.textContent = '🔄';
    if (activeStatusHeading) activeStatusHeading.textContent = 'Reconnecting to Partner...';
    activePartnerStatus.textContent = 'Brief network interruption — automatically reconnecting your screen stream...';

    // Wait 3.8s so Controller's fast reconnect attempt (0.7s) arrives first without glare
    schedulePartnerAutoReconnect(3800);
  }

  function schedulePartnerAutoReconnect(delayMs) {
    if (partnerReconnectTimer) clearTimeout(partnerReconnectTimer);
    partnerReconnectTimer = setTimeout(() => {
      if (explicitlyStopped || !localStream || !localStream.active) return;
      if (activeDataConn && activeDataConn.open && Date.now() - sessionState.lastRemoteActivityAt < 10000) return;

      if (peer && peer.disconnected && !peer.destroyed) {
        try { peer.reconnect(); } catch {}
      }

      if (
        pendingReconnectConn &&
        !pendingReconnectConn.open &&
        Date.now() - pendingReconnectStartedAt < 5500
      ) {
        schedulePartnerAutoReconnect(2500);
        return;
      }

      cancelPendingReconnectConn();

      if (sessionState.lastControllerPeerId && peer && !peer.destroyed && !peer.disconnected) {
        try {
          const conn = peer.connect(sessionState.lastControllerPeerId, { reliable: true });
          pendingReconnectConn = conn;
          pendingReconnectStartedAt = Date.now();

          conn.on('open', () => {
            if (conn._replaced || explicitlyStopped) return;
            pendingReconnectConn = null;
            attachPartnerActiveConnection(conn, 'partner-invite-ready');
          });

          conn.on('error', () => {
            if (pendingReconnectConn === conn) {
              pendingReconnectConn = null;
            }
          });
        } catch {}
      }

      schedulePartnerAutoReconnect(4200);
    }, delayMs);
  }

  startSimpleShareBtn.addEventListener('click', async () => {
    explicitlyStopped = false;
    sessionState.allowControl = simpleAllowControl.checked;
    activeControlSwitch.checked = sessionState.allowControl;

    const stream = await captureScreen();
    if (!stream) return;

    if (inviteRoomCode) {
      const targetPeerId = PEER_PREFIX_CTRL + inviteRoomCode.replace(/\D/g, '');
      sessionState.lastControllerPeerId = targetPeerId;
      showStep(stepActive);

      if (peer && !peer.destroyed && !peer.disconnected && peer.open) {
        const conn = peer.connect(targetPeerId, { reliable: true });
        attachPartnerActiveConnection(conn, 'partner-invite-ready');
        // Fallback if initial connection doesn't open within 5s
        setTimeout(() => {
          if (!explicitlyStopped && (!activeDataConn || !activeDataConn.open)) {
            handleUnexpectedPartnerDisconnect();
          }
        }, 5000);
      } else {
        handleUnexpectedPartnerDisconnect();
      }
    } else {
      activePartnerStatus.innerHTML = `Share Code <strong style="color:#60a5fa;">${sessionState.sessionId.slice(0, 3)}-${sessionState.sessionId.slice(3)}</strong> and PIN <strong style="color:#34d399;">${sessionState.pin}</strong> with your partner.`;
      showStep(stepActive);
    }
  });

  confirmApproveBtn.addEventListener('click', async () => {
    if (!pendingDataConn) return;
    const conn = pendingDataConn;
    pendingDataConn = null;

    const stream = await captureScreen();
    if (!stream) {
      conn.send({ type: 'request-declined', reason: 'Screen share cancelled.' });
      showStep(stepReady);
      return;
    }

    sessionState.allowControl = activeControlSwitch.checked;
    attachPartnerActiveConnection(conn, 'request-approved');
  });

  confirmDeclineBtn.addEventListener('click', () => {
    if (pendingDataConn) {
      pendingDataConn.send({ type: 'request-declined', reason: 'Partner declined.' });
      pendingDataConn.close();
      pendingDataConn = null;
    }
    showStep(stepReady);
  });

  activeControlSwitch.addEventListener('change', () => {
    sessionState.allowControl = activeControlSwitch.checked;
    updateMissingHelperWarningVisibility();
    notifyControllerPermissions();
  });

  function stopSession(isExplicit = true) {
    explicitlyStopped = Boolean(isExplicit);
    sessionState.connected = false;
    cancelPendingReconnectConn();
    releaseTabKeepAwake();

    if (partnerReconnectTimer) {
      clearTimeout(partnerReconnectTimer);
      partnerReconnectTimer = null;
    }

    if (activeDataConn) {
      activeDataConn._replaced = true;
      if (activeDataConn.open) {
        try {
          activeDataConn.send({ type: 'end-session' });
          activeDataConn.close();
        } catch {}
      }
      activeDataConn = null;
    }

    if (activeMediaCall) {
      activeMediaCall._replaced = true;
      try {
        activeMediaCall.close();
      } catch {}
      activeMediaCall = null;
    }

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }

    showStep(stepReady);
  }

  stopSimpleShareBtn.addEventListener('click', () => stopSession(true));
})();
