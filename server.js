// ============================================================
// Caca Booth — Signaling Server
// Node.js + WebSocket (ws library)
// Deploy gratis ke Railway / Render / Glitch
// ============================================================

const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;

const wss = new WebSocketServer({ port: PORT });

// rooms: { roomCode: [ws1, ws2] }
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.userNum  = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ---- User 1: create a new room ----
      case 'create-room': {
        let code;
        do { code = generateRoomCode(); } while (rooms.has(code));
        rooms.set(code, [ws]);
        ws.roomCode = code;
        ws.userNum  = 1;
        send(ws, { type: 'room-created', code });
        console.log(`Room created: ${code}`);
        break;
      }

      // ---- User 2: join existing room ----
      case 'join-room': {
        const code = msg.code?.toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
          send(ws, { type: 'error', message: 'Room tidak ditemukan. Cek kodenya ya!' });
          return;
        }
        if (room.length >= 2) {
          send(ws, { type: 'error', message: 'Room sudah penuh (maks 2 orang).' });
          return;
        }

        room.push(ws);
        ws.roomCode = code;
        ws.userNum  = 2;

        // tell both parties they're connected
        send(room[0], { type: 'peer-joined', you: 1 });
        send(room[1], { type: 'peer-joined', you: 2 });
        console.log(`Room ${code}: 2 users connected`);
        break;
      }

      // ---- WebRTC signaling: offer / answer / ice-candidate ----
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        // forward to the OTHER peer
        const peer = room.find(p => p !== ws);
        if (peer) send(peer, msg);
        break;
      }

      // ---- Sync settings: layout, filter, theme, caption ----
      case 'sync-settings': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const peer = room.find(p => p !== ws);
        if (peer) send(peer, { type: 'sync-settings', settings: msg.settings });
        break;
      }

      // ---- Capture trigger: one user hits the shutter ----
      case 'trigger-capture': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        room.forEach(p => send(p, { type: 'do-capture', countdown: msg.countdown ?? 3 }));
        break;
      }

      // ---- A captured photo (base64) sent to peer ----
      case 'photo': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const peer = room.find(p => p !== ws);
        if (peer) send(peer, { type: 'peer-photo', dataUrl: msg.dataUrl, index: msg.index });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    // notify peer
    const peer = room.find(p => p !== ws);
    if (peer) send(peer, { type: 'peer-left' });

    // clean up room
    rooms.delete(ws.roomCode);
    console.log(`Room ${ws.roomCode} closed`);
  });
});

console.log(`✨ Caca Booth signaling server running on port ${PORT}`);
