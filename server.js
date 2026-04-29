/* =========================================================
   Space Defender Pro — Multiplayer Server
   WebSocket-based room system for cooperative team play
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- HTTP Static File Server ----
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const BASE_DIR = __dirname;

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/juego.html';

  const filePath = path.join(BASE_DIR, urlPath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  // Security: prevent directory traversal
  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---- WebSocket Server (Manual, no dependencies) ----
const rooms = new Map(); // roomId -> Room
const clients = new Map(); // ws -> ClientInfo

function generateRoomId() {
  // 6-character alphanumeric room code
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generatePlayerId() {
  return crypto.randomBytes(4).toString('hex');
}

class Room {
  constructor(id, hostId) {
    this.id = id;
    this.hostId = hostId;
    this.players = new Map(); // playerId -> { ws, name, ready }
    this.gameStarted = false;
    this.difficulty = 'medio';
    this.createdAt = Date.now();
  }

  broadcast(msg, excludeId = null) {
    const data = JSON.stringify(msg);
    for (const [pid, p] of this.players) {
      if (pid !== excludeId && p.ws && p.ws.readyState === 1) {
        wsSend(p.ws, data);
      }
    }
  }

  getPlayerList() {
    const list = [];
    for (const [pid, p] of this.players) {
      list.push({ id: pid, name: p.name, isHost: pid === this.hostId });
    }
    return list;
  }
}

// ---- Raw WebSocket Implementation ----
function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB9FC6B06AE')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
    '\r\n'
  );

  const ws = {
    socket,
    readyState: 1, // OPEN
    _buffer: Buffer.alloc(0),
  };

  socket.on('data', (data) => {
    ws._buffer = Buffer.concat([ws._buffer, data]);
    while (ws._buffer.length >= 2) {
      const frame = parseFrame(ws._buffer);
      if (!frame) break;
      ws._buffer = ws._buffer.slice(frame.totalLength);

      if (frame.opcode === 0x8) {
        // Close
        ws.readyState = 3;
        socket.end();
        handleDisconnect(ws);
        return;
      }
      if (frame.opcode === 0x9) {
        // Ping -> Pong
        sendFrame(socket, frame.payload, 0xA);
        continue;
      }
      if (frame.opcode === 0x1) {
        // Text
        try {
          const msg = JSON.parse(frame.payload.toString('utf8'));
          handleMessage(ws, msg);
        } catch (e) { /* ignore malformed */ }
      }
    }
  });

  socket.on('close', () => {
    ws.readyState = 3;
    handleDisconnect(ws);
  });

  socket.on('error', () => {
    ws.readyState = 3;
    handleDisconnect(ws);
  });
}

function parseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0F;
  const masked = !!(buf[1] & 0x80);
  let payloadLen = buf[1] & 0x7F;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskSize = masked ? 4 : 0;
  const totalLength = offset + maskSize + payloadLen;
  if (buf.length < totalLength) return null;

  let payload = Buffer.from(buf.slice(offset + maskSize, totalLength));
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, totalLength };
}

