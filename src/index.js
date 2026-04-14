const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// ==================
// 🧠 In-memory store
// ==================
const rooms = {};

function defaultSettings(roomId) {
  return {
    name: `NEON_ROOM_${roomId}`,
    maxPlayers: 8,
    rounds: 3,
    visibility: "public",
  };
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function normalizePlayer(data = {}) {
  return {
    id: data.id,
    username: data.username || "Player",
    avatar: data.avatar || "avatar-01",
    ready: Boolean(data.ready),
  };
}

// ==================
// 🔥 Socket Logic
// ==================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // 🎮 CREATE ROOM
  socket.on("create_room", ({ username, avatar, settings = {} }) => {
    const roomId = generateRoomId();

    const cleanSettings = {
      ...defaultSettings(roomId),
      name: settings.name || defaultSettings(roomId).name,
      maxPlayers: Math.min(Math.max(Number(settings.maxPlayers) || 8, 2), 8),
      rounds: Math.min(Math.max(Number(settings.rounds) || 3, 1), 10),
      visibility: settings.visibility === "private" ? "private" : "public",
    };

    const player = normalizePlayer({
      id: socket.id,
      username,
      avatar,
      ready: false,
    });

    rooms[roomId] = {
      players: [player],
      host: socket.id,
      settings: cleanSettings,
    };

    socket.join(roomId);

    console.log("Room created:", roomId);

    socket.emit("room_created", { roomId, settings: cleanSettings });
    io.to(roomId).emit("room_update", rooms[roomId]);
  });

  // 🎮 JOIN ROOM
  socket.on("join_room", ({ roomId, username, avatar }) => {
    if (!rooms[roomId]) {
      socket.emit("error", "Room not found");
      return;
    }

    if (!rooms[roomId].settings) {
      rooms[roomId].settings = defaultSettings(roomId);
    }

    if (rooms[roomId].players.length >= rooms[roomId].settings.maxPlayers) {
      socket.emit("error", "Room full");
      return;
    }

    socket.join(roomId);

    rooms[roomId].players.push(
      normalizePlayer({
        id: socket.id,
        username,
        avatar,
        ready: false,
      }),
    );

    console.log(`${username} joined ${roomId}`);

    io.to(roomId).emit("room_update", rooms[roomId]);
  });

  // 🧑‍🎨 UPDATE PROFILE (alias/avatar/ready)
  socket.on("update_profile", ({ roomId, username, avatar, ready }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("error", "Player not in room");
      return;
    }

    if (username) player.username = username;
    if (avatar) player.avatar = avatar;
    if (typeof ready === "boolean") player.ready = ready;

    io.to(roomId).emit("room_update", room);
  });

  // ✅ READY TO PLAY
  socket.on("set_ready", ({ roomId, ready }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) {
      socket.emit("error", "Player not in room");
      return;
    }

    player.ready = Boolean(ready);
    io.to(roomId).emit("room_update", room);
  });

  // 🏗️ EDIT ROOM SETTINGS (host only)
  socket.on("update_room_settings", ({ roomId, settings = {} }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }
    if (room.host !== socket.id) {
      socket.emit("error", "Only host can edit room");
      return;
    }

    const baseSettings = room.settings || defaultSettings(roomId);
    const next = {
      ...baseSettings,
      name: settings.name || baseSettings.name,
      maxPlayers: Math.min(
        Math.max(
          Number(settings.maxPlayers) || baseSettings.maxPlayers || 8,
          Math.max(room.players.length, 2),
        ),
        8,
      ),
      rounds: Math.min(
        Math.max(Number(settings.rounds) || baseSettings.rounds || 3, 1),
        10,
      ),
      visibility:
        settings.visibility === "private"
          ? "private"
          : settings.visibility === "public"
            ? "public"
            : baseSettings.visibility || "public",
    };

    room.settings = next;
    io.to(roomId).emit("room_update", room);
  });

  // 🚪 LEAVE ROOM (optional manual leave)
  socket.on("leave_room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    socket.leave(roomId);

    if (room.players.length === 0) {
      delete rooms[roomId];
      console.log("Room deleted:", roomId);
      return;
    }

    io.to(roomId).emit("room_update", room);
  });

  // 🎮 DISCONNECT
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // remove user from all rooms
    for (const roomId in rooms) {
      const room = rooms[roomId];

      room.players = room.players.filter((p) => p.id !== socket.id);

      // if room empty → delete it
      if (room.players.length === 0) {
        delete rooms[roomId];
        console.log("Room deleted:", roomId);
      } else {
        io.to(roomId).emit("room_update", room);
      }
    }
  });
});

// ==================
// 🌐 Routes
// ==================
app.get("/", (req, res) => {
  res.send("DoodleDash server running 🚀");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ==================
// 🚀 Server start
// ==================
const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
