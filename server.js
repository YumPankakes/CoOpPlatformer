const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const levels = require("./shared/levels");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboard.json");

const abilityDefinitions = [
  { id: "phase", name: "Phase Walker", color: "#f06292" },
  { id: "dash", name: "Dash Sprinter", color: "#64ffda" },
  { id: "ceiling", name: "Ceiling Walker", color: "#7986cb" },
];

function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn("Unable to read leaderboard file, starting fresh", err);
  }
  return [];
}

function persistLeaderboard(entries) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(entries, null, 2), "utf8");
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use("/shared", express.static(path.join(__dirname, "shared")));

const leaderboard = loadLeaderboard();

let players = {};
let currentLevelIndex = 0;
let levelStartTime = Date.now();
let levelActive = false;

function getCurrentLevel() {
  return levels[currentLevelIndex];
}

function availableAbility() {
  const taken = new Set(
    Object.values(players)
      .filter((p) => !p.spectator)
      .map((p) => p.ability)
  );
  return abilityDefinitions.find((ability) => !taken.has(ability.id)) || null;
}

function spawnPositionFor(player) {
  const level = getCurrentLevel();
  if (!player || player.spawnIndex == null) {
    return { x: level.spawnPoints[0].x, y: level.spawnPoints[0].y };
  }
  const spawn = level.spawnPoints[player.spawnIndex] || level.spawnPoints[0];
  return { x: spawn.x, y: spawn.y };
}

function resetPlayerState(player) {
  const spawn = spawnPositionFor(player);
  player.position = { x: spawn.x, y: spawn.y };
  player.velocity = { x: 0, y: 0 };
  player.goalReached = false;
  player.abilityUsed = false;
}

function resetLevel() {
  const level = getCurrentLevel();
  levelStartTime = Date.now();
  levelActive = true;
  Object.values(players).forEach((player) => resetPlayerState(player));
  io.emit("levelReset", {
    level,
    startTime: levelStartTime,
    players: sanitizedPlayers(),
    leaderboard,
  });
  console.log(`Level ${level.id} reset.`);
}

function sanitizedPlayers() {
  return Object.values(players).map((player) => ({
    id: player.id,
    ability: player.ability,
    abilityName: player.abilityName,
    color: player.color,
    position: player.position,
    velocity: player.velocity,
    abilityUsed: player.abilityUsed,
    goalReached: player.goalReached,
    spectator: player.spectator,
  }));
}

function completeLevel() {
  if (!levelActive) {
    return;
  }
  levelActive = false;
  const completionTime = Date.now() - levelStartTime;
  const entry = {
    levelId: getCurrentLevel().id,
    timeMs: completionTime,
    players: Object.values(players)
      .filter((p) => !p.spectator)
      .map((p) => p.abilityName),
    recordedAt: new Date().toISOString(),
  };
  leaderboard.push(entry);
  leaderboard.sort((a, b) => a.timeMs - b.timeMs);
  while (leaderboard.length > 5) {
    leaderboard.pop();
  }
  persistLeaderboard(leaderboard);
  io.emit("levelComplete", {
    timeMs: completionTime,
    leaderboard,
  });
  console.log(`Level completed in ${(completionTime / 1000).toFixed(2)}s`);
  setTimeout(() => {
    resetLevel();
  }, 5000);
}

io.on("connection", (socket) => {
  console.log("Player connected", socket.id);
  const ability = availableAbility();
  const spectator = !ability;

  const spawnIndex = ability
    ? abilityDefinitions.findIndex((a) => a.id === ability.id)
    : null;
  const player = {
    id: socket.id,
    ability: ability ? ability.id : null,
    abilityName: ability ? ability.name : "Spectator",
    color: ability ? ability.color : "#ffffff",
    spawnIndex,
    abilityUsed: false,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    goalReached: false,
    spectator,
  };
  players[socket.id] = player;
  resetPlayerState(player);

  socket.emit("initialState", {
    playerId: socket.id,
    self: player,
    players: sanitizedPlayers(),
    level: getCurrentLevel(),
    startTime: levelStartTime,
    leaderboard,
  });
  socket.broadcast.emit("playerJoined", { player: player });

  if (!levelActive) {
    resetLevel();
  } else {
    socket.emit("levelReset", {
      level: getCurrentLevel(),
      startTime: levelStartTime,
      players: sanitizedPlayers(),
      leaderboard,
    });
  }

  socket.on("playerUpdate", (state) => {
    const current = players[socket.id];
    if (!current) {
      return;
    }
    current.position = state.position;
    current.velocity = state.velocity;
    current.goalReached = Boolean(state.goalReached);
    socket.broadcast.emit("playerState", {
      id: socket.id,
      position: current.position,
      velocity: current.velocity,
      goalReached: current.goalReached,
    });

    const activePlayers = Object.values(players).filter((p) => !p.spectator);
    if (
      levelActive &&
      activePlayers.length === abilityDefinitions.length &&
      activePlayers.every((p) => p.goalReached)
    ) {
      completeLevel();
    }
  });

  socket.on("requestAbility", () => {
    const current = players[socket.id];
    if (!current || current.spectator) {
      return;
    }
    if (current.abilityUsed || !levelActive) {
      socket.emit("abilityDenied", { reason: "Ability already used." });
      return;
    }
    current.abilityUsed = true;
    socket.emit("abilityActivated", { ability: current.ability });
    socket.broadcast.emit("abilityStatus", {
      id: socket.id,
      ability: current.ability,
    });
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected", socket.id);
    delete players[socket.id];
    socket.broadcast.emit("playerLeft", { id: socket.id });
    const activePlayers = Object.values(players).filter((p) => !p.spectator);
    if (activePlayers.length < abilityDefinitions.length) {
      levelActive = false;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