function sendFrame(socket, data, opcode = 0x1) {
  if (!socket.writable) return;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function wsSend(ws, data) {
  if (ws.readyState === 1) {
    sendFrame(ws.socket, data);
  }
}

// ---- Message Handlers ----
function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create_room': {
      const playerId = generatePlayerId();
      const roomId = generateRoomId();
      const room = new Room(roomId, playerId);
      const name = (msg.name || 'Piloto 1').substring(0, 20);
      room.players.set(playerId, { ws, name, ready: false });
      rooms.set(roomId, room);
      clients.set(ws, { playerId, roomId });

      wsSend(ws, JSON.stringify({
        type: 'room_created',
        roomId,
        playerId,
        players: room.getPlayerList(),
      }));
      console.log(`[ROOM] Created ${roomId} by ${name} (${playerId})`);
      break;
    }

    case 'join_room': {
      const roomId = (msg.roomId || '').toUpperCase().trim();
      const room = rooms.get(roomId);
      if (!room) {
        wsSend(ws, JSON.stringify({ type: 'error', message: 'Sala no encontrada. Verifica el código.' }));
        return;
      }
      if (room.gameStarted) {
        wsSend(ws, JSON.stringify({ type: 'error', message: 'La partida ya está en curso.' }));
        return;
      }
      if (room.players.size >= 4) {
        wsSend(ws, JSON.stringify({ type: 'error', message: 'La sala está llena (máx. 4 jugadores).' }));
        return;
      }

      const playerId = generatePlayerId();
      const name = (msg.name || `Piloto ${room.players.size + 1}`).substring(0, 20);
      room.players.set(playerId, { ws, name, ready: false });
      clients.set(ws, { playerId, roomId });

      wsSend(ws, JSON.stringify({
        type: 'room_joined',
        roomId,
        playerId,
        hostId: room.hostId,
        players: room.getPlayerList(),
        difficulty: room.difficulty,
      }));

      room.broadcast({
        type: 'player_joined',
        players: room.getPlayerList(),
        newPlayer: { id: playerId, name },
      }, playerId);

      console.log(`[ROOM] ${name} joined ${roomId}`);
      break;
    }

    case 'set_difficulty': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room || info.playerId !== room.hostId) return;
      room.difficulty = msg.difficulty || 'medio';
      room.broadcast({
        type: 'difficulty_changed',
        difficulty: room.difficulty,
      });
      break;
    }

    case 'start_game': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room || info.playerId !== room.hostId) return;
      if (room.players.size < 2) {
        wsSend(ws, JSON.stringify({ type: 'error', message: 'Se necesitan al menos 2 jugadores.' }));
        return;
      }
      room.gameStarted = true;
      room.broadcast({
        type: 'game_start',
        difficulty: room.difficulty,
        players: room.getPlayerList(),
      });
      console.log(`[GAME] Started in room ${info.roomId}`);
      break;
    }

    case 'player_state': {
      // Relay player position/angle/state to other players
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;
      room.broadcast({
        type: 'player_state',
        id: info.playerId,
        x: msg.x,
        y: msg.y,
        angle: msg.angle,
        skin: msg.skin,
        powers: msg.powers,
        shield: msg.shield,
        vida: msg.vida,
      }, info.playerId);
      break;
    }

    case 'player_shoot': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;
      room.broadcast({
        type: 'player_shoot',
        id: info.playerId,
        x: msg.x, y: msg.y,
        dx: msg.dx, dy: msg.dy,
        color: msg.color,
        source: msg.source,
      }, info.playerId);
      break;
    }

    case 'enemy_killed': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;
      room.broadcast({
        type: 'enemy_killed',
        id: info.playerId,
        enemyX: msg.enemyX,
        enemyY: msg.enemyY,
        pts: msg.pts,
        color: msg.color,
      }, info.playerId);
      break;
    }

    case 'player_died': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;
      room.broadcast({
        type: 'player_died',
        id: info.playerId,
        name: msg.name,
      }, info.playerId);
      break;
    }

    case 'game_over': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;
      room.broadcast({
        type: 'game_over',
        score: msg.score,
        kills: msg.kills,
        time: msg.time,
      });
      room.gameStarted = false;
      break;
    }

    case 'chat': {
      const info = clients.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;
      const player = room.players.get(info.playerId);
      room.broadcast({
        type: 'chat',
        name: player ? player.name : 'Anónimo',
        message: (msg.message || '').substring(0, 200),
      });
      break;
    }

    case 'ping': {
      wsSend(ws, JSON.stringify({ type: 'pong', t: msg.t }));
      break;
    }

    default:
      break;
  }
}

function handleDisconnect(ws) {
  const info = clients.get(ws);
  if (!info) return;
  clients.delete(ws);

  const room = rooms.get(info.roomId);
  if (!room) return;

  const player = room.players.get(info.playerId);
  const playerName = player ? player.name : 'Desconocido';
  room.players.delete(info.playerId);

  if (room.players.size === 0) {
    rooms.delete(info.roomId);
    console.log(`[ROOM] Deleted empty room ${info.roomId}`);
    return;
  }

  // If host left, transfer host
  if (info.playerId === room.hostId) {
    const newHostId = room.players.keys().next().value;
    room.hostId = newHostId;
    room.broadcast({
      type: 'host_changed',
      hostId: newHostId,
      players: room.getPlayerList(),
    });
    console.log(`[ROOM] Host transferred in ${info.roomId} to ${newHostId}`);
  }

  room.broadcast({
    type: 'player_left',
    id: info.playerId,
    name: playerName,
    players: room.getPlayerList(),
  });

  console.log(`[ROOM] ${playerName} left ${info.roomId}`);
}

// ---- Upgrade HTTP to WebSocket ----
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    acceptWebSocket(req, socket);
  } else {
    socket.destroy();
  }
});

// ---- Periodic cleanup of stale rooms ----
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    // Remove rooms older than 2 hours with no active game
    if (!room.gameStarted && now - room.createdAt > 2 * 60 * 60 * 1000) {
      rooms.delete(id);
      console.log(`[CLEANUP] Removed stale room ${id}`);
    }
  }
}, 60000);

// ---- Start Server ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Space Defender Pro — Multiplayer Server`);
  console.log(`   HTTP:      http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Listo para conexiones.\n`);
});
