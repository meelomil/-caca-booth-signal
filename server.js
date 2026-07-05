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

        // cek slot null (user yang disconnect) — izinkan rejoin
        const emptySlot = room.findIndex(p => p === null || !p || p.readyState !== (p.OPEN ?? 1));
        const activeCount = room.filter(p => p && p.readyState === (p.OPEN ?? 1)).length;

        if (activeCount >= 2 && emptySlot === -1) {
          send(ws, { type: 'error', message: 'Room sudah penuh (maks 2 orang).' });
          return;
        }

        if (emptySlot !== -1) {
          // isi slot yang kosong
          room[emptySlot] = ws;
          ws.roomCode = code;
          ws.userNum  = emptySlot + 1;
        } else {
          // slot baru
          room.push(ws);
          ws.roomCode = code;
          ws.userNum  = room.length;
        }

        // beritahu semua yang aktif
        const active = room.filter(p => p && p.readyState === (p.OPEN ?? 1));
        active.forEach((p, i) => {
          send(p, { type: 'peer-joined', you: room.indexOf(p) + 1 });
        });

        console.log(`Room ${code}: user ${ws.userNum} joined/rejoined`);
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

      // ---- Chat message relay ----
      case 'chat-message': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const peer = room.find(p => p !== ws);
        if (peer) send(peer, {
          type: 'chat-message',
          text: msg.text,
          from: ws.userNum,
          time: new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }),
        });
        break;
      }

      // ---- Request settings dari peer ----
      case 'request-settings': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const peer = room.find(p => p && p !== ws);
        if (peer) send(peer, { type: 'request-settings' });
        break;
      }

      // ---- Capture trigger: one user hits the shutter ----
      case 'trigger-capture': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        // forward ke peer saja (bukan broadcast ke semua termasuk pengirim)
        const peer = room.find(p => p !== ws);
        if (peer) send(peer, {
          type: 'do-capture',
          countdown: msg.countdown ?? 3,
          startAt: msg.startAt,   // teruskan timestamp untuk sinkronisasi
        });
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

    // tandai slot user ini sebagai null (disconnected) bukan hapus room
    const idx = room.indexOf(ws);
    if (idx !== -1) room[idx] = null;

    // notify peer bahwa user disconnect sementara
    const peer = room.find(p => p && p !== ws);
    if (peer) send(peer, { type: 'peer-left', roomCode: ws.roomCode });

    console.log(`User ${ws.userNum} disconnect dari room ${ws.roomCode}`);

    // hapus room setelah 60 detik kalau tidak ada yang reconnect
    setTimeout(() => {
      const r = rooms.get(ws.roomCode);
      if (!r) return;
      const stillActive = r.filter(p => p && p.readyState === p.OPEN);
      if (stillActive.length === 0) {
        rooms.delete(ws.roomCode);
        console.log(`Room ${ws.roomCode} dihapus (kosong)`);
      }
    }, 60000);
  });
});

console.log(`✨ Caca Booth signaling server running on port ${PORT}`);
