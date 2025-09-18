const socket = io();

const screens = {
  menu: document.getElementById("menu-screen"),
  join: document.getElementById("join-screen"),
  create: document.getElementById("create-screen"),
  list: document.getElementById("lobby-list-screen"),
  lobby: document.getElementById("lobby-screen"),
  game: document.getElementById("game-screen"),
  win: document.getElementById("win-screen"),
};

const leaderboardList = document.getElementById("leaderboard-list");
const menuJoinBtn = document.getElementById("menu-join-btn");
const notification = document.getElementById("notification");
const displayNameInput = document.getElementById("display-name");
const createLobbyNav = document.getElementById("create-lobby-nav");
const browseLobbiesNav = document.getElementById("browse-lobbies-nav");
const playerCountButtons = document.querySelectorAll("#player-count-buttons button");
const createLobbyConfirm = document.getElementById("create-lobby-confirm");
const lobbyListContainer = document.getElementById("lobby-list");
const lobbyIdEl = document.getElementById("lobby-id");
const lobbyLeaderEl = document.getElementById("lobby-leader");
const lobbyPlayersEl = document.getElementById("lobby-players");
const startGameBtn = document.getElementById("start-game-btn");
const leaveLobbyBtn = document.getElementById("leave-lobby-btn");
const lobbyStatusEl = document.getElementById("lobby-status");
const gameExitBtn = document.getElementById("game-exit-btn");
const hudTimer = document.getElementById("hud-timer");
const hudDots = document.getElementById("hud-dots");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const winTimeEl = document.getElementById("win-time");
const scoreForm = document.getElementById("score-form");
const teamNameInput = document.getElementById("team-name");
const winWaiting = document.getElementById("win-waiting");

let currentScreen = "menu";
let selectedPlayerCount = 1;
let notificationTimeout = null;
let animationId = null;

const state = {
  leaderboard: [],
  lobbies: [],
  lobby: null,
  playerId: null,
  playerName: "",
  game: null,
};

function setScreen(name) {
  currentScreen = name;
  Object.entries(screens).forEach(([key, element]) => {
    if (key === name) {
      element.classList.add("active");
      element.classList.remove("hidden");
    } else {
      element.classList.remove("active");
      element.classList.add("hidden");
    }
  });
}

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  const milliseconds = Math.floor(ms % 1000)
    .toString()
    .padStart(3, "0");
  return `${minutes}:${seconds}.${milliseconds}`;
}

function showNotification(message, duration = 2500) {
  if (!message) {
    notification.classList.add("hidden");
    return;
  }
  notification.textContent = message;
  notification.classList.remove("hidden");
  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }
  notificationTimeout = setTimeout(() => {
    notification.classList.add("hidden");
  }, duration);
}

function updateLeaderboard(entries) {
  leaderboardList.innerHTML = "";
  if (!entries || entries.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No runs yet.";
    leaderboardList.appendChild(li);
    return;
  }
  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = `${entry.teamName || "Unknown"} - ${formatTime(
      entry.timeMs
    )} (${entry.playerCount}P)`;
    leaderboardList.appendChild(li);
  });
}

function updateLobbyList(lobbies) {
  lobbyListContainer.innerHTML = "";
  if (!lobbies || lobbies.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No open lobbies.";
    lobbyListContainer.appendChild(empty);
    return;
  }
  lobbies
    .filter((entry) => entry.status === "waiting")
    .forEach((lobby) => {
      const wrapper = document.createElement("div");
      wrapper.className = "lobby-entry";

      const info = document.createElement("p");
      info.textContent = `${lobby.id} // ${lobby.hostName} (${lobby.playerCount}/${lobby.maxPlayers})`;
      wrapper.appendChild(info);

      const joinButton = document.createElement("button");
      joinButton.textContent = "Join";
      joinButton.disabled =
        lobby.playerCount >= lobby.maxPlayers || lobby.status !== "waiting";
      joinButton.addEventListener("click", () => {
        const name = displayNameInput.value.trim();
        if (!name) {
          showNotification("Enter a display name first.");
          return;
        }
        state.playerName = name;
        socket.emit("joinLobby", { name, lobbyId: lobby.id });
      });
      wrapper.appendChild(joinButton);

      lobbyListContainer.appendChild(wrapper);
    });
}

