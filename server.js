const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const levels = require("./shared/levels");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLeaderboard() {
  ensureDataDir();
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const raw = fs.readFileSync(LEADERBOARD_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Failed to read leaderboard file, starting empty", err);
  }
  return [];
}

function persistLeaderboard(entries) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(entries, null, 2));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const leaderboard = loadLeaderboard();
const lobbies = new Map();

function getTopLeaderboard(limit = 5) {
  return leaderboard.slice(0, limit);
}

function lobbyRoomId(id) {
  return `lobby:${id}`;
}

function summarizeLobby(lobby) {
  return {
    id: lobby.id,
    hostName: lobby.hostName,
    playerCount: lobby.players.length,
    maxPlayers: lobby.maxPlayers,
    status: lobby.status,
  };
}

function serializeLobby(lobby) {
  return {
    id: lobby.id,
    hostId: lobby.hostId,
    hostName: lobby.hostName,
    maxPlayers: lobby.maxPlayers,
    status: lobby.status,
    players: lobby.players.map((player) => ({
      id: player.id,
      name: player.name,
      spawnIndex: player.spawnIndex,
    })),
  };
}

function broadcastLobbyList() {
  io.emit(
    "lobbyList",
    Array.from(lobbies.values()).map((lobby) => summarizeLobby(lobby))
  );
}

function emitLeaderboard() {
  io.emit("leaderboard", getTopLeaderboard());
}

function generateLobbyId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let attempt = "";
  do {
    attempt = Array.from({ length: 4 }, () =>
      alphabet.charAt(Math.floor(Math.random() * alphabet.length))
    ).join("");
  } while (lobbies.has(attempt));
  return attempt;
}

function disbandLobby(lobby, message) {
  const room = lobbyRoomId(lobby.id);
  const players = [...lobby.players];
  lobbies.delete(lobby.id);
  players.forEach((player) => {
    const sock = io.sockets.sockets.get(player.id);
    if (sock) {
      sock.leave(room);
      sock.data.lobbyId = null;
      sock.emit("returnToMenu", {
        leaderboard: getTopLeaderboard(),
        message: message || null,
      });
    }
  });
  broadcastLobbyList();
}

function updateLobbyClients(lobby) {
  io.to(lobbyRoomId(lobby.id)).emit("lobbyUpdated", serializeLobby(lobby));
  broadcastLobbyList();
}

function startLobbyGame(lobby) {
  if (lobby.status === "inGame") {
    return;
  }
  if (lobby.players.length !== lobby.maxPlayers) {
    return;
  }
  const level = levels[0];
  lobby.status = "inGame";
  lobby.game = {
    levelIndex: 0,
    timerStarted: false,
    timerStartedAt: null,
    dotsCollected: new Set(),
    finished: false,
    completionTime: null,
  };
  lobby.players.forEach((player, index) => {
    player.spawnIndex = index % level.spawnPoints.length;
  });
  const payload = {
    lobby: serializeLobby(lobby),
    level,
  };
  lobby.players.forEach((player) => {
    const sock = io.sockets.sockets.get(player.id);
    if (sock) {
      sock.emit("gameStarted", payload);
    }
  });
  updateLobbyClients(lobby);
}

function finishGame(lobby) {
  if (!lobby.game || lobby.game.finished) {
    return;
  }
  const now = Date.now();
  if (!lobby.game.timerStarted) {
    lobby.game.timerStarted = true;
    lobby.game.timerStartedAt = now;
  }
  lobby.game.finished = true;
  lobby.game.completionTime = now - lobby.game.timerStartedAt;
  io.to(lobbyRoomId(lobby.id)).emit("gameCompleted", {
    timeMs: lobby.game.completionTime,
  });
}

function handlePlayerLeave(socket, { toMenu = false } = {}) {
  const lobbyId = socket.data.lobbyId;
  if (!lobbyId) {
    if (toMenu) {
      socket.emit("returnToMenu", { leaderboard: getTopLeaderboard() });
    }
    return;
  }
  const lobby = lobbies.get(lobbyId);
  socket.data.lobbyId = null;
  if (!lobby) {
    if (toMenu) {
      socket.emit("returnToMenu", { leaderboard: getTopLeaderboard() });
    }
    return;
  }
  const room = lobbyRoomId(lobby.id);
  socket.leave(room);
  lobby.players = lobby.players.filter((player) => player.id !== socket.id);
  if (lobby.players.length === 0) {
    lobbies.delete(lobby.id);
    broadcastLobbyList();
    return;
  }
  if (socket.id === lobby.hostId) {
    const newHost = lobby.players[0];
    lobby.hostId = newHost.id;
    lobby.hostName = newHost.name;
  }
  if (lobby.status === "inGame") {
    lobby.status = "waiting";
    lobby.game = null;
    io.to(room).emit("gameCancelled", { reason: "A player left." });
  }
  updateLobbyClients(lobby);
  if (toMenu) {
    socket.emit("returnToMenu", { leaderboard: getTopLeaderboard() });
  }
}

