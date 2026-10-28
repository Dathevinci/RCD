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

  const params = new URLSearchParams(window.location.search);
  const inviteRoomCode = params.get('room');

  const stepReady = document.getElementById('stepReady');
  const stepApprove = document.getElementById('stepApprove');
  const stepActive = document.getElementById('stepActive');

  const partnerHelperDot = document.getElementById('partnerHelperDot');
  const partnerHelperTitle = document.getElementById('partnerHelperTitle');
  const partnerHelperBadge = document.getElementById('partnerHelperBadge');
  const partnerHelperDesc = document.getElementById('partnerHelperDesc');

  const startSimpleShareBtn = document.getElementById('startSimpleShareBtn');
  const simpleAllowControl = document.getElementById('simpleAllowControl');
  const simpleCodeDisplay = document.getElementById('simpleCodeDisplay');

  const simpleHelperName = document.getElementById('simpleHelperName');
  const confirmApproveBtn = document.getElementById('confirmApproveBtn');
  const confirmDeclineBtn = document.getElementById('confirmDeclineBtn');

  const activePartnerStatus = document.getElementById('activePartnerStatus');
  const notEntireScreenWarningBtn = document.getElementById('notEntireScreenWarningBtn');
  const simplePreviewVideo = document.getElementById('simplePreviewVideo');
  const simpleRemoteCursor = document.getElementById('simpleRemoteCursor');
  const simpleCursorTag = document.getElementById('simpleCursorTag');
  const activeControlSwitch = document.getElementById('activeControlSwitch');
  const stopSimpleShareBtn = document.getElementById('stopSimpleShareBtn');

  let sessionState = {
    sessionId: randomDigits(6),
    pin: randomDigits(4),
    allowControl: true,
    connected: false,
    helperName: 'Your Partner'
  };

  let peer = null;
  let activeDataConn = null;
  let pendingDataConn = null;
  let activeMediaCall = null;
  let localStream = null;
  let helperExeActive = false;

  async function checkLocalHelperExe() {
    try {
      const res = await fetch('http://127.0.0.1:3847/status');
      const data = await res.json();
      if (data && data.ok) {
        helperExeActive = true;
        partnerHelperDot.className = 'dot online';
        partnerHelperBadge.textContent = '🟢 Ready';
        partnerHelperBadge.className = 'badge badge-shield';
        partnerHelperTitle.textContent = 'Step 1: Mouse & File Helper Running!';
        partnerHelperDesc.textContent = 'Awesome! Your partner can now click, open files/folders, and type when you click Step 2 below.';
        syncHelperPermission();
        return;
      }
    } catch {}
    helperExeActive = false;
    partnerHelperDot.className = 'dot';
    partnerHelperBadge.textContent = 'Required for Control';
    partnerHelperBadge.className = 'badge';
  }

  async function syncHelperPermission() {
    try {
      await fetch('http://127.0.0.1:3847/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowControl: Boolean(sessionState.allowControl && sessionState.connected)
        })
      });
    } catch {}
  }

  setInterval(checkLocalHelperExe, 2500);
  checkLocalHelperExe();

  function showStep(stepEl) {
    stepReady.classList.add('hidden');
    stepApprove.classList.add('hidden');
    stepActive.classList.add('hidden');
    stepEl.classList.remove('hidden');
  }

  function initPeer() {
    peer = new Peer(PEER_PREFIX_HOST + sessionState.sessionId);

    peer.on('open', () => {
      if (inviteRoomCode) {
        simpleCodeDisplay.textContent = `1-Click Invite Ready (Room ${inviteRoomCode.slice(0, 3)}-${inviteRoomCode.slice(3)})`;
      } else {
        simpleCodeDisplay.innerHTML = `Or give your partner this Code: <strong style="color:#60a5fa;">${sessionState.sessionId.slice(0, 3)}-${sessionState.sessionId.slice(3)}</strong> &amp; PIN: <strong style="color:#34d399;">${sessionState.pin}</strong>`;
      }
    });

    peer.on('connection', (conn) => {
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'join-request') {
          if (String(msg.pin).trim() !== sessionState.pin) {
            conn.send({ type: 'request-declined', reason: 'Invalid 4-digit PIN.' });
            setTimeout(() => conn.close(), 400);
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
        track.onended = () => stopSession();
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
        activeMediaCall = peer.call(activeDataConn.peer, stream);
      }
    });
  }

  function handleIncomingData(msg) {
    if (msg.type === 'control-input' && msg.event) {
      const ev = msg.event;
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        simpleRemoteCursor.classList.remove('hidden');
        simpleCursorTag.textContent = sessionState.helperName;
        simpleRemoteCursor.style.left = `${ev.x * 100}%`;
        simpleRemoteCursor.style.top = `${ev.y * 100}%`;
      }
      if (sessionState.allowControl && helperExeActive) {
        fetch('http://127.0.0.1:3847/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ev)
        }).catch(() => {});
      }
    } else if (msg.type === 'end-session') {
      stopSession();
    }
  }

  startSimpleShareBtn.addEventListener('click', async () => {
    sessionState.allowControl = simpleAllowControl.checked;
    activeControlSwitch.checked = sessionState.allowControl;

    const stream = await captureScreen();
    if (!stream) return;

    if (inviteRoomCode) {
      const targetPeerId = PEER_PREFIX_CTRL + inviteRoomCode.replace(/\D/g, '');
      const conn = peer.connect(targetPeerId, { reliable: true });
      activeDataConn = conn;

      conn.on('open', () => {
        sessionState.connected = true;
        syncHelperPermission();
        conn.send({
          type: 'partner-invite-ready',
          hostName: 'Partner Laptop',
          allowControl: sessionState.allowControl
        });
        activeMediaCall = peer.call(targetPeerId, stream);
        activePartnerStatus.textContent = 'Connected! Your partner can now see your screen and help you.';
        showStep(stepActive);
      });

      conn.on('data', handleIncomingData);
      conn.on('close', stopSession);
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

    activeDataConn = conn;
    sessionState.connected = true;
    sessionState.allowControl = activeControlSwitch.checked;
    syncHelperPermission();

    conn.send({
      type: 'request-approved',
      hostName: 'Partner Laptop',
      allowControl: sessionState.allowControl
    });

    activeMediaCall = peer.call(conn.peer, stream);
    activePartnerStatus.textContent = `${sessionState.helperName} is now connected.`;
    showStep(stepActive);

    conn.on('close', stopSession);
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
    syncHelperPermission();
    if (activeDataConn && activeDataConn.open) {
      activeDataConn.send({
        type: 'permissions-updated',
        allowControl: sessionState.allowControl
      });
    }
  });

  function stopSession() {
    sessionState.connected = false;
    syncHelperPermission();
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
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    showStep(stepReady);
  }

  stopSimpleShareBtn.addEventListener('click', stopSession);
})();