function updateLobbyView(lobby) {
  if (!lobby) {
    lobbyIdEl.textContent = "";
    lobbyLeaderEl.textContent = "";
    lobbyPlayersEl.innerHTML = "";
    startGameBtn.disabled = true;
    return;
  }
  lobbyIdEl.textContent = lobby.id;
  lobbyLeaderEl.textContent = lobby.hostName;
  lobbyPlayersEl.innerHTML = "";
  lobby.players.forEach((player) => {
    const li = document.createElement("li");
    const isLeader = player.id === lobby.hostId ? " ★" : "";
    li.textContent = `${player.name}${isLeader}`;
    lobbyPlayersEl.appendChild(li);
  });
  const isLeader = lobby.hostId === state.playerId;
  startGameBtn.disabled =
    !isLeader ||
    lobby.players.length !== lobby.maxPlayers ||
    lobby.status !== "waiting";
  startGameBtn.classList.toggle("hidden", !isLeader);
  lobbyStatusEl.textContent =
    lobby.status === "waiting"
      ? `Players ${lobby.players.length}/${lobby.maxPlayers}`
      : "Starting run...";
}

function highlightPlayerCount(count) {
  selectedPlayerCount = count;
  playerCountButtons.forEach((button) => {
    const value = Number(button.dataset.count);
    button.classList.toggle("selected", value === count);
  });
}

highlightPlayerCount(selectedPlayerCount);

function ensureNameEntered() {
  const name = displayNameInput.value.trim();
  if (!name) {
    showNotification("Enter a display name first.");
    displayNameInput.focus();
    return null;
  }
  state.playerName = name;
  return name;
}

function leaveLobby() {
  socket.emit("leaveLobby");
}

const inputState = {
  left: false,
  right: false,
  jump: false,
};

function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    width: 28,
    height: 44,
    vx: 0,
    vy: 0,
    onGround: false,
    jumpCount: 0,
  };
}

function startGame(level, lobby) {
  setScreen("game");
  const selfEntry = lobby.players.find((player) => player.id === state.playerId);
  const spawn =
    (selfEntry && level.spawnPoints[selfEntry.spawnIndex]) || level.spawnPoints[0];
  state.game = {
    level,
    lobby,
    localPlayer: createPlayer(spawn),
    remotePlayers: new Map(),
    collectedDots: new Set(),
    timerStart: null,
    timerActive: false,
    completionTime: null,
    lastSent: 0,
  };
  lobby.players.forEach((player) => {
    if (player.id === state.playerId) {
      return;
    }
    const spawnPoint =
      level.spawnPoints[player.spawnIndex] || level.spawnPoints[0];
    state.game.remotePlayers.set(player.id, {
      x: spawnPoint.x,
      y: spawnPoint.y,
      width: 28,
      height: 44,
    });
  });
  hudDots.textContent = `Dots: 0/${level.dots.length}`;
  hudTimer.textContent = "00:00.000";
  teamNameInput.value = "";
  const submitButton = scoreForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = false;
  }
  stopGameLoop();
  lastFrame = performance.now();
  animationId = requestAnimationFrame(gameLoop);
}

function stopGameLoop() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

function updateTimerDisplay() {
  if (!state.game || !state.game.timerActive || state.game.timerStart == null) {
    return;
  }
  const elapsed = Math.max(0, Date.now() - state.game.timerStart);
  hudTimer.textContent = formatTime(elapsed);
}

function sendPlayerState(player, moving) {
  if (!state.game) return;
  const now = performance.now();
  if (now - state.game.lastSent < 1000 / 30) {
    return;
  }
  state.game.lastSent = now;
  socket.emit("playerState", {
    position: { x: player.x, y: player.y },
    velocity: { x: player.vx, y: player.vy },
    moving,
  });
}

function handleInputKeydown(event) {
  if (currentScreen !== "game" || !state.game) {
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(event.code)) {
    event.preventDefault();
  }
  if (event.code === "ArrowLeft") {
    inputState.left = true;
  }
  if (event.code === "ArrowRight") {
    inputState.right = true;
  }
  if (event.code === "ArrowUp") {
    if (!inputState.jump) {
      attemptJump();
    }
    inputState.jump = true;
  }
}

function handleInputKeyup(event) {
  if (event.code === "ArrowLeft") {
    inputState.left = false;
  }
  if (event.code === "ArrowRight") {
    inputState.right = false;
  }
  if (event.code === "ArrowUp") {
    inputState.jump = false;
  }
}

