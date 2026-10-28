(() => {
  const PEER_PREFIX_HOST = 'ra-host-';
  const PEER_PREFIX_CTRL = 'ra-ctrl-';

  function randomDigits(len) {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += Math.floor(Math.random() * 10).toString();
    }
    if (s[0] === '0') s = '1' + s.slice(1);
    return s;
  }

  let currentMode = 'controller';
  let hostSession = {
    sessionId: randomDigits(6),
    pin: randomDigits(4),
    allowControl: true,
    connected: false,
    partnerName: 'Partner'
  };

  let controllerInviteCode = randomDigits(6);
  let controllerState = {
    connected: false,
    allowControl: false,
    helperRunning: false,
    hostName: 'Partner Laptop',
    lastX: 0.5,
    lastY: 0.5
  };

  let hostPeer = null;
  let ctrlPeer = null;
  let activeDataConn = null;
  let activeMediaCall = null;
  let pendingDataConn = null;
  let localDisplayStream = null;
  let helperExeActive = false;

  // DOM Elements
  const tabHost = document.getElementById('tabHost');
  const tabController = document.getElementById('tabController');
  const hostView = document.getElementById('hostView');
  const controllerView = document.getElementById('controllerView');
  const serverDot = document.getElementById('serverDot');
  const serverStatusText = document.getElementById('serverStatusText');

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
  const joinSessionForm = document.getElementById('joinSessionForm');
  const remoteSessionIdInput = document.getElementById('remoteSessionIdInput');
  const remotePinInput = document.getElementById('remotePinInput');
  const controllerNameInput = document.getElementById('controllerNameInput');
  const requestControlCheckbox = document.getElementById('requestControlCheckbox');
  const controllerErrorBox = document.getElementById('controllerErrorBox');
  const waitingApprovalBanner = document.getElementById('waitingApprovalBanner');
  const requestJoinBtn = document.getElementById('requestJoinBtn');

  const remoteDesktopShell = document.getElementById('remoteDesktopShell');
  const remoteHostTitle = document.getElementById('remoteHostTitle');
  const controllerPermissionBadge = document.getElementById('controllerPermissionBadge');
  const showDesktopBtn = document.getElementById('showDesktopBtn');
  const openExplorerBtn = document.getElementById('openExplorerBtn');
  const singleClickDblToggle = document.getElementById('singleClickDblToggle');
  const sendEnterBtn = document.getElementById('sendEnterBtn');
  const sendRightClickBtn = document.getElementById('sendRightClickBtn');
  const captureKeyboardToggle = document.getElementById('captureKeyboardToggle');
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

  // ==================== CHECK LOCAL WINDOWS HELPER EXE (127.0.0.1:3847) ====================
  async function checkLocalHelperExe() {
    try {
      const res = await fetch('http://127.0.0.1:3847/status', { method: 'GET' });
      const data = await res.json();
      if (data && data.ok) {
        if (!helperExeActive) {
          helperExeActive = true;
          agentDot.className = 'dot online';
          agentStatusTitle.textContent = `Windows Mouse Helper: Active (${data.width}x${data.height})`;
          agentStatusDesc.textContent = 'Ready! Your partner can click, open files, drag & type when allowed.';
          syncHelperPermission();
          addAuditLog('Connected to RemoteAssist-Helper.exe on 127.0.0.1:3847.');
        }
        return;
      }
    } catch {}

    if (helperExeActive) {
      helperExeActive = false;
      agentDot.className = 'dot';
      agentStatusTitle.textContent = 'Windows Mouse Helper: Not Opened';
    } else {
      agentStatusTitle.textContent = 'Windows Mouse Helper: Not Opened (Screen View Only)';
    }
  }

  async function syncHelperPermission() {
    try {
      await fetch('http://127.0.0.1:3847/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowControl: Boolean(hostSession.allowControl && hostSession.connected)
        })
      });
    } catch {}
  }

  setInterval(checkLocalHelperExe, 3000);
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

  function initPeers() {
    hostSessionIdEl.textContent = formatCode(hostSession.sessionId);
    hostPinEl.textContent = hostSession.pin;

    const inviteUrl = `${getBaseFolderUrl()}partner.html?room=${controllerInviteCode}`;
    partnerInviteLinkInput.value = inviteUrl;

    ctrlPeer = new Peer(PEER_PREFIX_CTRL + controllerInviteCode);

    ctrlPeer.on('open', () => {
      serverDot.className = 'dot online';
      serverStatusText.textContent = 'Cloud P2P Ready (No Server Needed)';
    });

    ctrlPeer.on('connection', (conn) => {
      setupControllerDataConnection(conn);
    });

    ctrlPeer.on('call', (call) => {
      activeMediaCall = call;
      call.answer();
      call.on('stream', (remoteStream) => {
        remoteScreenVideo.srcObject = remoteStream;
        remoteVideoPlaceholder.classList.add('hidden');
      });
    });

    hostPeer = new Peer(PEER_PREFIX_HOST + hostSession.sessionId);

    hostPeer.on('connection', (conn) => {
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'join-request') {
          if (String(msg.pin).trim() !== hostSession.pin) {
            conn.send({ type: 'request-declined', reason: 'Invalid 4-digit PIN.' });
            setTimeout(() => conn.close(), 400);
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

  initPeers();

  copyInviteLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(partnerInviteLinkInput.value);
    copyInviteLinkBtn.textContent = '✅ Link Copied!';
    setTimeout(() => {
      copyInviteLinkBtn.textContent = '📋 Copy Partner Link';
    }, 1800);
  });

  copySessionBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(formatCode(hostSession.sessionId));
    copySessionBtn.textContent = 'Copied!';
    setTimeout(() => (copySessionBtn.textContent = 'Copy'), 1400);
  });

  rotatePinBtn.addEventListener('click', () => {
    hostSession.pin = randomDigits(4);
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

      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings ? track.getSettings() : {};
        if (settings.displaySurface && settings.displaySurface !== 'monitor') {
          addAuditLog('⚠️ Note: You shared a single tab/window instead of "Entire Screen". Share "Entire Screen" if you want your partner to see files/folders outside the browser!');
        }
        track.onended = () => endCurrentSession();
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
      activeMediaCall = hostPeer.call(activeDataConn.peer, stream);
    }
  });

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

    activeDataConn = conn;
    hostSession.connected = true;
    hostSession.allowControl = Boolean(allowControl);
    allowControlToggle.checked = hostSession.allowControl;
    updateHostBannerUI();
    syncHelperPermission();

    conn.send({
      type: 'request-approved',
      hostName: 'Partner Laptop',
      allowControl: hostSession.allowControl
    });

    activeMediaCall = hostPeer.call(conn.peer, stream);
    conn.on('close', () => endCurrentSession());
  }

  approveFullBtn.addEventListener('click', () => respondToIncomingRequest(true, true));
  approveViewOnlyBtn.addEventListener('click', () => respondToIncomingRequest(true, false));
  declineRequestBtn.addEventListener('click', () => respondToIncomingRequest(false, false));

  allowControlToggle.addEventListener('change', () => {
    hostSession.allowControl = allowControlToggle.checked;
    updateHostBannerUI();
    syncHelperPermission();
    if (activeDataConn && activeDataConn.open) {
      activeDataConn.send({
        type: 'permissions-updated',
        allowControl: hostSession.allowControl
      });
    }
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
    if (msg.type === 'control-input' && msg.event) {
      const ev = msg.event;
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        hostRemoteCursor.classList.remove('hidden');
        hostCursorTag.textContent = hostSession.partnerName;
        hostRemoteCursor.style.left = `${ev.x * 100}%`;
        hostRemoteCursor.style.top = `${ev.y * 100}%`;
        if (ev.type === 'mouse-down' || ev.type === 'mouse-click' || ev.type === 'mouse-dblclick' || ev.type === 'laser-ping') {
          spawnLaserRipple(hostVideoStage, ev.x, ev.y);
        }
      }
      if (hostSession.allowControl && helperExeActive) {
        fetch('http://127.0.0.1:3847/input', {
          method: 'POST',
          body: JSON.stringify(ev)
        }).catch(() => {});
      }
    } else if (msg.type === 'chat') {
      appendChatMessage({ senderName: msg.senderName || 'Partner', text: msg.text, self: false });
    } else if (msg.type === 'end-session') {
      endCurrentSession();
    }
  }

  // ==================== CONTROLLER CONNECTION & INPUT ====================
  function setupControllerDataConnection(conn) {
    activeDataConn = conn;

    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'request-declined') {
        requestJoinBtn.disabled = false;
        waitingApprovalBanner.classList.add('hidden');
        controllerErrorBox.textContent = msg.reason || 'Connection declined.';
        controllerErrorBox.classList.remove('hidden');
      } else if (msg.type === 'request-approved' || msg.type === 'partner-invite-ready') {
        requestJoinBtn.disabled = false;
        waitingApprovalBanner.classList.add('hidden');
        controllerState.connected = true;
        controllerState.hostName = msg.hostName || 'Partner Laptop';
        controllerState.allowControl = Boolean(msg.allowControl);
        controllerState.helperRunning = Boolean(msg.helperRunning);

        switchMode('controller');
        controllerConnectCard.classList.add('hidden');
        remoteDesktopShell.classList.remove('hidden');
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
        endCurrentSession();
      }
    });

    conn.on('close', () => {
      endCurrentSession();
    });
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

    requestJoinBtn.disabled = true;
    waitingApprovalBanner.classList.remove('hidden');

    const conn = ctrlPeer.connect(PEER_PREFIX_HOST + cleanId, { reliable: true });
    setupControllerDataConnection(conn);

    conn.on('open', () => {
      conn.send({
        type: 'join-request',
        pin: cleanPin,
        controllerName,
        requestControl
      });
    });

    conn.on('error', () => {
      requestJoinBtn.disabled = false;
      waitingApprovalBanner.classList.add('hidden');
      controllerErrorBox.textContent = 'Could not reach Session ID.';
      controllerErrorBox.classList.remove('hidden');
    });
  });

  function updateControllerPermissionBadge() {
    if (!controllerState.allowControl) {
      controllerPermissionBadge.textContent = '👁️ View-Only (Partner Disabled Control)';
      controllerPermissionBadge.className = 'badge badge-info';
    } else if (!controllerState.helperRunning) {
      controllerPermissionBadge.textContent = '⚠️ Screen View Only — Ask Partner to Open RemoteAssist-Helper.exe!';
      controllerPermissionBadge.className = 'badge badge-control';
    } else {
      controllerPermissionBadge.textContent = '🟢 Full OS Mouse & File Control Active';
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
    activeDataConn.send({
      type: 'control-input',
      event
    });
  }

  let lastMoveSent = 0;
  remoteScreenWrapper.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastMoveSent < 22) return;
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

    // If "1-Click = Double-Click (Open Files)" mode is checked, send a crisp double-click on left click!
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

  remoteScreenWrapper.addEventListener(
    'wheel',
    (e) => {
      if (!controllerState.allowControl) return;
      e.preventDefault();
      sendRemoteInput({ type: 'mouse-scroll', deltaY: e.deltaY });
    },
    { passive: false }
  );

  remoteScreenWrapper.addEventListener('keydown', (e) => {
    if (!controllerState.connected || !controllerState.allowControl || !captureKeyboardToggle.checked) return;
    // Don't hijack typing inside the Quick Type input or Chat input
    if (document.activeElement === quickTypeInput || document.activeElement === chatInput) return;
    e.preventDefault();
    sendRemoteInput({ type: 'key-down', key: e.key, code: e.code });
  });

  // Quick Action Buttons for Opening Files, Right-Clicking, and Typing
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

  function endCurrentSession() {
    if (activeDataConn && activeDataConn.open) {
      try {
        activeDataConn.send({ type: 'end-session' });
        activeDataConn.close();
      } catch {}
    }
    activeDataConn = null;

    if (activeMediaCall) {
      try {
        activeMediaCall.close();
      } catch {}
      activeMediaCall = null;
    }

    hostSession.connected = false;
    updateHostBannerUI();
    syncHelperPermission();

    controllerState.connected = false;
    remoteDesktopShell.classList.add('hidden');
    controllerConnectCard.classList.remove('hidden');
    remoteVideoPlaceholder.classList.remove('hidden');
    remoteScreenVideo.srcObject = null;
  }

  hostDisconnectBtn.addEventListener('click', endCurrentSession);
  controllerDisconnectBtn.addEventListener('click', endCurrentSession);

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    if (activeDataConn && activeDataConn.open) {
      activeDataConn.send({
        type: 'chat',
        senderName: 'Partner',
        text
      });
    }
    appendChatMessage({ senderName: 'You', text, self: true });
    chatInput.value = '';
  });
})();
