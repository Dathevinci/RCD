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

  let currentMode = 'controller';
  let hostSession = {
    sessionId: getSavedOrCreateDigits('prashnaa_host_id', 6),
    pin: getSavedOrCreateDigits('prashnaa_host_pin', 4),
    allowControl: true,
    connected: false,
    partnerName: 'Partner',
    approvedControllerPeerId: null
  };

  let controllerInviteCode = getSavedOrCreateDigits('prashnaa_ctrl_invite', 6);
  let controllerState = {
    connected: false,
    reconnecting: false,
    allowControl: false,
    helperRunning: false,
    hostName: 'Partner Laptop',
    lastRemotePeerId: null,
    lastSessionId: '',
    lastPin: '',
    lastX: 0.5,
    lastY: 0.5,
    lastPongAt: 0,
    latencyMs: null
  };

  let hostPeer = null;
  let ctrlPeer = null;
  let activeDataConn = null;
  let activeMediaCall = null;
  let pendingDataConn = null;
  let pendingReconnectConn = null;
  let pendingReconnectStartedAt = 0;
  let localDisplayStream = null;

  let helperExeActive = false;
  let helperFailStreak = 0;

  let reconnectTimer = null;
  let hostReconnectTimer = null;
  let heartbeatInterval = null;
  let explicitlyEnded = false;
  let chatCollapsed = false;
  let unreadChatCount = 0;

  // Background tab anti-throttling resources (when browser is minimized via Win+D)
  let wakeLockSentinel = null;
  let keepAwakeAudioCtx = null;
  let keepAwakeLockRelease = null;

  // DOM Elements
  const workspaceMain = document.getElementById('workspaceMain');
  const tabHost = document.getElementById('tabHost');
  const tabController = document.getElementById('tabController');
  const hostView = document.getElementById('hostView');
  const controllerView = document.getElementById('controllerView');
  const serverDot = document.getElementById('serverDot');
  const serverStatusText = document.getElementById('serverStatusText');
  const toggleChatTopBtn = document.getElementById('toggleChatTopBtn');
  const toolbarChatBtn = document.getElementById('toolbarChatBtn');
  const closeChatBtn = document.getElementById('closeChatBtn');
  const chatUnreadBadge = document.getElementById('chatUnreadBadge');

  // Host DOM
  const hostSessionIdEl = document.getElementById('hostSessionId');
  const hostPinEl = document.getElementById('hostPin');
  const copySessionBtn = document.getElementById('copySessionBtn');
  const rotatePinBtn = document.getElementById('rotatePinBtn');
  const allowControlToggle = document.getElementById('allowControlToggle');
  const agentDot = document.getElementById('agentDot');
  const agentStatusTitle = document.getElementById('agentStatusTitle');
  const agentStatusDesc = document.getElementById('agentStatusDesc');
  const hostActiveBanner = document.getElementById('hostActiveBanner');
  const connectedControllerLabel = document.getElementById('connectedControllerLabel');
  const connectedModeLabel = document.getElementById('connectedModeLabel');
  const hostDisconnectBtn = document.getElementById('hostDisconnectBtn');
  const changeScreenBtn = document.getElementById('changeScreenBtn');
  const hostPreviewVideo = document.getElementById('hostPreviewVideo');
  const hostVideoStage = document.getElementById('hostVideoStage');
  const hostRemoteCursor = document.getElementById('hostRemoteCursor');
  const hostCursorTag = document.getElementById('hostCursorTag');
  const hostStagePlaceholder = document.getElementById('hostStagePlaceholder');
  const auditLogList = document.getElementById('auditLogList');
  const clearLogBtn = document.getElementById('clearLogBtn');

  // Modal DOM
  const consentModal = document.getElementById('consentModal');
  const requesterNameLabel = document.getElementById('requesterNameLabel');
  const requestedAccessLabel = document.getElementById('requestedAccessLabel');
  const approveFullBtn = document.getElementById('approveFullBtn');
  const approveViewOnlyBtn = document.getElementById('approveViewOnlyBtn');
  const declineRequestBtn = document.getElementById('declineRequestBtn');

  // Controller DOM
  const controllerConnectCard = document.getElementById('controllerConnectCard');
  const partnerInviteLinkInput = document.getElementById('partnerInviteLinkInput');
  const copyInviteLinkBtn = document.getElementById('copyInviteLinkBtn');
  const newInviteLinkBtn = document.getElementById('newInviteLinkBtn');
  const inviteWaitStatus = document.getElementById('inviteWaitStatus');
  const joinSessionForm = document.getElementById('joinSessionForm');
  const remoteSessionIdInput = document.getElementById('remoteSessionIdInput');
  const remotePinInput = document.getElementById('remotePinInput');
  const controllerNameInput = document.getElementById('controllerNameInput');
  const requestControlCheckbox = document.getElementById('requestControlCheckbox');
  const controllerErrorBox = document.getElementById('controllerErrorBox');
  const waitingApprovalBanner = document.getElementById('waitingApprovalBanner');
  const requestJoinBtn = document.getElementById('requestJoinBtn');

  const remoteDesktopShell = document.getElementById('remoteDesktopShell');
  const connectionPulseDot = document.getElementById('connectionPulseDot');
  const remoteHostTitle = document.getElementById('remoteHostTitle');
  const latencyBadge = document.getElementById('latencyBadge');
  const controllerPermissionBadge = document.getElementById('controllerPermissionBadge');
  const showDesktopBtn = document.getElementById('showDesktopBtn');
  const openExplorerBtn = document.getElementById('openExplorerBtn');
  const startMenuBtn = document.getElementById('startMenuBtn');
  const singleClickDblToggle = document.getElementById('singleClickDblToggle');
  const sendEnterBtn = document.getElementById('sendEnterBtn');
  const sendRightClickBtn = document.getElementById('sendRightClickBtn');
  const sendCopyBtn = document.getElementById('sendCopyBtn');
  const sendPasteBtn = document.getElementById('sendPasteBtn');
  const captureKeyboardToggle = document.getElementById('captureKeyboardToggle');
  const refreshStreamBtn = document.getElementById('refreshStreamBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const controllerDisconnectBtn = document.getElementById('controllerDisconnectBtn');
  const quickTypeForm = document.getElementById('quickTypeForm');
  const quickTypeInput = document.getElementById('quickTypeInput');
  const sendBackspaceBtn = document.getElementById('sendBackspaceBtn');
  const sendEscBtn = document.getElementById('sendEscBtn');
  const remoteScreenWrapper = document.getElementById('remoteScreenWrapper');
  const remoteScreenVideo = document.getElementById('remoteScreenVideo');
  const remoteLaserLayer = document.getElementById('remoteLaserLayer');
  const remoteVideoPlaceholder = document.getElementById('remoteVideoPlaceholder');
  const reconnectBanner = document.getElementById('reconnectBanner');
  const reconnectStatusText = document.getElementById('reconnectStatusText');
  const reconnectNowBtn = document.getElementById('reconnectNowBtn');

  // Chat DOM
  const chatMessages = document.getElementById('chatMessages');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  function formatCode(id) {
    if (!id || id.length !== 6) return id || '--- ---';
    return `${id.slice(0, 3)}-${id.slice(3)}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function addAuditLog(message) {
    if (!auditLogList) return;
    const li = document.createElement('li');
    const time = new Date().toLocaleTimeString();
    li.innerHTML = `<span class="audit-time">[${time}]</span> ${escapeHtml(message)}`;
    auditLogList.prepend(li);
  }

  // ==================== BACKGROUND TAB ANTI-THROTTLING ====================
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
        navigator.locks.request('prashnaa_active_session', () => {
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

  // ==================== COLLAPSIBLE CHAT SIDEBAR ====================
  function setChatCollapsed(collapsed) {
    chatCollapsed = Boolean(collapsed);
    if (workspaceMain) {
      workspaceMain.classList.toggle('chat-collapsed', chatCollapsed);
    }
    if (!chatCollapsed) {
      unreadChatCount = 0;
      if (chatUnreadBadge) chatUnreadBadge.classList.add('hidden');
      if (toolbarChatBtn) toolbarChatBtn.textContent = '💬 Chat';
    }
  }

  if (toggleChatTopBtn) {
    toggleChatTopBtn.addEventListener('click', () => setChatCollapsed(!chatCollapsed));
  }
  if (toolbarChatBtn) {
    toolbarChatBtn.addEventListener('click', () => setChatCollapsed(!chatCollapsed));
  }
  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', () => setChatCollapsed(true));
  }

  function appendChatMessage({ senderName, text, self }) {
    const empty = chatMessages.querySelector('.chat-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `chat-bubble ${self ? 'self' : ''}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="chat-meta">
        <strong>${escapeHtml(senderName || 'Partner')}</strong>
        <span>${time}</span>
      </div>
      <div>${escapeHtml(text)}</div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (!self && chatCollapsed) {
      unreadChatCount++;
      if (chatUnreadBadge) {
        chatUnreadBadge.textContent = String(unreadChatCount);
        chatUnreadBadge.classList.remove('hidden');
      }
      if (toolbarChatBtn) {
        toolbarChatBtn.textContent = `💬 Chat (${unreadChatCount})`;
      }
    }
  }

  function switchMode(mode) {
    currentMode = mode;
    tabController.classList.toggle('active', mode === 'controller');
    tabHost.classList.toggle('active', mode === 'host');
    controllerView.classList.toggle('active', mode === 'controller');
    hostView.classList.toggle('active', mode === 'host');
  }

  tabController.addEventListener('click', () => switchMode('controller'));
  tabHost.addEventListener('click', () => switchMode('host'));

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mode') === 'host') {
    switchMode('host');
  }

  if (remoteSessionIdInput) {
    remoteSessionIdInput.addEventListener('input', () => {
      const digits = remoteSessionIdInput.value.replace(/\D/g, '').slice(0, 6);
      if (digits.length > 3) {
        remoteSessionIdInput.value = `${digits.slice(0, 3)}-${digits.slice(3)}`;
      } else {
        remoteSessionIdInput.value = digits;
      }
    });
  }

  // ==================== UNIFIED SINGLE-FLIGHT LOCAL HELPER BRIDGE (127.0.0.1:3847) ====================
  let helperRequestInFlight = false;
  let pendingMoveEvent = null;
  let pendingScrollDeltaY = 0;
  const helperActionQueue = [];

  function sendToLocalHelper(ev) {
    if (!hostSession.allowControl || !helperExeActive || !ev) return;

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

  async function checkLocalHelperExe() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1600);
      const res = await fetch('http://127.0.0.1:3847/status', {
        method: 'GET',
        signal: ctrl.signal
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data && data.ok) {
        helperFailStreak = 0;
        const canControl = data.allowControl !== false;
        const prevActive = helperExeActive;
        helperExeActive = canControl;

        if (canControl) {
          agentDot.className = 'dot online';
          agentStatusTitle.textContent = `Prashnaa Mouse Helper: Active (${data.width}x${data.height})`;
          agentStatusDesc.textContent = 'Ready! Your partner can click, open files, drag & type when allowed.';
          if (!prevActive) {
            addAuditLog('Connected to Prashnaa Helper on 127.0.0.1:3847.');
          }
        } else {
          agentDot.className = 'dot warning';
          agentStatusTitle.textContent = 'Prashnaa Mouse Helper: Paused in Helper Window';
          agentStatusDesc.textContent = 'Check the "Allow Partner Full Mouse & Keyboard Control" box in the Prashnaa Helper window.';
        }

        if (prevActive !== helperExeActive) {
          notifyHostPermissionsToController();
        }
        return;
      }
    } catch {}

    helperFailStreak++;
    if (helperExeActive && helperFailStreak >= 3) {
      helperExeActive = false;
      agentDot.className = 'dot';
      agentStatusTitle.textContent = 'Prashnaa Mouse Helper: Not Opened';
      notifyHostPermissionsToController();
    } else if (!helperExeActive) {
      agentStatusTitle.textContent = 'Prashnaa Mouse Helper: Not Opened (View-Only)';
    }
  }

  function notifyHostPermissionsToController() {
    if (currentMode === 'host' && activeDataConn && activeDataConn.open) {
      try {
        activeDataConn.send({
          type: 'permissions-updated',
          allowControl: hostSession.allowControl,
          helperRunning: helperExeActive
        });
      } catch {}
    }
  }

  setInterval(checkLocalHelperExe, 2500);
  checkLocalHelperExe();

  // ==================== INITIALIZE SERVERLESS PEERJS ====================
  function getBaseFolderUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    const path = url.pathname.endsWith('.html')
      ? url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1)
      : url.pathname.endsWith('/')
      ? url.pathname
      : url.pathname + '/';
    return `${url.origin}${path}`;
  }

  function attachPeerKeepAlive(peerInstance) {
    peerInstance.on('disconnected', () => {
      if (peerInstance.destroyed) return;
      serverDot.className = 'dot warning';
      serverStatusText.textContent = 'Reconnecting Signaling...';
      setTimeout(() => {
        try {
          if (!peerInstance.destroyed && peerInstance.disconnected) {
            peerInstance.reconnect();
          }
        } catch {}
      }, 1000);
    });

    peerInstance.on('open', () => {
      serverDot.className = 'dot online';
      serverStatusText.textContent = 'Cloud P2P Ready';
    });

    peerInstance.on('error', (err) => {
      if (err && err.type === 'peer-unavailable') {
        if (waitingApprovalBanner && !waitingApprovalBanner.classList.contains('hidden')) {
          requestJoinBtn.disabled = false;
          waitingApprovalBanner.classList.add('hidden');
          controllerErrorBox.textContent = 'Partner Session ID not found or offline. Check the 6-digit code.';
          controllerErrorBox.classList.remove('hidden');
        }
      }
      if (peerInstance && !peerInstance.destroyed && peerInstance.disconnected) {
        setTimeout(() => {
          try { peerInstance.reconnect(); } catch {}
        }, 1500);
      }
    });
  }

  // Periodic watchdog to ensure signaling connections never stay dead after transient drops
  setInterval(() => {
    if (!ctrlPeer || ctrlPeer.destroyed) {
      initControllerPeer();
    } else if (ctrlPeer.disconnected) {
      try { ctrlPeer.reconnect(); } catch {}
    }

    if (!hostPeer || hostPeer.destroyed) {
      initHostPeer();
    } else if (hostPeer.disconnected) {
      try { hostPeer.reconnect(); } catch {}
    }
  }, 4500);

  function updateInviteLinkDisplay() {
    const inviteUrl = `${getBaseFolderUrl()}partner.html?room=${controllerInviteCode}`;
    partnerInviteLinkInput.value = inviteUrl;
  }

  function cancelPendingReconnectConn() {
    if (pendingReconnectConn) {
      pendingReconnectConn._replaced = true;
      try { pendingReconnectConn.close(); } catch {}
      pendingReconnectConn = null;
      pendingReconnectStartedAt = 0;
    }
  }

  function initControllerPeer() {
    if (ctrlPeer && !ctrlPeer.destroyed) {
      try { ctrlPeer.destroy(); } catch {}
    }
    updateInviteLinkDisplay();
    ctrlPeer = new Peer(PEER_PREFIX_CTRL + controllerInviteCode, PEER_CONFIG);
    attachPeerKeepAlive(ctrlPeer);

    ctrlPeer.on('connection', (conn) => {
      // Incoming connection from Partner: cancel any outgoing reconnect attempt to prevent glare
      cancelPendingReconnectConn();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setupControllerDataConnection(conn);
    });

    ctrlPeer.on('call', (call) => {
      acceptIncomingMediaCall(call);
    });
  }

  function acceptIncomingMediaCall(call) {
    if (activeMediaCall && activeMediaCall !== call) {
      activeMediaCall._replaced = true;
      try { activeMediaCall.close(); } catch {}
    }
    activeMediaCall = call;
    call.answer();
    call.on('stream', (remoteStream) => {
      attachRemoteStreamToVideo(remoteStream);
    });
    call.on('close', () => {
      if (call._replaced) return;
      if (controllerState.connected && !explicitlyEnded) {
        requestStreamRefresh();
      }
    });
    call.on('error', () => {
      if (call._replaced) return;
      if (controllerState.connected && !explicitlyEnded) {
        requestStreamRefresh();
      }
    });

    // Monitor underlying RTCPeerConnection ICE health for video stream
    setTimeout(() => {
      const pc = call.peerConnection;
      if (!pc) return;
      let iceDisconnectTimer = null;
      pc.addEventListener('iceconnectionstatechange', () => {
        if (call._replaced || explicitlyEnded || !controllerState.connected) return;
        const state = pc.iceConnectionState;
        if (state === 'connected' || state === 'completed') {
          if (iceDisconnectTimer) {
            clearTimeout(iceDisconnectTimer);
            iceDisconnectTimer = null;
          }
        } else if (state === 'failed') {
          requestStreamRefresh();
        } else if (state === 'disconnected') {
          if (!iceDisconnectTimer) {
            iceDisconnectTimer = setTimeout(() => {
              if (!call._replaced && !explicitlyEnded && controllerState.connected && pc.iceConnectionState === 'disconnected') {
                requestStreamRefresh();
              }
            }, 3500);
          }
        }
      });
    }, 50);
  }

  function attachRemoteStreamToVideo(remoteStream) {
    if (!remoteStream) return;
    remoteScreenVideo.muted = true;
    remoteScreenVideo.srcObject = remoteStream;
    remoteScreenVideo.play().catch(() => {});
    remoteVideoPlaceholder.classList.add('hidden');
    hideReconnectBanner();
  }

  function initHostPeer() {
    if (hostPeer && !hostPeer.destroyed) {
      try { hostPeer.destroy(); } catch {}
    }
    hostSessionIdEl.textContent = formatCode(hostSession.sessionId);
    hostPinEl.textContent = hostSession.pin;

    hostPeer = new Peer(PEER_PREFIX_HOST + hostSession.sessionId, PEER_CONFIG);
    attachPeerKeepAlive(hostPeer);

    hostPeer.on('connection', (conn) => {
      if (hostReconnectTimer) {
        clearTimeout(hostReconnectTimer);
        hostReconnectTimer = null;
      }

      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'join-request') {
          const isValidPin = String(msg.pin || '').trim() === hostSession.pin;
          const isApprovedPeerReconnect =
            Boolean(msg.isReconnect) &&
            hostSession.approvedControllerPeerId &&
            conn.peer === hostSession.approvedControllerPeerId &&
            localDisplayStream &&
            localDisplayStream.active;

          if (!isValidPin && !isApprovedPeerReconnect) {
            conn.send({ type: 'request-declined', reason: 'Invalid 4-digit PIN.' });
            setTimeout(() => conn.close(), 400);
            return;
          }

          if ((isApprovedPeerReconnect || (isValidPin && hostSession.connected)) && localDisplayStream && localDisplayStream.active) {
            attachApprovedHostDataConn(conn, hostSession.allowControl);
            addAuditLog(`Auto-reconnected with "${hostSession.partnerName}".`);
            return;
          }

          pendingDataConn = conn;
          hostSession.partnerName = msg.controllerName || 'Partner';
          requesterNameLabel.textContent = hostSession.partnerName;
          requestedAccessLabel.textContent = msg.requestControl
            ? 'Screen View + Mouse & Keyboard Control'
            : 'View-Only Screen Assistance';
          consentModal.classList.remove('hidden');
          addAuditLog(`Incoming request from "${hostSession.partnerName}".`);
        } else if (conn === activeDataConn) {
          handleHostDataMessage(msg);
        }
      });
    });
  }

  initControllerPeer();
  initHostPeer();

  copyInviteLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(partnerInviteLinkInput.value);
    copyInviteLinkBtn.textContent = '✅ Link Copied!';
    setTimeout(() => {
      copyInviteLinkBtn.textContent = '📋 Copy Partner Link';
    }, 1800);
  });

  if (newInviteLinkBtn) {
    newInviteLinkBtn.addEventListener('click', () => {
      controllerInviteCode = randomDigits(6);
      try { sessionStorage.setItem('prashnaa_ctrl_invite', controllerInviteCode); } catch {}
      initControllerPeer();
      newInviteLinkBtn.textContent = '✅';
      setTimeout(() => {
        newInviteLinkBtn.textContent = '🔄';
      }, 1200);
    });
  }

  copySessionBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(formatCode(hostSession.sessionId));
    copySessionBtn.textContent = 'Copied!';
    setTimeout(() => (copySessionBtn.textContent = 'Copy'), 1400);
  });

  rotatePinBtn.addEventListener('click', () => {
    hostSession.pin = randomDigits(4);
    try { sessionStorage.setItem('prashnaa_host_pin', hostSession.pin); } catch {}
    hostPinEl.textContent = hostSession.pin;
    addAuditLog('Security PIN rotated.');
  });

  clearLogBtn.addEventListener('click', () => {
    auditLogList.innerHTML = '';
  });

  // ==================== HOST CONSENT & SCREEN CAPTURE ====================
  async function ensureHostScreenStream() {
    if (localDisplayStream && localDisplayStream.active) return localDisplayStream;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          cursor: 'always',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });
      localDisplayStream = stream;
      hostPreviewVideo.srcObject = stream;
      hostStagePlaceholder.classList.add('hidden');
      acquireTabKeepAwake();

      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        if (settings.displaySurface && settings.displaySurface !== 'monitor') {
          addAuditLog('⚠️ Note: You shared a single tab/window instead of "Entire Screen". Share "Entire Screen" if you want your partner to see files/folders outside the browser!');
        }
        track.onended = () => endCurrentSession(true);
      }
      return stream;
    } catch {
      return null;
    }
  }

  changeScreenBtn.addEventListener('click', async () => {
    if (localDisplayStream) {
      localDisplayStream.getTracks().forEach((t) => t.stop());
      localDisplayStream = null;
    }
    const stream = await ensureHostScreenStream();
    if (stream && activeDataConn && hostPeer) {
      if (activeMediaCall) {
        activeMediaCall._replaced = true;
        try { activeMediaCall.close(); } catch {}
      }
      activeMediaCall = hostPeer.call(activeDataConn.peer, stream);
    }
  });

  function scheduleHostAutoReconnect(delayMs) {
    if (hostReconnectTimer) clearTimeout(hostReconnectTimer);
    hostReconnectTimer = setTimeout(() => {
      if (explicitlyEnded || !localDisplayStream || !localDisplayStream.active) return;
      if (activeDataConn && activeDataConn.open) return;

      if (hostPeer && hostPeer.disconnected && !hostPeer.destroyed) {
        try { hostPeer.reconnect(); } catch {}
      }

      if (hostSession.approvedControllerPeerId && hostPeer && !hostPeer.destroyed && !hostPeer.disconnected) {
        try {
          const conn = hostPeer.connect(hostSession.approvedControllerPeerId, { reliable: true });
          conn.on('open', () => {
            if (conn._replaced || explicitlyEnded) return;
            conn.on('data', (msg) => {
              if (!msg || typeof msg !== 'object') return;
              if (conn === activeDataConn) handleHostDataMessage(msg);
            });
            attachApprovedHostDataConn(conn, hostSession.allowControl);
          });
        } catch {}
      }

      scheduleHostAutoReconnect(4500);
    }, delayMs);
  }

  function attachApprovedHostDataConn(conn, allowControl) {
    if (hostReconnectTimer) {
      clearTimeout(hostReconnectTimer);
      hostReconnectTimer = null;
    }
    if (activeDataConn && activeDataConn !== conn) {
      activeDataConn._replaced = true;
      try { activeDataConn.close(); } catch {}
    }
    explicitlyEnded = false;
    activeDataConn = conn;
    hostSession.connected = true;
    hostSession.approvedControllerPeerId = conn.peer;
    hostSession.allowControl = Boolean(allowControl);
    allowControlToggle.checked = hostSession.allowControl;
    updateHostBannerUI();

    const sendApprovalAndCall = () => {
      try {
        conn.send({
          type: 'request-approved',
          hostName: 'Partner Laptop',
          allowControl: hostSession.allowControl,
          helperRunning: helperExeActive
        });
      } catch {}
      if (localDisplayStream && localDisplayStream.active && hostPeer) {
        if (activeMediaCall) {
          activeMediaCall._replaced = true;
          try { activeMediaCall.close(); } catch {}
        }
        activeMediaCall = hostPeer.call(conn.peer, localDisplayStream);
      }
    };

    if (conn.open) {
      sendApprovalAndCall();
    } else {
      conn.on('open', sendApprovalAndCall);
    }

    conn.on('close', () => {
      if (conn._replaced || explicitlyEnded) return;
      addAuditLog('Connection interrupted — reconnecting automatically...');
      connectedModeLabel.textContent = 'Status: Reconnecting automatically...';
      scheduleHostAutoReconnect(4000);
    });

    conn.on('error', () => {
      if (conn._replaced || explicitlyEnded) return;
      scheduleHostAutoReconnect(4000);
    });
  }

  async function respondToIncomingRequest(approved, allowControl) {
    if (!pendingDataConn) return;
    const conn = pendingDataConn;
    pendingDataConn = null;
    consentModal.classList.add('hidden');

    if (!approved) {
      conn.send({ type: 'request-declined', reason: 'The host declined the connection request.' });
      setTimeout(() => conn.close(), 300);
      return;
    }

    const stream = await ensureHostScreenStream();
    if (!stream) {
      conn.send({ type: 'request-declined', reason: 'Screen selection was cancelled.' });
      return;
    }

    attachApprovedHostDataConn(conn, allowControl);
  }

  approveFullBtn.addEventListener('click', () => respondToIncomingRequest(true, true));
  approveViewOnlyBtn.addEventListener('click', () => respondToIncomingRequest(true, false));
  declineRequestBtn.addEventListener('click', () => respondToIncomingRequest(false, false));

  allowControlToggle.addEventListener('change', () => {
    hostSession.allowControl = allowControlToggle.checked;
    updateHostBannerUI();
    notifyHostPermissionsToController();
  });

  function updateHostBannerUI() {
    if (!hostSession.connected) {
      hostActiveBanner.classList.add('hidden');
      hostRemoteCursor.classList.add('hidden');
      return;
    }
    hostActiveBanner.classList.remove('hidden');
    connectedControllerLabel.textContent = `Connected: ${hostSession.partnerName}`;
    connectedModeLabel.textContent = hostSession.allowControl
      ? 'Mode: Mouse & Keyboard Control ALLOWED'
      : 'Mode: View-Only';
  }

  function handleHostDataMessage(msg) {
    if (msg.type === 'ping') {
      if (activeDataConn && activeDataConn.open) {
        try { activeDataConn.send({ type: 'pong', ts: msg.ts }); } catch {}
      }
      return;
    }
    if (msg.type === 'request-stream-refresh') {
      if (localDisplayStream && localDisplayStream.active && hostPeer && activeDataConn) {
        if (activeMediaCall) {
          activeMediaCall._replaced = true;
          try { activeMediaCall.close(); } catch {}
        }
        activeMediaCall = hostPeer.call(activeDataConn.peer, localDisplayStream);
      }
      return;
    }
    if (msg.type === 'control-input' && msg.event) {
      const ev = msg.event;
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        hostRemoteCursor.classList.remove('hidden');
        hostCursorTag.textContent = hostSession.partnerName;
        hostRemoteCursor.style.left = `${ev.x * 100}%`;
        hostRemoteCursor.style.top = `${ev.y * 100}%`;
        if (
          ev.type === 'mouse-down' ||
          ev.type === 'mouse-click' ||
          ev.type === 'mouse-dblclick' ||
          ev.type === 'laser-ping'
        ) {
          spawnLaserRipple(hostVideoStage, ev.x, ev.y);
        }
      }
      sendToLocalHelper(ev);
    } else if (msg.type === 'chat') {
      appendChatMessage({ senderName: msg.senderName || 'Partner', text: msg.text, self: false });
    } else if (msg.type === 'end-session') {
      endCurrentSession(true);
    }
  }

  // ==================== HEARTBEAT & AUTO-RECONNECT ENGINE ====================
  function startControllerHeartbeat() {
    stopControllerHeartbeat();
    controllerState.lastPongAt = Date.now();

    heartbeatInterval = setInterval(() => {
      if (!controllerState.connected || explicitlyEnded) return;

      if (activeDataConn && activeDataConn.open) {
        try {
          activeDataConn.send({ type: 'ping', ts: Date.now() });
        } catch {}
      }

      // Ensure remoteScreenVideo is playing if stream is present
      if (remoteScreenVideo.srcObject && remoteScreenVideo.paused) {
        remoteScreenVideo.muted = true;
        remoteScreenVideo.play().catch(() => {});
      }

      const elapsed = Date.now() - controllerState.lastPongAt;
      if (elapsed > 14000 && !controllerState.reconnecting) {
        triggerControllerReconnect('Connection timed out — reconnecting...');
      }
    }, 2200);
  }

  function stopControllerHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  function updateLatencyBadge(ms) {
    if (!latencyBadge) return;
    controllerState.latencyMs = ms;
    latencyBadge.textContent = `⚡ ${ms} ms`;
    latencyBadge.classList.toggle('warn', ms > 180);
  }

  function showReconnectBanner(text) {
    controllerState.reconnecting = true;
    if (connectionPulseDot) connectionPulseDot.classList.add('reconnecting');
    if (reconnectStatusText && text) reconnectStatusText.textContent = text;
    if (reconnectBanner) reconnectBanner.classList.remove('hidden');
  }

  function hideReconnectBanner() {
    controllerState.reconnecting = false;
    cancelPendingReconnectConn();
    if (connectionPulseDot) connectionPulseDot.classList.remove('reconnecting');
    if (reconnectBanner) reconnectBanner.classList.add('hidden');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function triggerControllerReconnect(reasonText) {
    if (explicitlyEnded || !controllerState.connected) return;
    showReconnectBanner(reasonText || 'Network hiccup — Auto-reconnecting to partner...');
    scheduleNextReconnectAttempt(700);
  }

  function scheduleNextReconnectAttempt(delayMs) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (explicitlyEnded || !controllerState.connected || !controllerState.reconnecting) return;
      attemptAutoReconnect();
    }, delayMs);
  }

  function attemptAutoReconnect(forceImmediate = false) {
    if (explicitlyEnded || !controllerState.connected) return;

    if (ctrlPeer && ctrlPeer.disconnected && !ctrlPeer.destroyed) {
      try { ctrlPeer.reconnect(); } catch {}
    }

    // If an outgoing reconnect attempt is already in flight and under 5.5s old, let ICE finish instead of killing it
    if (
      !forceImmediate &&
      pendingReconnectConn &&
      !pendingReconnectConn.open &&
      Date.now() - pendingReconnectStartedAt < 5500
    ) {
      scheduleNextReconnectAttempt(2000);
      return;
    }

    cancelPendingReconnectConn();

    const targetPeerId =
      controllerState.lastRemotePeerId ||
      (controllerState.lastSessionId ? PEER_PREFIX_HOST + controllerState.lastSessionId : null);

    if (targetPeerId && ctrlPeer && !ctrlPeer.destroyed && !ctrlPeer.disconnected) {
      try {
        const conn = ctrlPeer.connect(targetPeerId, { reliable: true });
        pendingReconnectConn = conn;
        pendingReconnectStartedAt = Date.now();

        conn.on('open', () => {
          if (conn._replaced || explicitlyEnded) return;
          pendingReconnectConn = null;
          setupControllerDataConnection(conn);
          try {
            conn.send({
              type: 'join-request',
              pin: controllerState.lastPin,
              controllerName: (controllerNameInput && controllerNameInput.value.trim()) || 'Your Partner',
              requestControl: requestControlCheckbox ? requestControlCheckbox.checked : true,
              isReconnect: true
            });
          } catch {}
        });

        conn.on('error', () => {
          if (pendingReconnectConn === conn) {
            pendingReconnectConn = null;
          }
        });
      } catch {}
    }

    scheduleNextReconnectAttempt(3200);
  }

  function requestStreamRefresh() {
    if (activeDataConn && activeDataConn.open) {
      try {
        activeDataConn.send({ type: 'request-stream-refresh' });
        return;
      } catch {}
    }
    triggerControllerReconnect('Refreshing screen stream...');
  }

  if (reconnectNowBtn) {
    reconnectNowBtn.addEventListener('click', () => {
      attemptAutoReconnect(true);
    });
  }

  if (refreshStreamBtn) {
    refreshStreamBtn.addEventListener('click', () => {
      requestStreamRefresh();
    });
  }

  // ==================== CONTROLLER CONNECTION & INPUT ====================
  function setupControllerDataConnection(conn) {
    if (!conn) return;
    if (activeDataConn && activeDataConn !== conn) {
      activeDataConn._replaced = true;
      try { activeDataConn.close(); } catch {}
    }
    activeDataConn = conn;
    if (conn.peer) {
      controllerState.lastRemotePeerId = conn.peer;
    }

    if (!conn._controllerDataBound) {
      conn._controllerDataBound = true;

      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        controllerState.lastPongAt = Date.now();

        if (msg.type === 'pong' && typeof msg.ts === 'number') {
          const rtt = Math.max(1, Date.now() - msg.ts);
          updateLatencyBadge(rtt);
          if (controllerState.reconnecting) hideReconnectBanner();
          return;
        }

        if (msg.type === 'ping') {
          try { conn.send({ type: 'pong', ts: msg.ts }); } catch {}
          return;
        }

        if (msg.type === 'request-declined') {
          requestJoinBtn.disabled = false;
          waitingApprovalBanner.classList.add('hidden');
          controllerErrorBox.textContent = msg.reason || 'Connection declined.';
          controllerErrorBox.classList.remove('hidden');
        } else if (msg.type === 'request-approved' || msg.type === 'partner-invite-ready') {
          const wasAlreadyConnected = controllerState.connected;
          explicitlyEnded = false;
          requestJoinBtn.disabled = false;
          waitingApprovalBanner.classList.add('hidden');
          controllerErrorBox.classList.add('hidden');

          controllerState.connected = true;
          controllerState.lastRemotePeerId = conn.peer;
          controllerState.hostName = msg.hostName || 'Partner Laptop';
          controllerState.allowControl = Boolean(msg.allowControl);
          controllerState.helperRunning = Boolean(msg.helperRunning);
          controllerState.lastPongAt = Date.now();

          hideReconnectBanner();
          startControllerHeartbeat();
          acquireTabKeepAwake();

          switchMode('controller');
          controllerConnectCard.classList.add('hidden');
          remoteDesktopShell.classList.remove('hidden');
          if (!wasAlreadyConnected) {
            setChatCollapsed(true);
          }
          remoteHostTitle.textContent = `Connected to ${controllerState.hostName}`;
          updateControllerPermissionBadge();
          remoteScreenWrapper.focus();
        } else if (msg.type === 'permissions-updated') {
          controllerState.allowControl = Boolean(msg.allowControl);
          if (msg.helperRunning !== undefined) {
            controllerState.helperRunning = Boolean(msg.helperRunning);
          }
          updateControllerPermissionBadge();
        } else if (msg.type === 'chat') {
          appendChatMessage({ senderName: msg.senderName || 'Partner', text: msg.text, self: false });
        } else if (msg.type === 'end-session') {
          endCurrentSession(true);
        }
      });

      conn.on('close', () => {
        if (conn._replaced || explicitlyEnded) return;
        if (controllerState.connected) {
          triggerControllerReconnect('Connection interrupted — Auto-reconnecting to partner...');
        }
      });

      conn.on('error', () => {
        if (conn._replaced || explicitlyEnded) return;
        if (controllerState.connected) {
          triggerControllerReconnect('Network glitch — Auto-reconnecting...');
        }
      });

      setTimeout(() => {
        const pc = conn.peerConnection;
        if (!pc) return;
        let iceTimer = null;
        pc.addEventListener('iceconnectionstatechange', () => {
          if (conn._replaced || explicitlyEnded || !controllerState.connected) return;
          const st = pc.iceConnectionState;
          if (st === 'connected' || st === 'completed') {
            if (iceTimer) {
              clearTimeout(iceTimer);
              iceTimer = null;
            }
          } else if (st === 'failed') {
            triggerControllerReconnect('Peer transport interrupted — reconnecting...');
          } else if (st === 'disconnected') {
            if (!iceTimer) {
              iceTimer = setTimeout(() => {
                if (!conn._replaced && !explicitlyEnded && controllerState.connected && pc.iceConnectionState === 'disconnected') {
                  triggerControllerReconnect('Re-establishing peer connection...');
                }
              }, 4000);
            }
          }
        });
      }, 50);
    }
  }

  joinSessionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    controllerErrorBox.classList.add('hidden');

    const cleanId = remoteSessionIdInput.value.replace(/\D/g, '');
    const cleanPin = remotePinInput.value.trim();
    const controllerName = controllerNameInput.value.trim() || 'Your Partner';
    const requestControl = requestControlCheckbox.checked;

    if (cleanId.length !== 6) {
      controllerErrorBox.textContent = 'Please enter a valid 6-digit Session ID.';
      controllerErrorBox.classList.remove('hidden');
      return;
    }

    explicitlyEnded = false;
    controllerState.lastSessionId = cleanId;
    controllerState.lastPin = cleanPin;
    controllerState.lastRemotePeerId = PEER_PREFIX_HOST + cleanId;

    requestJoinBtn.disabled = true;
    waitingApprovalBanner.classList.remove('hidden');

    const conn = ctrlPeer.connect(PEER_PREFIX_HOST + cleanId, { reliable: true });
    setupControllerDataConnection(conn);

    const openTimeout = setTimeout(() => {
      if (!conn.open && !controllerState.connected) {
        requestJoinBtn.disabled = false;
        waitingApprovalBanner.classList.add('hidden');
        controllerErrorBox.textContent = 'Connection timed out. Make sure your partner has Prashnaa open.';
        controllerErrorBox.classList.remove('hidden');
      }
    }, 9000);

    conn.on('open', () => {
      clearTimeout(openTimeout);
      conn.send({
        type: 'join-request',
        pin: cleanPin,
        controllerName,
        requestControl
      });
    });

    conn.on('error', () => {
      clearTimeout(openTimeout);
      requestJoinBtn.disabled = false;
      waitingApprovalBanner.classList.add('hidden');
      controllerErrorBox.textContent = 'Could not reach Session ID.';
      controllerErrorBox.classList.remove('hidden');
    });
  });

  function updateControllerPermissionBadge() {
    if (!controllerState.allowControl) {
      controllerPermissionBadge.textContent = '👁️ View-Only (Partner Paused Control)';
      controllerPermissionBadge.className = 'badge badge-info';
    } else if (!controllerState.helperRunning) {
      controllerPermissionBadge.textContent = '⚠️ Screen View Only — Partner Needs Helper.exe Open';
      controllerPermissionBadge.className = 'badge badge-control';
    } else {
      controllerPermissionBadge.textContent = '🟢 Full Mouse & File Control Active';
      controllerPermissionBadge.className = 'badge badge-shield';
    }
  }

  function spawnLaserRipple(container, normX, normY) {
    const ripple = document.createElement('div');
    ripple.className = 'laser-ripple';
    ripple.style.left = `${normX * 100}%`;
    ripple.style.top = `${normY * 100}%`;
    container.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  function getNormalizedVideoCoords(clientX, clientY) {
    const rect = remoteScreenVideo.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const videoWidth = remoteScreenVideo.videoWidth || rect.width;
    const videoHeight = remoteScreenVideo.videoHeight || rect.height;

    const videoRatio = videoWidth / videoHeight;
    const elementRatio = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (elementRatio > videoRatio) {
      renderWidth = rect.height * videoRatio;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      renderHeight = rect.width / videoRatio;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const relX = (clientX - rect.left - offsetX) / renderWidth;
    const relY = (clientY - rect.top - offsetY) / renderHeight;

    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;
    return {
      x: Number(relX.toFixed(4)),
      y: Number(relY.toFixed(4))
    };
  }

  function sendRemoteInput(event) {
    if (!controllerState.connected || !activeDataConn || !activeDataConn.open) return;

    if (
      (event.type === 'pointer-move' || event.type === 'mouse-scroll') &&
      activeDataConn.dataChannel &&
      activeDataConn.dataChannel.bufferedAmount > 32768
    ) {
      return;
    }

    try {
      activeDataConn.send({
        type: 'control-input',
        event
      });
    } catch {}
  }

  let lastMoveSent = 0;
  remoteScreenWrapper.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMoveSent < 24) return;
    lastMoveSent = now;

    const coords = getNormalizedVideoCoords(e.clientX, e.clientY);
    if (!coords) return;

    controllerState.lastX = coords.x;
    controllerState.lastY = coords.y;

    sendRemoteInput({
      type: 'pointer-move',
      x: coords.x,
      y: coords.y
    });
  });

  remoteScreenWrapper.addEventListener('mousedown', (e) => {
    remoteScreenWrapper.focus();
    const coords = getNormalizedVideoCoords(e.clientX, e.clientY);
    if (!coords) return;

    controllerState.lastX = coords.x;
    controllerState.lastY = coords.y;

    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    spawnLaserRipple(remoteLaserLayer, coords.x, coords.y);

    if (!controllerState.allowControl) {
      sendRemoteInput({ type: 'laser-ping', x: coords.x, y: coords.y });
      return;
    }

    if (singleClickDblToggle && singleClickDblToggle.checked && button === 'left') {
      sendRemoteInput({
        type: 'mouse-dblclick',
        x: coords.x,
        y: coords.y
      });
      return;
    }

    sendRemoteInput({
      type: 'mouse-down',
      button,
      x: coords.x,
      y: coords.y
    });
  });

  remoteScreenWrapper.addEventListener('mouseup', (e) => {
    if (!controllerState.allowControl) return;
    if (singleClickDblToggle && singleClickDblToggle.checked && e.button === 0) return;

    const coords = getNormalizedVideoCoords(e.clientX, e.clientY) || {
      x: controllerState.lastX,
      y: controllerState.lastY
    };
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';

    sendRemoteInput({
      type: 'mouse-up',
      button,
      x: coords.x,
      y: coords.y
    });
  });

  remoteScreenWrapper.addEventListener('dblclick', (e) => {
    if (!controllerState.allowControl) return;
    const coords = getNormalizedVideoCoords(e.clientX, e.clientY);
    if (!coords) return;
    sendRemoteInput({ type: 'mouse-dblclick', x: coords.x, y: coords.y });
  });

  remoteScreenWrapper.addEventListener('contextmenu', (e) => e.preventDefault());

  let accumulatedWheelDelta = 0;
  let wheelFlushTimer = null;
  remoteScreenWrapper.addEventListener(
    'wheel',
    (e) => {
      if (!controllerState.allowControl) return;
      e.preventDefault();
      accumulatedWheelDelta += e.deltaY;
      if (!wheelFlushTimer) {
        wheelFlushTimer = setTimeout(() => {
          const deltaY = accumulatedWheelDelta;
          accumulatedWheelDelta = 0;
          wheelFlushTimer = null;
          if (deltaY !== 0) {
            sendRemoteInput({ type: 'mouse-scroll', deltaY });
          }
        }, 35);
      }
    },
    { passive: false }
  );

  remoteScreenWrapper.addEventListener('keydown', (e) => {
    if (!controllerState.connected || !controllerState.allowControl || !captureKeyboardToggle.checked) return;
    if (document.activeElement === quickTypeInput || document.activeElement === chatInput) return;

    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') { sendRemoteInput({ type: 'hotkey', action: 'copy' }); return; }
      if (k === 'v') { sendRemoteInput({ type: 'hotkey', action: 'paste' }); return; }
      if (k === 'x') { sendRemoteInput({ type: 'hotkey', action: 'cut' }); return; }
      if (k === 'a') { sendRemoteInput({ type: 'hotkey', action: 'select-all' }); return; }
      if (k === 'z') { sendRemoteInput({ type: 'hotkey', action: 'undo' }); return; }
      if (k === 'y') { sendRemoteInput({ type: 'hotkey', action: 'redo' }); return; }
      if (k === 's') { sendRemoteInput({ type: 'hotkey', action: 'save' }); return; }
      if (k === 'f') { sendRemoteInput({ type: 'hotkey', action: 'find' }); return; }
      if (k === 'r') { sendRemoteInput({ type: 'hotkey', action: 'refresh' }); return; }
    }

    sendRemoteInput({ type: 'key-down', key: e.key, code: e.code });
  });

  // Quick Action Buttons
  if (showDesktopBtn) {
    showDesktopBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'show-desktop' });
    });
  }

  if (openExplorerBtn) {
    openExplorerBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'open-explorer' });
    });
  }

  if (startMenuBtn) {
    startMenuBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'hotkey', action: 'start-menu' });
    });
  }

  if (sendEnterBtn) {
    sendEnterBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'key-down', key: 'Enter', code: 'Enter' });
    });
  }

  if (sendRightClickBtn) {
    sendRightClickBtn.addEventListener('click', () => {
      sendRemoteInput({
        type: 'mouse-click',
        button: 'right',
        x: controllerState.lastX,
        y: controllerState.lastY
      });
    });
  }

  if (sendCopyBtn) {
    sendCopyBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'hotkey', action: 'copy' });
    });
  }

  if (sendPasteBtn) {
    sendPasteBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'hotkey', action: 'paste' });
    });
  }

  if (quickTypeForm) {
    quickTypeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = quickTypeInput.value;
      if (!text) return;
      sendRemoteInput({ type: 'type-text', text });
      quickTypeInput.value = '';
    });
  }

  if (sendBackspaceBtn) {
    sendBackspaceBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'key-down', key: 'Backspace', code: 'Backspace' });
    });
  }

  if (sendEscBtn) {
    sendEscBtn.addEventListener('click', () => {
      sendRemoteInput({ type: 'key-down', key: 'Escape', code: 'Escape' });
    });
  }

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      remoteDesktopShell.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (fullscreenBtn) {
      fullscreenBtn.textContent = document.fullscreenElement ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
    }
  });

  function endCurrentSession(isExplicit = true) {
    explicitlyEnded = Boolean(isExplicit);
    stopControllerHeartbeat();
    hideReconnectBanner();
    cancelPendingReconnectConn();
    releaseTabKeepAwake();

    if (hostReconnectTimer) {
      clearTimeout(hostReconnectTimer);
      hostReconnectTimer = null;
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

    if (isExplicit && localDisplayStream) {
      localDisplayStream.getTracks().forEach((t) => t.stop());
      localDisplayStream = null;
      hostPreviewVideo.srcObject = null;
      hostStagePlaceholder.classList.remove('hidden');
    }

    hostSession.connected = false;
    hostSession.approvedControllerPeerId = null;
    updateHostBannerUI();

    controllerState.connected = false;
    controllerState.reconnecting = false;
    remoteDesktopShell.classList.add('hidden');
    controllerConnectCard.classList.remove('hidden');
    remoteVideoPlaceholder.classList.remove('hidden');
    remoteScreenVideo.srcObject = null;
  }

  hostDisconnectBtn.addEventListener('click', () => endCurrentSession(true));
  controllerDisconnectBtn.addEventListener('click', () => endCurrentSession(true));

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    if (activeDataConn && activeDataConn.open) {
      try {
        activeDataConn.send({
          type: 'chat',
          senderName: currentMode === 'controller' ? (controllerNameInput.value.trim() || 'Partner') : 'Partner',
          text
        });
      } catch {}
    }
    appendChatMessage({ senderName: 'You', text, self: true });
    chatInput.value = '';
  });
})();
