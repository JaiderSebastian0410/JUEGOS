/* =========================================================
   Space Defender Pro — Multiplayer Server
   WebSocket-based room system for cooperative team play
   ========================================================= */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

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

// ---- WebSocket Server (Using ws library) ----
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  console.log('[WS] New WebSocket connection established');
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      handleMessage(ws, msg);
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', () => {
    handleDisconnect(ws);
  });
});

function wsSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(typeof data === 'string' ? data : JSON.stringify(data));
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
      if (room.players.size < 1) {
        wsSend(ws, JSON.stringify({ type: 'error', message: 'No hay jugadores en la sala.' }));
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

server.on('upgrade', (req, socket, head) => {
  console.log(`[UPGRADE] Request for: ${req.url}`);
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    console.log(`[UPGRADE] Rejected (invalid URL): ${req.url}`);
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