io.on("connection", (socket) => {
  socket.data = { name: null, lobbyId: null };
  socket.emit("initialData", {
    leaderboard: getTopLeaderboard(),
    lobbies: Array.from(lobbies.values()).map((lobby) => summarizeLobby(lobby)),
  });

  socket.on("createLobby", ({ name, maxPlayers }) => {
    if (socket.data.lobbyId) {
      socket.emit("errorMessage", {
        message: "Already in a lobby.",
      });
      return;
    }
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) {
      socket.emit("errorMessage", { message: "Please enter a name." });
      return;
    }
    const clamped = Math.min(Math.max(parseInt(maxPlayers, 10) || 1, 1), 3);
    const lobbyId = generateLobbyId();
    const lobby = {
      id: lobbyId,
      hostId: socket.id,
      hostName: trimmed,
      maxPlayers: clamped,
      status: "waiting",
      players: [
        {
          id: socket.id,
          name: trimmed,
          spawnIndex: 0,
        },
      ],
      game: null,
    };
    lobbies.set(lobbyId, lobby);
    socket.data.name = trimmed;
    socket.data.lobbyId = lobbyId;
    socket.join(lobbyRoomId(lobbyId));
    socket.emit("lobbyJoined", { lobby: serializeLobby(lobby) });
    updateLobbyClients(lobby);
  });

  socket.on("joinLobby", ({ name, lobbyId }) => {
    if (socket.data.lobbyId) {
      socket.emit("errorMessage", {
        message: "Already in a lobby.",
      });
      return;
    }
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.status !== "waiting") {
      socket.emit("errorMessage", {
        message: "Lobby is not available.",
      });
      return;
    }
    if (lobby.players.length >= lobby.maxPlayers) {
      socket.emit("errorMessage", {
        message: "Lobby is full.",
      });
      return;
    }
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) {
      socket.emit("errorMessage", { message: "Please enter a name." });
      return;
    }
    lobby.players.push({ id: socket.id, name: trimmed, spawnIndex: null });
    socket.data.name = trimmed;
    socket.data.lobbyId = lobbyId;
    socket.join(lobbyRoomId(lobbyId));
    socket.emit("lobbyJoined", { lobby: serializeLobby(lobby) });
    updateLobbyClients(lobby);
  });

  socket.on("leaveLobby", () => {
    handlePlayerLeave(socket, { toMenu: true });
  });

  socket.on("startGame", () => {
    const lobbyId = socket.data.lobbyId;
    if (!lobbyId) {
      return;
    }
    const lobby = lobbies.get(lobbyId);
    if (!lobby) {
      return;
    }
    if (lobby.hostId !== socket.id) {
      socket.emit("errorMessage", { message: "Only the leader can start." });
      return;
    }
    if (lobby.players.length !== lobby.maxPlayers) {
      socket.emit("errorMessage", {
        message: "Wait until the lobby is full.",
      });
      return;
    }
    startLobbyGame(lobby);
  });

  socket.on("playerState", (payload) => {
    const lobbyId = socket.data.lobbyId;
    if (!lobbyId) {
      return;
    }
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.status !== "inGame" || !lobby.game) {
      return;
    }
    const room = lobbyRoomId(lobby.id);
    socket.to(room).emit("playerState", {
      id: socket.id,
      position: payload.position,
      velocity: payload.velocity,
    });
    if (!lobby.game.timerStarted && payload.moving) {
      lobby.game.timerStarted = true;
      lobby.game.timerStartedAt = Date.now();
      io.to(room).emit("timerStarted", {
        startTime: lobby.game.timerStartedAt,
      });
    }
  });

  socket.on("collectDot", ({ dotId }) => {
    const lobbyId = socket.data.lobbyId;
    if (!lobbyId) {
      return;
    }
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.status !== "inGame" || !lobby.game) {
      return;
    }
    const level = levels[lobby.game.levelIndex];
    const dot = level.dots.find((entry) => entry.id === dotId);
    if (!dot || lobby.game.dotsCollected.has(dotId)) {
      return;
    }
    lobby.game.dotsCollected.add(dotId);
    io.to(lobbyRoomId(lobby.id)).emit("dotCollected", { dotId });
    if (lobby.game.dotsCollected.size === level.dots.length) {
      finishGame(lobby);
    }
  });

  socket.on("submitScore", ({ teamName }) => {
    const lobbyId = socket.data.lobbyId;
    if (!lobbyId) {
      return;
    }
    const lobby = lobbies.get(lobbyId);
    if (!lobby || lobby.hostId !== socket.id || !lobby.game) {
      return;
    }
    if (!lobby.game.finished || lobby.game.completionTime == null) {
      socket.emit("errorMessage", { message: "Finish the run first." });
      return;
    }
    const trimmed = typeof teamName === "string" ? teamName.trim() : "";
    if (!trimmed) {
      socket.emit("errorMessage", { message: "Enter a team name." });
      return;
    }
    const entry = {
      teamName: trimmed.substring(0, 24),
      timeMs: lobby.game.completionTime,
      playerCount: lobby.players.length,
      recordedAt: new Date().toISOString(),
    };
    leaderboard.push(entry);
    leaderboard.sort((a, b) => a.timeMs - b.timeMs);
    while (leaderboard.length > 5) {
      leaderboard.pop();
    }
    persistLeaderboard(leaderboard);
    emitLeaderboard();
    disbandLobby(lobby, "Score recorded! Returning to menu.");
  });

  socket.on("disconnect", () => {
    handlePlayerLeave(socket, { toMenu: false });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
