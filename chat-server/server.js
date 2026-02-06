const WebSocket = require("ws");
const { v4: uuid } = require("uuid");
const bcrypt = require("bcryptjs");

const PORT = 3001;
const wss = new WebSocket.Server({ port: PORT });

const privateRooms = new Map();

console.log("🧠 Chatty server avviato su ws://localhost:" + PORT);

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload) {
  room.users.forEach(ws => send(ws, payload));
}

function destroyRoom(roomName) {
  if (!roomName) return;
  const room = privateRooms.get(roomName);
  if (!room) return;

  broadcast(room, { type: "closed" });
  room.users.forEach(ws => {
    try { ws.close(); } catch {}
  });

  privateRooms.delete(roomName);
}

wss.on("connection", ws => {
  const userId = uuid();
  let currentRoom = null;

  ws.on("message", async raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    // CREA CHAT
    if (data.type === "create_private") {
      const room = String(data.room || "").trim();
      const password = String(data.password || "");

      if (!room || !password) {
        return send(ws, { type: "error", message: "Inserisci nome e password" });
      }

      if (privateRooms.has(room)) {
        return send(ws, { type: "error", message: "Chat già esistente" });
      }

      const hash = await bcrypt.hash(password, 8);

      privateRooms.set(room, {
        passwordHash: hash,
        users: new Map([[userId, ws]]),
        currentMessage: null
      });

      currentRoom = room;

      send(ws, { type: "joined_private", room });
      broadcast(privateRooms.get(room), {
        type: "status_private",
        room,
        users: 1,
        max: 2
      });
      return;
    }

    // ENTRA CHAT
    if (data.type === "join_private") {
      const room = String(data.room || "").trim();
      const password = String(data.password || "");

      const r = privateRooms.get(room);
      if (!r) {
        return send(ws, { type: "error", message: "Chat non trovata" });
      }

      if (r.users.size >= 2) {
        return send(ws, { type: "error", message: "Chat piena" });
      }

      const ok = await bcrypt.compare(password, r.passwordHash);
      if (!ok) {
        return send(ws, { type: "error", message: "Password errata" });
      }

      r.users.set(userId, ws);
      currentRoom = room;

      send(ws, { type: "joined_private", room });
      broadcast(r, {
        type: "status_private",
        room,
        users: r.users.size,
        max: 2
      });

      if (r.users.size === 2) {
        broadcast(r, { type: "start" });
      }
      return;
    }

    // MESSAGGIO (1 alla volta)
    if (data.type === "message_private") {
      if (!currentRoom) return;

      const r = privateRooms.get(currentRoom);
      if (!r) return;

      const text = String(data.text || "").trim();
      if (!text) return;

      r.currentMessage = text;
      broadcast(r, { type: "message", text });
      return;
    }

    // USCITA
    if (data.type === "leave_private") {
      destroyRoom(currentRoom);
      currentRoom = null;
      return;
    }
  });

  ws.on("close", () => {
    destroyRoom(currentRoom);
    currentRoom = null;
  });
});

