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

  let sessionState = {
    sessionId: getSavedOrCreateDigits('prashnaa_partner_id', 6),
    pin: getSavedOrCreateDigits('prashnaa_partner_pin', 4),
    allowControl: true,
    connected: false,
    helperName: 'Your Partner',
    lastControllerPeerId: inviteRoomCode ? PEER_PREFIX_CTRL + inviteRoomCode.replace(/\D/g, '') : null
  };

  let peer = null;
  let activeDataConn = null;
  let pendingDataConn = null;
  let activeMediaCall = null;
  let localStream = null;

  let helperExeActive = false;
  let helperFailStreak = 0;
  let explicitlyStopped = false;
  let partnerReconnectTimer = null;

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

  // ==================== COALESCED LOCAL HELPER BRIDGE (127.0.0.1:3847) ====================
  let moveInFlight = false;
  let pendingMoveEvent = null;

  function sendToLocalHelper(ev) {
    if (!sessionState.allowControl || !helperExeActive) return;

    if (ev.type === 'pointer-move') {
      pendingMoveEvent = ev;
      if (!moveInFlight) {
        flushPendingMove();
      }
      return;
    }

    pendingMoveEvent = null;
    fetch('http://127.0.0.1:3847/input', {
      method: 'POST',
      body: JSON.stringify(ev),
      keepalive: true
    }).catch(() => {});
  }

  function flushPendingMove() {
    if (!pendingMoveEvent) {
      moveInFlight = false;
      return;
    }
    const ev = pendingMoveEvent;
    pendingMoveEvent = null;
    moveInFlight = true;

    fetch('http://127.0.0.1:3847/input', {
      method: 'POST',
      body: JSON.stringify(ev)
    })
      .catch(() => {})
      .finally(() => {
        if (pendingMoveEvent) {
          flushPendingMove();
        } else {
          moveInFlight = false;
        }
      });
  }

  async function checkLocalHelperExe() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1400);
      const res = await fetch('http://127.0.0.1:3847/status', { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (data && data.ok) {
        helperFailStreak = 0;
        const changed = !helperExeActive;
        helperExeActive = true;
        if (step1Card) step1Card.classList.add('done');
        partnerHelperDot.className = 'dot online';
        partnerHelperBadge.textContent = '✅ Connected';
        partnerHelperBadge.className = 'badge badge-shield';
        partnerHelperTitle.textContent = 'Step 1 Complete: Prashnaa Helper Running!';
        partnerHelperDesc.textContent = 'Awesome! Now click the green Step 2 button below to share your Entire Screen.';
        if (partnerDownloadBtn) partnerDownloadBtn.classList.add('hidden');
        if (activeMissingHelperBtn) activeMissingHelperBtn.classList.add('hidden');
        if (changed) {
          notifyControllerPermissions();
          if (sessionState.connected) {
            activePartnerStatus.textContent = 'Full Control Active! Your partner can move your mouse and open files.';
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
    if (activeMissingHelperBtn) activeMissingHelperBtn.classList.remove('hidden');
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

  function initPeer() {
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
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
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

          // If we already have an active screen share stream (e.g. reconnecting mid-session or already started),
          // connect immediately without making the non-IT partner click Approve again!
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

  if (notEntireScreenWarningBtn) {
    notEntireScreenWarningBtn.addEventListener('click', async () => {
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }
      const stream = await captureScreen();
      if (stream && activeDataConn && peer) {
        if (activeMediaCall) {
          activeMediaCall._replaced = true;
          try { activeMediaCall.close(); } catch {}
        }
        activeMediaCall = peer.call(activeDataConn.peer, stream);
      }
    });
  }

  function handleIncomingData(msg) {
    if (msg.type === 'ping') {
      if (activeDataConn && activeDataConn.open) {
        try { activeDataConn.send({ type: 'pong', ts: msg.ts }); } catch {}
      }
      return;
    }
    if (msg.type === 'request-stream-refresh') {
      if (localStream && localStream.active && peer && activeDataConn) {
        if (activeMediaCall) {
          activeMediaCall._replaced = true;
          try { activeMediaCall.close(); } catch {}
        }
        activeMediaCall = peer.call(activeDataConn.peer, localStream);
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
    if (partnerReconnectTimer) {
      clearTimeout(partnerReconnectTimer);
      partnerReconnectTimer = null;
    }
    if (activeStatusIcon) activeStatusIcon.textContent = '🟢';
    if (activeStatusHeading) activeStatusHeading.textContent = 'Connected with Partner';
    activePartnerStatus.textContent = helperExeActive
      ? 'Full Control Active! Your partner can move your mouse and open files.'
      : 'Screen shared! Open "RemoteAssist-Helper.exe" below to enable full mouse control.';
    showStep(stepActive);
  }

  function attachPartnerActiveConnection(conn, readyMessageType) {
    if (activeDataConn && activeDataConn !== conn) {
      activeDataConn._replaced = true;
      try { activeDataConn.close(); } catch {}
    }

    explicitlyStopped = false;
    activeDataConn = conn;
    sessionState.connected = true;
    sessionState.lastControllerPeerId = conn.peer;

    const onOpenSendAndCall = () => {
      setActiveConnectedUI();
      try {
        conn.send({
          type: readyMessageType || 'partner-invite-ready',
          hostName: 'Partner Laptop',
          allowControl: sessionState.allowControl,
          helperRunning: helperExeActive
        });
      } catch {}

      if (localStream && localStream.active && peer) {
        if (activeMediaCall) {
          activeMediaCall._replaced = true;
          try { activeMediaCall.close(); } catch {}
        }
        activeMediaCall = peer.call(conn.peer, localStream);
      }
    };

    if (conn.open) {
      onOpenSendAndCall();
    } else {
      conn.on('open', onOpenSendAndCall);
    }

    conn.on('data', handleIncomingData);

    conn.on('close', () => {
      if (conn._replaced || explicitlyStopped) return;
      handleUnexpectedPartnerDisconnect();
    });

    conn.on('error', () => {
      if (conn._replaced || explicitlyStopped) return;
      handleUnexpectedPartnerDisconnect();
    });
  }

  function handleUnexpectedPartnerDisconnect() {
    if (explicitlyStopped || !localStream || !localStream.active) {
      stopSession(true);
      return;
    }

    // Keep localStream alive and auto-reconnect in the background!
    if (activeStatusIcon) activeStatusIcon.textContent = '🔄';
    if (activeStatusHeading) activeStatusHeading.textContent = 'Reconnecting to Partner...';
    activePartnerStatus.textContent = 'Brief network interruption — automatically reconnecting your screen stream...';

    schedulePartnerAutoReconnect(1500);
  }

  function schedulePartnerAutoReconnect(delayMs) {
    if (partnerReconnectTimer) clearTimeout(partnerReconnectTimer);
    partnerReconnectTimer = setTimeout(() => {
      if (explicitlyStopped || !localStream || !localStream.active) return;
      if (activeDataConn && activeDataConn.open) return;

      if (peer && peer.disconnected && !peer.destroyed) {
        try { peer.reconnect(); } catch {}
      }

      if (sessionState.lastControllerPeerId && peer && !peer.destroyed && !peer.disconnected) {
        try {
          const conn = peer.connect(sessionState.lastControllerPeerId, { reliable: true });
          attachPartnerActiveConnection(conn, 'partner-invite-ready');
        } catch {}
      }

      schedulePartnerAutoReconnect(2800);
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
      const conn = peer.connect(targetPeerId, { reliable: true });
      attachPartnerActiveConnection(conn, 'partner-invite-ready');
      showStep(stepActive);
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
    notifyControllerPermissions();
  });

  function stopSession(isExplicit = true) {
    explicitlyStopped = Boolean(isExplicit);
    sessionState.connected = false;

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
