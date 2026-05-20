'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:7337';
const ROOM_EXPIRY_MS = 10 * 60 * 1000;

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
});

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

function destroyRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.expiryTimer);
  rooms.delete(code);
  console.log(`[room:${code}] destroyed — reason: ${reason}`);

  // Only notify peers if it wasn't a clean post-transfer close
  if (reason !== 'complete' && reason !== 'peer_left_after_done') {
    io.to(code).emit('peer_disconnected', { code, reason });
  } else if (reason === 'expired') {
    io.to(code).emit('room_expired', { code });
  }
}

function scheduleExpiry(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.expiryTimer);
  room.expiryTimer = setTimeout(() => {
    if (rooms.has(code)) {
      console.log(`[room:${code}] expired`);
      destroyRoom(code, 'expired');
    }
  }, ROOM_EXPIRY_MS);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: process.uptime(), version : "1.0.0" });
});

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('create_room', ({ meta } = {}) => {
    const code = generateCode();
    const room = {
      code,
      sender: socket.id,
      receiver: null,
      meta: meta || null,
      state: 'waiting',
      expiryTimer: null,
    };
    rooms.set(code, room);
    scheduleExpiry(code);
    socket.join(code);
    socket.data.code = code;
    socket.data.role = 'sender';
    socket.emit('room_created', { code, meta });
    console.log(`[room:${code}] created by sender ${socket.id}`);
  });

  socket.on('join_room', ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit('room_error', { code, message: 'Room not found or expired.' });
      return;
    }
    if (room.receiver) {
      socket.emit('room_error', { code, message: 'Room already has a receiver.' });
      return;
    }
    room.receiver = socket.id;
    room.state = 'connected';
    clearTimeout(room.expiryTimer);
    room.expiryTimer = null;
    socket.join(code);
    socket.data.code = code;
    socket.data.role = 'receiver';
    console.log(`[room:${code}] receiver ${socket.id} joined`);
    io.to(code).emit('peer_ready', {
      code,
      meta: room.meta,
      sender: room.sender,
      receiver: room.receiver,
    });
  });

  socket.on('signal', ({ code, payload } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit('signal', { from: socket.id, payload });
  });

  socket.on('transfer_start', ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    room.state = 'transferring';
    socket.to(code).emit('transfer_start', { code });
    console.log(`[room:${code}] transfer started`);
  });

  socket.on('transfer_progress', ({ code, percent, bytes } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit('transfer_progress', { code, percent, bytes });
  });

  socket.on('transfer_complete', ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    room.state = 'done';
    console.log(`[room:${code}] transfer complete ✓`);
    io.to(code).emit('transfer_complete', { code });
    // Destroy silently after delay — no peer_disconnected emitted
    setTimeout(() => destroyRoom(code, 'complete'), 3000);
  });

  socket.on('cancel_transfer', ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    // If already done, treat as silent cleanup — not a cancellation
    if (room.state === 'done') {
      console.log(`[room:${code}] closed after completion by ${socket.id}`);
      destroyRoom(code, 'complete');
      return;
    }
    console.log(`[room:${code}] cancelled by ${socket.id}`);
    io.to(code).emit('peer_disconnected', { code, reason: 'cancelled' });
    destroyRoom(code, 'cancelled');
  });

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    const code = socket.data.code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (room.state === 'done') {
      // Clean disconnect after transfer — silent
      destroyRoom(code, 'peer_left_after_done');
    } else {
      destroyRoom(code, 'peer_left');
    }
  });
});

server.listen(PORT, () => {
  console.log(`✦ p2p-share signaling server running on http://localhost:${PORT}`);
  console.log(`  allowed origin: ${ALLOWED_ORIGIN}`);
});