function attemptJump() {
  if (!state.game) return;
  const player = state.game.localPlayer;
  if (player.onGround || player.jumpCount < 2) {
    player.vy = player.jumpCount === 0 ? -11 : -9.5;
    player.onGround = false;
    player.jumpCount += 1;
  }
}

function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function updatePhysics(delta) {
  if (!state.game) return;
  const level = state.game.level;
  const player = state.game.localPlayer;
  const platforms = level.platforms;

  const speed = 3.2;
  player.vx = 0;
  if (inputState.left) {
    player.vx -= speed;
  }
  if (inputState.right) {
    player.vx += speed;
  }

  player.vy += level.world.gravity * Math.min(delta / 16, 1.5);

  player.x += player.vx;
  for (const platform of platforms) {
    if (rectsIntersect(player, platform)) {
      if (player.vx > 0) {
        player.x = platform.x - player.width;
      } else if (player.vx < 0) {
        player.x = platform.x + platform.width;
      }
      player.vx = 0;
    }
  }

  player.y += player.vy;
  player.onGround = false;
  for (const platform of platforms) {
    if (rectsIntersect(player, platform)) {
      if (player.vy > 0) {
        player.y = platform.y - player.height;
        player.vy = 0;
        player.onGround = true;
        player.jumpCount = 0;
      } else if (player.vy < 0) {
        player.y = platform.y + platform.height;
        player.vy = 0;
      }
    }
  }

  player.x = Math.max(0, Math.min(level.world.width - player.width, player.x));
  player.y = Math.min(level.world.height - player.height, player.y);

  const moving = Math.abs(player.vx) > 0.1 || Math.abs(player.vy) > 0.1;
  sendPlayerState(player, moving);

  updateTimerDisplay();

  if (state.game && state.game.lobby) {
    checkDotCollection();
  }
}

function checkDotCollection() {
  if (!state.game) return;
  const player = state.game.localPlayer;
  const playerCenter = { x: player.x + player.width / 2, y: player.y + player.height / 2 };
  for (const dot of state.game.level.dots) {
    if (state.game.collectedDots.has(dot.id)) {
      continue;
    }
    const dx = playerCenter.x - dot.x;
    const dy = playerCenter.y - dot.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= dot.radius + player.width / 3) {
      state.game.collectedDots.add(dot.id);
      socket.emit("collectDot", { dotId: dot.id });
    }
  }
}

function drawGame() {
  if (!state.game) return;
  const level = state.game.level;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#fff";
  level.platforms.forEach((platform) => {
    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
  });

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    level.flag.x,
    level.flag.y,
    level.flag.width,
    level.flag.height
  );
  ctx.beginPath();
  ctx.moveTo(level.flag.x + level.flag.width, level.flag.y);
  ctx.lineTo(level.flag.x + level.flag.width + 20, level.flag.y + 20);
  ctx.lineTo(level.flag.x + level.flag.width, level.flag.y + 40);
  ctx.closePath();
  ctx.stroke();

  level.dots.forEach((dot) => {
    if (state.game.collectedDots.has(dot.id)) {
      return;
    }
    ctx.beginPath();
    ctx.fillStyle = "#fff";
    ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  // draw remote players
  state.game.remotePlayers.forEach((remote) => {
    ctx.fillStyle = "#555";
    ctx.fillRect(remote.x, remote.y, remote.width, remote.height);
  });

  // draw local player
  const player = state.game.localPlayer;
  ctx.fillStyle = "#fff";
  ctx.fillRect(player.x, player.y, player.width, player.height);
}

let lastFrame = performance.now();
function gameLoop(timestamp) {
  if (!state.game) {
    return;
  }
  const delta = Math.min(32, timestamp - lastFrame);
  lastFrame = timestamp;
  updatePhysics(delta);
  drawGame();
  animationId = requestAnimationFrame(gameLoop);
}

menuJoinBtn.addEventListener("click", () => {
  setScreen("join");
  displayNameInput.focus();
});

document.querySelectorAll(".back-to-menu").forEach((button) => {
  button.addEventListener("click", () => {
    setScreen("menu");
  });
});

document.querySelectorAll(".back-to-join").forEach((button) => {
  button.addEventListener("click", () => {
    setScreen("join");
  });
});

createLobbyNav.addEventListener("click", () => {
  if (!ensureNameEntered()) {
    return;
  }
  highlightPlayerCount(selectedPlayerCount);
  setScreen("create");
});

browseLobbiesNav.addEventListener("click", () => {
  if (!ensureNameEntered()) {
    return;
  }
  setScreen("list");
  updateLobbyList(state.lobbies);
});

playerCountButtons.forEach((button) => {
  button.addEventListener("click", () => {
    highlightPlayerCount(Number(button.dataset.count));
  });
});

createLobbyConfirm.addEventListener("click", () => {
  const name = ensureNameEntered();
  if (!name) {
    return;
  }
  socket.emit("createLobby", { name, maxPlayers: selectedPlayerCount });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("startGame");
});

leaveLobbyBtn.addEventListener("click", leaveLobby);

gameExitBtn.addEventListener("click", leaveLobby);

scoreForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.lobby || state.lobby.hostId !== state.playerId) {
    return;
  }
  const teamName = teamNameInput.value.trim();
  if (!teamName) {
    showNotification("Enter a team name.");
    return;
  }
  const submitButton = scoreForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
  }
  socket.emit("submitScore", { teamName });
});

