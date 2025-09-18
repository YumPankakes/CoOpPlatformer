diff --git a//dev/null b/server.js
index 0000000000000000000000000000000000000000..1cad903c703c4f674deef8d409ffc041086bddcd 100644
--- a//dev/null
+++ b/server.js
@@ -0,0 +1,429 @@
+const express = require("express");
+const http = require("http");
+const path = require("path");
+const fs = require("fs");
+const { Server } = require("socket.io");
+
+const levels = require("./shared/levels");
+
+const PORT = process.env.PORT || 3000;
+const DATA_DIR = path.join(__dirname, "data");
+const LEADERBOARD_FILE = path.join(DATA_DIR, "leaderboard.json");
+const MAX_PLAYERS = 3;
+
+const PLAYER_SIZE = { width: 32, height: 48 };
+
+const ABILITIES = [
+  {
+    id: "phase-walker",
+    name: "Phase Walker",
+    description: "Pass through one wall once per level.",
+  },
+  {
+    id: "dash-sprinter",
+    name: "Dash Sprinter",
+    description: "Dash forward across obstacles once per level.",
+  },
+  {
+    id: "ceiling-walker",
+    name: "Ceiling Walker",
+    description: "Flip gravity once per level to walk on ceilings.",
+  },
+];
+
+function ensureDataDir() {
+  if (!fs.existsSync(DATA_DIR)) {
+    fs.mkdirSync(DATA_DIR, { recursive: true });
+  }
+}
+
+function loadLeaderboard() {
+  ensureDataDir();
+  try {
+    if (fs.existsSync(LEADERBOARD_FILE)) {
+      const raw = fs.readFileSync(LEADERBOARD_FILE, "utf8");
+      const parsed = JSON.parse(raw);
+      if (Array.isArray(parsed)) {
+        return parsed;
+      }
+    }
+  } catch (err) {
+    console.warn("Unable to parse leaderboard file, starting empty", err);
+  }
+  return [];
+}
+
+function persistLeaderboard(entries) {
+  ensureDataDir();
+  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(entries, null, 2));
+}
+
+const app = express();
+const server = http.createServer(app);
+const io = new Server(server);
+
+app.use(express.static(path.join(__dirname, "public")));
+
+const leaderboard = loadLeaderboard();
+const players = new Map(); // socketId -> player state
+
+const gameState = {
+  levelIndex: 0,
+  waitingForPlayers: true,
+  timerRunning: false,
+  timerStartedAt: null,
+  completed: false,
+  completionTime: null,
+  resetTimeout: null,
+};
+
+function currentLevel() {
+  return levels[gameState.levelIndex];
+}
+
+function sortedPlayers() {
+  return Array.from(players.values()).sort((a, b) => a.spawnIndex - b.spawnIndex);
+}
+
+function serializePlayer(player) {
+  return {
+    id: player.id,
+    name: player.name,
+    abilityId: player.abilityId,
+    abilityName: player.abilityName,
+    abilityDescription: player.abilityDescription,
+    abilityUsed: player.abilityUsed,
+    reachedGoal: player.reachedGoal,
+    position: player.position,
+    velocity: player.velocity,
+    spawnIndex: player.spawnIndex,
+    facing: player.facing,
+  };
+}
+
+function sessionSnapshot() {
+  return {
+    levelIndex: gameState.levelIndex,
+    waitingForPlayers: gameState.waitingForPlayers,
+    timerRunning: gameState.timerRunning,
+    timerStartedAt: gameState.timerStartedAt,
+    completed: gameState.completed,
+    completionTime: gameState.completionTime,
+    players: sortedPlayers().map((player) => serializePlayer(player)),
+  };
+}
+
+function getTopLeaderboard(limit = 5) {
+  return leaderboard.slice(0, limit);
+}
+
+function broadcastSession(extra = {}) {
+  io.emit("sessionUpdate", { session: sessionSnapshot(), ...extra });
+}
+
+function clearResetTimeout() {
+  if (gameState.resetTimeout) {
+    clearTimeout(gameState.resetTimeout);
+    gameState.resetTimeout = null;
+  }
+}
+
+function nextAvailableAbility() {
+  const taken = new Set(Array.from(players.values()).map((p) => p.abilityId));
+  return ABILITIES.find((ability) => !taken.has(ability.id));
+}
+
+function preparePlayersForRun() {
+  const level = currentLevel();
+  const spawnPoints = level.spawnPoints;
+  let index = 0;
+  for (const player of sortedPlayers()) {
+    const spawn = spawnPoints[index % spawnPoints.length];
+    player.spawnIndex = index;
+    player.position = { x: spawn.x, y: spawn.y };
+    player.velocity = { x: 0, y: 0 };
+    player.facing = 1;
+    player.abilityUsed = false;
+    player.reachedGoal = false;
+    player.lastAbilityContext = null;
+    index += 1;
+  }
+}
+
+function startRun() {
+  clearResetTimeout();
+  gameState.waitingForPlayers = false;
+  gameState.timerRunning = false;
+  gameState.timerStartedAt = null;
+  gameState.completed = false;
+  gameState.completionTime = null;
+  preparePlayersForRun();
+  io.emit("runReset", {
+    session: sessionSnapshot(),
+    leaderboard: getTopLeaderboard(),
+    message: "All players ready!"
+  });
+  broadcastSession();
+}
+
+function abortRun(reason) {
+  clearResetTimeout();
+  gameState.waitingForPlayers = true;
+  gameState.timerRunning = false;
+  gameState.timerStartedAt = null;
+  gameState.completed = false;
+  gameState.completionTime = null;
+  preparePlayersForRun();
+  io.emit("runReset", {
+    session: sessionSnapshot(),
+    leaderboard: getTopLeaderboard(),
+    message: reason || "Waiting for players...",
+  });
+  broadcastSession();
+}
+
+function teamLabel() {
+  if (players.size === 0) {
+    return "Unknown Team";
+  }
+  return sortedPlayers()
+    .map((player) => player.name)
+    .join(" / ");
+}
+
+function scheduleReset() {
+  clearResetTimeout();
+  gameState.resetTimeout = setTimeout(() => {
+    if (players.size === MAX_PLAYERS) {
+      startRun();
+    } else {
+      abortRun("Waiting for players...");
+    }
+  }, 5000);
+}
+
+function recordLeaderboardEntry(timeMs) {
+  const entry = {
+    teamName: teamLabel(),
+    timeMs,
+    recordedAt: new Date().toISOString(),
+  };
+  leaderboard.push(entry);
+  leaderboard.sort((a, b) => a.timeMs - b.timeMs);
+  while (leaderboard.length > 5) {
+    leaderboard.pop();
+  }
+  persistLeaderboard(leaderboard);
+}
+
+function completeRun() {
+  if (gameState.completed) {
+    return;
+  }
+  const now = Date.now();
+  const startTime = gameState.timerStartedAt || now;
+  const timeMs = now - startTime;
+  gameState.timerRunning = false;
+  gameState.completed = true;
+  gameState.completionTime = timeMs;
+  recordLeaderboardEntry(timeMs);
+  io.emit("runCompleted", {
+    timeMs,
+    leaderboard: getTopLeaderboard(),
+    teamName: teamLabel(),
+  });
+  broadcastSession();
+  scheduleReset();
+}
+
+function maybeStartTimer() {
+  if (!gameState.timerRunning && !gameState.waitingForPlayers) {
+    gameState.timerRunning = true;
+    gameState.timerStartedAt = Date.now();
+    io.emit("timerStarted", { startTime: gameState.timerStartedAt });
+    broadcastSession();
+  }
+}
+
+function rectsIntersect(a, b) {
+  return (
+    a.x < b.x + b.width &&
+    a.x + a.width > b.x &&
+    a.y < b.y + b.height &&
+    a.height + a.y > b.y
+  );
+}
+
+function checkGoalForPlayer(player) {
+  const level = currentLevel();
+  if (!level.goal) {
+    return;
+  }
+  const playerRect = {
+    x: player.position.x,
+    y: player.position.y,
+    width: PLAYER_SIZE.width,
+    height: PLAYER_SIZE.height,
+  };
+  const goalRect = {
+    x: level.goal.x,
+    y: level.goal.y,
+    width: level.goal.width,
+    height: level.goal.height,
+  };
+  const wasAtGoal = player.reachedGoal;
+  if (rectsIntersect(playerRect, goalRect)) {
+    player.reachedGoal = true;
+  }
+  if (!wasAtGoal && player.reachedGoal) {
+    broadcastSession();
+  }
+  const readyPlayers = sortedPlayers();
+  if (
+    readyPlayers.length === MAX_PLAYERS &&
+    readyPlayers.every((p) => p.reachedGoal)
+  ) {
+    completeRun();
+  }
+}
+
+io.on("connection", (socket) => {
+  socket.emit("initialData", {
+    abilities: ABILITIES,
+    level: currentLevel(),
+    leaderboard: getTopLeaderboard(),
+    session: sessionSnapshot(),
+  });
+
+  socket.on("registerPlayer", ({ name }) => {
+    if (players.has(socket.id)) {
+      return;
+    }
+    const trimmed = typeof name === "string" ? name.trim() : "";
+    if (!trimmed) {
+      socket.emit("joinRejected", {
+        reason: "Please enter a display name.",
+      });
+      return;
+    }
+    if (players.size >= MAX_PLAYERS) {
+      socket.emit("joinRejected", {
+        reason: "Session already has three players.",
+      });
+      return;
+    }
+    const ability = nextAvailableAbility();
+    if (!ability) {
+      socket.emit("joinRejected", {
+        reason: "No abilities available. Please wait.",
+      });
+      return;
+    }
+    const player = {
+      id: socket.id,
+      name: trimmed.substring(0, 20),
+      abilityId: ability.id,
+      abilityName: ability.name,
+      abilityDescription: ability.description,
+      abilityUsed: false,
+      reachedGoal: false,
+      position: { x: 0, y: 0 },
+      velocity: { x: 0, y: 0 },
+      spawnIndex: players.size,
+      facing: 1,
+      lastAbilityContext: null,
+    };
+    players.set(socket.id, player);
+    if (players.size === MAX_PLAYERS) {
+      startRun();
+    } else {
+      abortRun("Waiting for players...");
+    }
+    socket.emit("joinAccepted", {
+      playerId: player.id,
+      ability,
+      session: sessionSnapshot(),
+      leaderboard: getTopLeaderboard(),
+    });
+    broadcastSession();
+  });
+
+  socket.on("playerState", (payload) => {
+    const player = players.get(socket.id);
+    if (!player || gameState.waitingForPlayers || gameState.completed) {
+      return;
+    }
+    if (typeof payload !== "object" || payload === null) {
+      return;
+    }
+    if (payload.position) {
+      player.position = {
+        x: Number(payload.position.x) || player.position.x,
+        y: Number(payload.position.y) || player.position.y,
+      };
+    }
+    if (payload.velocity) {
+      player.velocity = {
+        x: Number(payload.velocity.x) || 0,
+        y: Number(payload.velocity.y) || 0,
+      };
+    }
+    if (typeof payload.facing === "number") {
+      player.facing = payload.facing >= 0 ? 1 : -1;
+    }
+    if (payload.moving) {
+      maybeStartTimer();
+    }
+    checkGoalForPlayer(player);
+    socket.broadcast.emit("playerState", {
+      id: player.id,
+      position: player.position,
+      velocity: player.velocity,
+      facing: player.facing,
+      abilityState: payload.abilityState || null,
+      onGround: Boolean(payload.onGround),
+    });
+  });
+
+  socket.on("useAbility", ({ context } = {}) => {
+    const player = players.get(socket.id);
+    if (!player || gameState.waitingForPlayers || gameState.completed) {
+      return;
+    }
+    if (player.abilityUsed) {
+      return;
+    }
+    player.abilityUsed = true;
+    player.lastAbilityContext = context || null;
+    socket.emit("abilityConfirmed", {
+      playerId: player.id,
+      abilityId: player.abilityId,
+      context: player.lastAbilityContext,
+    });
+    socket.broadcast.emit("abilityUsed", {
+      playerId: player.id,
+      abilityId: player.abilityId,
+      context: player.lastAbilityContext,
+    });
+    broadcastSession();
+  });
+
+  socket.on("disconnect", () => {
+    const existed = players.delete(socket.id);
+    if (!existed) {
+      return;
+    }
+    if (players.size === MAX_PLAYERS) {
+      startRun();
+    } else if (players.size === 0) {
+      abortRun("Waiting for players...");
+    } else {
+      abortRun("A player disconnected. Waiting for a full team...");
+    }
+    broadcastSession();
+  });
+});
+
+server.listen(PORT, () => {
+  console.log(`Server listening on port ${PORT}`);
+});
