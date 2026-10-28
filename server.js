const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Short invite URL for non-technical partners: /help/:roomCode
app.get('/help/:roomCode', (req, res) => {
  res.redirect(`/partner.html?room=${encodeURIComponent(req.params.roomCode)}`);
});

const sessions = new Map();
const socketToSession = new Map();
// Controller-created invite rooms so the non-IT partner doesn't have to type any code
const inviteRooms = new Map();

function generateSessionId() {
  let id;
  do {
    id = crypto.randomInt(100000, 999999).toString();
  } while (sessions.has(id) || inviteRooms.has(id));
  return id;
}

function generatePin() {
  return crypto.randomInt(1000, 9999).toString();
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

app.get('/api/server-info', (req, res) => {
  res.json({
    port: PORT,
    lanAddresses: getLocalIpAddresses(),
    hostname: os.hostname()
  });
});

io.on('connection', (socket) => {
  // 0. Controller creates a 1-Click Invite Link for their non-IT partner
  socket.on('controller:create-invite', ({ controllerName } = {}, callback) => {
    const roomCode = generateSessionId();
    inviteRooms.set(roomCode, {
      roomCode,
      controllerSocketId: socket.id,
      controllerName: (controllerName || 'Your Partner').slice(0, 40),
      createdAt: Date.now()
    });
    callback?.({
      ok: true,
      roomCode
    });
  });

  // Partner clicks the 1-Click Invite Link and presses "Allow & Share My Screen"
  socket.on('partner:accept-invite', ({ roomCode, allowControl, hostName } = {}, callback) => {
    const cleanRoom = String(roomCode || '').replace(/\D/g, '');
    const room = inviteRooms.get(cleanRoom);
    if (!room) {
      return callback?.({
        ok: false,
        error: 'This invite link has expired. Ask your partner for a new link.'
      });
    }

    const pin = generatePin();
    const session = {
      sessionId: cleanRoom,
      pin,
      hostSocketId: socket.id,
      hostName: (hostName || 'Partner Laptop').slice(0, 40),
      controllerSocketId: room.controllerSocketId,
      controllerName: room.controllerName,
      pendingControllerId: null,
      approved: true,
      permissions: {
        allowControl: Boolean(allowControl),
        allowClipboard: true
      },
      createdAt: Date.now()
    };

    sessions.set(cleanRoom, session);
    socketToSession.set(socket.id, cleanRoom);
    socketToSession.set(room.controllerSocketId, cleanRoom);
    inviteRooms.delete(cleanRoom);

    // Notify the waiting Controller that the Partner clicked Allow!
    io.to(room.controllerSocketId).emit('controller:request-approved', {
      sessionId: session.sessionId,
      hostName: session.hostName,
      permissions: session.permissions
    });

    callback?.({
      ok: true,
      sessionId: cleanRoom,
      controllerName: room.controllerName,
      permissions: session.permissions
    });
  });

  // 1. Host creates a new session
  socket.on('host:create-session', ({ hostName, prefillSessionId, prefillPin } = {}, callback) => {
    const existingId = socketToSession.get(socket.id);
    if (existingId && sessions.has(existingId)) {
      sessions.delete(existingId);
    }

    const sessionId = prefillSessionId && !sessions.has(prefillSessionId) ? prefillSessionId : generateSessionId();
    const pin = prefillPin || generatePin();

    const session = {
      sessionId,
      pin,
      hostSocketId: socket.id,
      hostName: (hostName || os.hostname() || 'Partner Laptop').slice(0, 40),
      controllerSocketId: null,
      controllerName: null,
      pendingControllerId: null,
      approved: false,
      permissions: {
        allowControl: false,
        allowClipboard: true
      },
      createdAt: Date.now()
    };

    sessions.set(sessionId, session);
    socketToSession.set(socket.id, sessionId);

    if (typeof callback === 'function') {
      callback({
        ok: true,
        sessionId,
        pin,
        hostName: session.hostName
      });
    }
  });

  // 2. Host rotates their PIN
  socket.on('host:regenerate-pin', (_, callback) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || session.hostSocketId !== socket.id) {
      return callback?.({ ok: false, error: 'Session not found' });
    }

    session.pin = generatePin();
    callback?.({ ok: true, pin: session.pin });
  });

  // 3. Controller requests to join a Host session using Session ID + PIN
  socket.on('controller:request-join', ({ sessionId, pin, controllerName, requestControl }, callback) => {
    const cleanId = String(sessionId || '').replace(/\D/g, '');
    const cleanPin = String(pin || '').trim();

    const session = sessions.get(cleanId);
    if (!session) {
      return callback?.({ ok: false, error: 'Session ID not found. Make sure the other laptop is open.' });
    }

    if (cleanPin && session.pin !== cleanPin) {
      return callback?.({ ok: false, error: 'Invalid 4-digit security PIN.' });
    }

    if (session.controllerSocketId || session.pendingControllerId) {
      return callback?.({ ok: false, error: 'This session already has an active or pending connection.' });
    }

    session.pendingControllerId = socket.id;
    session.controllerName = (controllerName || 'Remote Helper').slice(0, 40);
    socketToSession.set(socket.id, cleanId);

    io.to(session.hostSocketId).emit('host:incoming-request', {
      controllerId: socket.id,
      controllerName: session.controllerName,
      requestControl: Boolean(requestControl),
      timestamp: Date.now()
    });

    callback?.({
      ok: true,
      status: 'waiting-approval',
      hostName: session.hostName
    });
  });

  // 4. Host explicitly Approves or Declines the incoming connection request
  socket.on('host:respond-request', ({ controllerId, approved, allowControl }, callback) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || session.hostSocketId !== socket.id) {
      return callback?.({ ok: false, error: 'Unauthorized' });
    }

    if (session.pendingControllerId !== controllerId) {
      return callback?.({ ok: false, error: 'Request expired or cancelled' });
    }

    if (!approved) {
      session.pendingControllerId = null;
      session.controllerName = null;
      socketToSession.delete(controllerId);
      io.to(controllerId).emit('controller:request-declined', {
        reason: 'The host declined the connection request.'
      });
      return callback?.({ ok: true, approved: false });
    }

    session.pendingControllerId = null;
    session.controllerSocketId = controllerId;
    session.approved = true;
    session.permissions.allowControl = Boolean(allowControl);

    io.to(controllerId).emit('controller:request-approved', {
      sessionId: session.sessionId,
      hostName: session.hostName,
      permissions: session.permissions
    });

    callback?.({
      ok: true,
      approved: true,
      permissions: session.permissions
    });
  });

  // 5. Host updates live permissions
  socket.on('host:update-permissions', (newPermissions, callback) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || session.hostSocketId !== socket.id) {
      return callback?.({ ok: false, error: 'Unauthorized' });
    }

    session.permissions = {
      ...session.permissions,
      allowControl: Boolean(newPermissions?.allowControl),
      allowClipboard: newPermissions?.allowClipboard !== undefined ? Boolean(newPermissions.allowClipboard) : session.permissions.allowClipboard
    };

    if (session.controllerSocketId) {
      io.to(session.controllerSocketId).emit('session:permissions-updated', session.permissions);
    }

    callback?.({ ok: true, permissions: session.permissions });
  });

  // 6. WebRTC Signaling (Offer, Answer, ICE Candidates)
  socket.on('webrtc:offer', ({ offer }) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || !session.approved || session.hostSocketId !== socket.id || !session.controllerSocketId) return;
    io.to(session.controllerSocketId).emit('webrtc:offer', { offer });
  });

  socket.on('webrtc:answer', ({ answer }) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || !session.approved || session.controllerSocketId !== socket.id) return;
    io.to(session.hostSocketId).emit('webrtc:answer', { answer });
  });

  socket.on('webrtc:ice-candidate', ({ candidate }) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || !session.approved) return;

    const targetId = socket.id === session.hostSocketId ? session.controllerSocketId : session.hostSocketId;
    if (targetId) {
      io.to(targetId).emit('webrtc:ice-candidate', { candidate });
    }
  });

  // 7. Remote Input Events
  socket.on('control:input', (event) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || !session.approved || session.controllerSocketId !== socket.id) return;

    const isPointerVisualOnly = event && (event.type === 'pointer-move' || event.type === 'laser-ping');
    if (!isPointerVisualOnly && !session.permissions.allowControl) {
      return;
    }

    io.to(session.hostSocketId).emit('control:input', event);
  });

  // 8. Chat & Clipboard Sharing
  socket.on('session:chat', ({ text, kind = 'chat' }) => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session || !session.approved) return;

    const isHost = socket.id === session.hostSocketId;
    const senderName = isHost ? session.hostName : session.controllerName;
    const targetId = isHost ? session.controllerSocketId : session.hostSocketId;

    const payload = {
      sender: isHost ? 'host' : 'controller',
      senderName,
      text: String(text || '').slice(0, 4000),
      kind,
      timestamp: Date.now()
    };

    if (targetId) {
      io.to(targetId).emit('session:chat', payload);
    }
  });

  // 9. Explicit Session Disconnect
  socket.on('session:end', () => {
    const sessionId = socketToSession.get(socket.id);
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) return;

    if (socket.id === session.hostSocketId) {
      if (session.controllerSocketId) {
        io.to(session.controllerSocketId).emit('session:ended', {
          reason: 'The host ended the remote session.'
        });
        socketToSession.delete(session.controllerSocketId);
      }
      if (session.pendingControllerId) {
        io.to(session.pendingControllerId).emit('controller:request-declined', {
          reason: 'The host cancelled the session.'
        });
        socketToSession.delete(session.pendingControllerId);
      }
      session.controllerSocketId = null;
      session.controllerName = null;
      session.pendingControllerId = null;
      session.approved = false;
      session.permissions.allowControl = false;
      session.pin = generatePin();
      io.to(session.hostSocketId).emit('host:session-reset', {
        sessionId: session.sessionId,
        pin: session.pin
      });
    } else if (socket.id === session.controllerSocketId || socket.id === session.pendingControllerId) {
      io.to(session.hostSocketId).emit('session:ended', {
        reason: `${session.controllerName || 'Remote user'} disconnected.`
      });
      socketToSession.delete(socket.id);
      session.controllerSocketId = null;
      session.controllerName = null;
      session.pendingControllerId = null;
      session.approved = false;
      session.permissions.allowControl = false;
    }
  });

  socket.on('disconnect', () => {
    // Clean up any invite rooms owned by this socket
    for (const [roomCode, room] of inviteRooms.entries()) {
      if (room.controllerSocketId === socket.id) {
        inviteRooms.delete(roomCode);
      }
    }

    const sessionId = socketToSession.get(socket.id);
    if (!sessionId) return;
    socketToSession.delete(socket.id);

    const session = sessions.get(sessionId);
    if (!session) return;

    if (socket.id === session.hostSocketId) {
      if (session.controllerSocketId) {
        io.to(session.controllerSocketId).emit('session:ended', {
          reason: 'The host laptop closed the session.'
        });
        socketToSession.delete(session.controllerSocketId);
      }
      if (session.pendingControllerId) {
        io.to(session.pendingControllerId).emit('controller:request-declined', {
          reason: 'The host went offline.'
        });
        socketToSession.delete(session.pendingControllerId);
      }
      sessions.delete(sessionId);
    } else if (socket.id === session.controllerSocketId || socket.id === session.pendingControllerId) {
      io.to(session.hostSocketId).emit('session:ended', {
        reason: `${session.controllerName || 'Remote user'} disconnected.`
      });
      session.controllerSocketId = null;
      session.controllerName = null;
      session.pendingControllerId = null;
      session.approved = false;
      session.permissions.allowControl = false;
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('\n============================================================');
  console.log('  🛡️  Prashnaa — Consent-First Remote Support Server');
  console.log('============================================================');
  console.log(`  Your Controller Dashboard:  http://localhost:${PORT}/?mode=controller`);
  console.log(`  Simple Partner Page:        http://localhost:${PORT}/partner.html`);
  if (ips.length > 0) {
    ips.forEach((ip) => {
      console.log(`  Wi-Fi Partner Link:         http://${ip}:${PORT}/partner.html`);
    });
  }
  console.log('============================================================\n');
});