document.addEventListener("keydown", handleInputKeydown);
document.addEventListener("keyup", handleInputKeyup);

socket.on("connect", () => {
  state.playerId = socket.id;
});

socket.on("initialData", (data) => {
  state.leaderboard = data.leaderboard || [];
  state.lobbies = data.lobbies || [];
  updateLeaderboard(state.leaderboard);
  updateLobbyList(state.lobbies);
});

socket.on("leaderboard", (entries) => {
  state.leaderboard = entries || [];
  updateLeaderboard(state.leaderboard);
});

socket.on("lobbyList", (lobbies) => {
  state.lobbies = lobbies || [];
  if (currentScreen === "list") {
    updateLobbyList(state.lobbies);
  }
});

socket.on("errorMessage", ({ message }) => {
  showNotification(message || "An error occurred.");
});

socket.on("lobbyJoined", ({ lobby }) => {
  state.lobby = lobby;
  updateLobbyView(lobby);
  setScreen("lobby");
});

socket.on("lobbyUpdated", (lobby) => {
  if (!state.lobby || lobby.id !== state.lobby.id) {
    return;
  }
  state.lobby = lobby;
  updateLobbyView(lobby);
});

socket.on("gameStarted", ({ lobby, level }) => {
  state.lobby = lobby;
  startGame(level, lobby);
});

socket.on("playerState", ({ id, position }) => {
  if (!state.game || id === state.playerId) {
    return;
  }
  const remote = state.game.remotePlayers.get(id);
  if (remote) {
    remote.x = position.x;
    remote.y = position.y;
  } else {
    state.game.remotePlayers.set(id, {
      x: position.x,
      y: position.y,
      width: 28,
      height: 44,
    });
  }
});

socket.on("timerStarted", ({ startTime }) => {
  if (!state.game) return;
  state.game.timerStart = startTime;
  state.game.timerActive = true;
});

socket.on("dotCollected", ({ dotId }) => {
  if (!state.game) return;
  state.game.collectedDots.add(dotId);
  const collected = state.game.collectedDots.size;
  const total = state.game.level.dots.length;
  hudDots.textContent = `Dots: ${collected}/${total}`;
});

socket.on("gameCompleted", ({ timeMs }) => {
  if (!state.game) return;
  state.game.completionTime = timeMs;
  stopGameLoop();
  hudTimer.textContent = formatTime(timeMs);
  winTimeEl.textContent = `Time: ${formatTime(timeMs)}`;
  setScreen("win");
  const isLeader = state.lobby && state.lobby.hostId === state.playerId;
  scoreForm.classList.toggle("hidden", !isLeader);
  winWaiting.classList.toggle("hidden", isLeader);
});

socket.on("gameCancelled", ({ reason }) => {
  stopGameLoop();
  state.game = null;
  if (reason) {
    showNotification(reason);
  }
  if (state.lobby) {
    updateLobbyView(state.lobby);
  }
  if (state.lobby) {
    setScreen("lobby");
  }
});

socket.on("returnToMenu", ({ leaderboard, message }) => {
  stopGameLoop();
  state.game = null;
  state.lobby = null;
  if (Array.isArray(leaderboard)) {
    state.leaderboard = leaderboard;
    updateLeaderboard(state.leaderboard);
  }
  if (message) {
    showNotification(message, 3000);
  }
  setScreen("menu");
});

socket.on("disconnect", () => {
  stopGameLoop();
  state.game = null;
  state.lobby = null;
  setScreen("menu");
});
