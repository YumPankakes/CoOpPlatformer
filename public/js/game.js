(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const joinScreen = document.getElementById("join-screen");
  const joinForm = document.getElementById("join-form");
  const nameInput = document.getElementById("name-input");
  const joinError = document.getElementById("join-error");

  const timerDisplay = document.getElementById("timer-display");
  const abilityNameEl = document.getElementById("ability-name");
  const abilityStatusEl = document.getElementById("ability-status");
  const statusLineEl = document.getElementById("status-line");

  const leaderboardOverlay = document.getElementById("leaderboard-overlay");
  const leaderboardList = document.getElementById("leaderboard-list");
  const completionTimeEl = document.getElementById("completion-time");
  const closeLeaderboardBtn = document.getElementById("close-leaderboard");

  const socket = io();

  const inputState = {
    left: false,
    right: false,
    jump: false,
    ability: false,
  };

  const timerState = {
    running: false,
    startTime: null,
    elapsed: 0,
  };

  const constants = {
    playerWidth: 32,
    playerHeight: 48,
    moveSpeed: 220,
    accel: 1400,
    airAccel: 1000,
    friction: 0.8,
    jumpSpeed: 520,
    dashSpeed: 560,
    dashDuration: 0.22,
    phaseDuration: 1.5,
    ceilingDuration: 5,
    maxFallSpeed: 900,
  };

  const players = new Map();
  let level = null;
  let session = null;
  let leaderboard = [];
  let localPlayerId = null;
  let abilityInfo = null;

  const bobbyState = {
    lines: [],
    currentLine: 0,
    charIndex: 0,
    textSpeed: 40,
    lastUpdate: 0,
    holdTimer: 0,
    visibleText: "",
  };

  function setJoinScreenVisible(visible) {
    joinScreen.classList.toggle("visible", visible);
    joinScreen.classList.toggle("hidden", !visible);
  }

  function showLeaderboardOverlay(show) {
    leaderboardOverlay.classList.toggle("visible", show);
    leaderboardOverlay.classList.toggle("hidden", !show);
  }

  function formatTime(ms) {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = Math.floor(totalSeconds % 60)
      .toString()
      .padStart(2, "0");
    const millis = Math.floor(ms % 1000)
      .toString()
      .padStart(3, "0");
    return `${minutes}:${seconds}.${millis}`;
  }

  function updateTimerDisplay() {
    if (timerState.running && timerState.startTime != null) {
      const now = performance.now();
      timerState.elapsed = now - timerState.startTime;
    }
    timerDisplay.textContent = formatTime(timerState.elapsed || 0);
  }

  function updateAbilityUI() {
    if (!abilityInfo) {
      abilityNameEl.textContent = "Ability";
      abilityStatusEl.textContent = "Waiting...";
      return;
    }
    abilityNameEl.textContent = abilityInfo.name;
    const player = players.get(localPlayerId);
    if (!player) {
      abilityStatusEl.textContent = "Waiting...";
      return;
    }
    if (player.abilityState.ceilingActive) {
      abilityStatusEl.textContent = "Gravity flipped";
    } else if (player.abilityState.dashActive) {
      abilityStatusEl.textContent = "Dashing";
    } else if (player.abilityState.phaseActive) {
      abilityStatusEl.textContent = "Phase active";
    } else if (player.abilityUsed) {
      abilityStatusEl.textContent = "Ability spent";
    } else if (session && session.waitingForPlayers) {
      abilityStatusEl.textContent = "Waiting for team";
    } else {
      abilityStatusEl.textContent = "Ready";
    }
  }

  function updateStatusLine(message) {
    if (message) {
      statusLineEl.textContent = message;
      return;
    }
    if (!session) {
      statusLineEl.textContent = "";
      return;
    }
    if (session.waitingForPlayers) {
      statusLineEl.textContent = "Waiting for 3 players...";
    } else if (session.completed) {
      statusLineEl.textContent = "Level complete!";
    } else if (!timerState.running) {
      statusLineEl.textContent = "Team ready. Start moving!";
    } else {
      statusLineEl.textContent = "";
    }
  }

  function updateLeaderboardList() {
    leaderboardList.innerHTML = "";
    if (!leaderboard || leaderboard.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No runs recorded yet.";
      leaderboardList.appendChild(li);
      return;
    }
    leaderboard.forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `${entry.teamName || "Team"} — ${formatTime(entry.timeMs)}`;
      leaderboardList.appendChild(li);
    });
  }

  function resetTimerFromSession(newSession) {
    if (!newSession) {
      timerState.running = false;
      timerState.startTime = null;
      timerState.elapsed = 0;
      return;
    }
    if (newSession.timerRunning && newSession.timerStartedAt) {
      timerState.running = true;
      timerState.startTime = performance.now() - (Date.now() - newSession.timerStartedAt);
    } else {
      timerState.running = false;
      timerState.startTime = null;
      timerState.elapsed = newSession.completionTime || 0;
    }
  }

  function createPlayer(snapshot) {
    return {
      id: snapshot.id,
      name: snapshot.name,
      abilityId: snapshot.abilityId,
      abilityName: snapshot.abilityName,
      position: { x: snapshot.position?.x || 0, y: snapshot.position?.y || 0 },
      velocity: { x: snapshot.velocity?.x || 0, y: snapshot.velocity?.y || 0 },
      width: constants.playerWidth,
      height: constants.playerHeight,
      facing: snapshot.facing || 1,
      grounded: false,
      gravityDir: 1,
      abilityUsed: Boolean(snapshot.abilityUsed),
      reachedGoal: Boolean(snapshot.reachedGoal),
      spawnIndex: snapshot.spawnIndex || 0,
      abilityState: {
        phaseActive: false,
        phaseTimer: 0,
        dashActive: false,
        dashTimer: 0,
        dashDirection: 1,
        ceilingActive: false,
        ceilingTimer: 0,
      },
    };
  }

  function updatePlayerFromSnapshot(player, snapshot) {
    player.name = snapshot.name;
    player.abilityId = snapshot.abilityId;
    player.abilityName = snapshot.abilityName;
    if (snapshot.position && player.id !== localPlayerId) {
      player.position.x = snapshot.position.x;
      player.position.y = snapshot.position.y;
    }
    if (snapshot.velocity && player.id !== localPlayerId) {
      player.velocity.x = snapshot.velocity.x;
      player.velocity.y = snapshot.velocity.y;
    }
    player.facing = snapshot.facing || player.facing;
    player.spawnIndex = snapshot.spawnIndex || player.spawnIndex;
    player.abilityUsed = Boolean(snapshot.abilityUsed);
    player.reachedGoal = Boolean(snapshot.reachedGoal);
  }

  function syncPlayers(sessionPlayers) {
    const seen = new Set();
    sessionPlayers.forEach((snapshot) => {
      let player = players.get(snapshot.id);
      if (!player) {
        player = createPlayer(snapshot);
        players.set(player.id, player);
      } else {
        updatePlayerFromSnapshot(player, snapshot);
      }
      seen.add(snapshot.id);
    });
    Array.from(players.keys()).forEach((id) => {
      if (!seen.has(id)) {
        players.delete(id);
      }
    });
  }

  function applyAbilityState(player, abilityId, context = {}) {
    if (!player) {
      return;
    }
    const abilityState = player.abilityState;
    if (abilityId === "phase-walker") {
      abilityState.phaseActive = true;
      abilityState.phaseTimer = constants.phaseDuration;
    } else if (abilityId === "dash-sprinter") {
      const direction = context.direction === -1 ? -1 : 1;
      abilityState.dashActive = true;
      abilityState.dashTimer = constants.dashDuration;
      abilityState.dashDirection = direction;
      if (player.id === localPlayerId) {
        player.velocity.x = direction * constants.dashSpeed;
      }
    } else if (abilityId === "ceiling-walker") {
      abilityState.ceilingActive = true;
      abilityState.ceilingTimer = constants.ceilingDuration;
      player.gravityDir = -1;
      if (player.id === localPlayerId) {
        player.velocity.y = -constants.jumpSpeed;
      }
    }
    player.abilityUsed = true;
    updateAbilityUI();
  }

  function resetAbilityState(player) {
    if (!player) {
      return;
    }
    player.abilityUsed = false;
    player.gravityDir = 1;
    Object.assign(player.abilityState, {
      phaseActive: false,
      phaseTimer: 0,
      dashActive: false,
      dashTimer: 0,
      dashDirection: player.abilityState.dashDirection || 1,
      ceilingActive: false,
      ceilingTimer: 0,
    });
  }

  function handleRunReset(payload) {
    session = payload.session;
    leaderboard = payload.leaderboard || leaderboard;
    updateLeaderboardList();
    if (session) {
      syncPlayers(session.players || []);
      resetTimerFromSession(session);
    }
    players.forEach((player) => {
      resetAbilityState(player);
      if (session) {
        const snapshot = session.players.find((p) => p.id === player.id);
        if (snapshot) {
          player.position.x = snapshot.position.x;
          player.position.y = snapshot.position.y;
          player.velocity.x = 0;
          player.velocity.y = 0;
        }
      }
    });
    timerState.elapsed = 0;
    timerState.running = false;
    timerState.startTime = null;
    showLeaderboardOverlay(false);
    updateStatusLine(payload.message);
    updateAbilityUI();
  }

  function setSession(newSession) {
    session = newSession;
    if (session) {
      syncPlayers(session.players || []);
      resetTimerFromSession(session);
    }
    updateStatusLine();
    updateAbilityUI();
  }

  function ensureLocalPlayer() {
    if (!localPlayerId) {
      return null;
    }
    return players.get(localPlayerId) || null;
  }

  function applyInputToPlayer(player, delta) {
    if (!player) {
      return;
    }
    const accel = player.grounded ? constants.accel : constants.airAccel;
    const direction = inputState.right === inputState.left ? 0 : inputState.right ? 1 : -1;
    if (!player.abilityState.dashActive) {
      if (direction !== 0) {
        player.velocity.x += direction * accel * delta;
        const maxSpeed = constants.moveSpeed;
        if (player.velocity.x > maxSpeed) player.velocity.x = maxSpeed;
        if (player.velocity.x < -maxSpeed) player.velocity.x = -maxSpeed;
        player.facing = direction >= 0 ? 1 : -1;
      } else {
        player.velocity.x *= player.grounded ? constants.friction : 0.98;
        if (Math.abs(player.velocity.x) < 1) {
          player.velocity.x = 0;
        }
      }
    } else {
      player.velocity.x = player.abilityState.dashDirection * constants.dashSpeed;
    }

    const wantsJump = inputState.jump;
    if (wantsJump && player.grounded) {
      const jumpDirection = player.gravityDir === -1 ? -1 : 1;
      player.velocity.y = -jumpDirection * constants.jumpSpeed;
      player.grounded = false;
    }
  }

  function clampWorld(player) {
    if (!level) return;
    const world = level.world;
    if (player.position.x < 0) {
      player.position.x = 0;
      player.velocity.x = Math.max(0, player.velocity.x);
    }
    const maxX = world.width - player.width;
    if (player.position.x > maxX) {
      player.position.x = maxX;
      player.velocity.x = Math.min(0, player.velocity.x);
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      if (player.gravityDir === -1) {
        player.grounded = true;
        player.velocity.y = Math.max(0, player.velocity.y);
      } else {
        player.velocity.y = 0;
      }
    }
    const maxY = world.height - player.height;
    if (player.position.y > maxY) {
      player.position.y = maxY;
      if (player.gravityDir === 1) {
        player.grounded = true;
        player.velocity.y = Math.min(0, player.velocity.y);
      } else {
        player.velocity.y = 0;
      }
    }
  }

  function rectanglesIntersect(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function resolveCollisions(player) {
    if (!level) return;
    player.grounded = false;
    const rect = {
      x: player.position.x,
      y: player.position.y,
      width: player.width,
      height: player.height,
    };
    const colliders = level.platforms || [];
    for (const platform of colliders) {
      if (
        player.abilityState.phaseActive &&
        player.abilityId === "phase-walker" &&
        platform.type === "wall"
      ) {
        continue;
      }
      const tile = {
        x: platform.x,
        y: platform.y,
        width: platform.width,
        height: platform.height,
      };
      if (!rectanglesIntersect(rect, tile)) {
        continue;
      }
      const overlapLeft = rect.x + rect.width - tile.x;
      const overlapRight = tile.x + tile.width - rect.x;
      const overlapTop = rect.y + rect.height - tile.y;
      const overlapBottom = tile.y + tile.height - rect.y;

      const minHorizontal = Math.min(overlapLeft, overlapRight);
      const minVertical = Math.min(overlapTop, overlapBottom);

      if (minHorizontal < minVertical) {
        if (overlapLeft < overlapRight) {
          rect.x -= overlapLeft;
        } else {
          rect.x += overlapRight;
        }
        player.velocity.x = 0;
      } else {
        if (overlapTop < overlapBottom) {
          rect.y -= overlapTop;
          if (player.gravityDir === 1) {
            player.grounded = true;
            player.velocity.y = 0;
          } else {
            player.velocity.y = Math.min(player.velocity.y, 0);
          }
        } else {
          rect.y += overlapBottom;
          if (player.gravityDir === -1) {
            player.grounded = true;
            player.velocity.y = 0;
          } else {
            player.velocity.y = Math.max(player.velocity.y, 0);
          }
        }
      }
    }
    player.position.x = rect.x;
    player.position.y = rect.y;
  }

  function updateAbilityTimers(player, delta) {
    const state = player.abilityState;
    if (state.phaseActive) {
      state.phaseTimer -= delta;
      if (state.phaseTimer <= 0) {
        state.phaseTimer = 0;
        state.phaseActive = false;
      }
    }
    if (state.dashActive) {
      state.dashTimer -= delta;
      if (state.dashTimer <= 0) {
        state.dashTimer = 0;
        state.dashActive = false;
      }
    }
    if (state.ceilingActive) {
      state.ceilingTimer -= delta;
      if (state.ceilingTimer <= 0) {
        state.ceilingTimer = 0;
        state.ceilingActive = false;
        player.gravityDir = 1;
      }
    }
  }

  function stepPlayer(player, delta) {
    updateAbilityTimers(player, delta);
    if (player.id === localPlayerId) {
      applyInputToPlayer(player, delta);
    }
    const gravity = (level?.world.gravity || 0) * player.gravityDir;
    player.velocity.y += gravity * delta;
    if (player.velocity.y > constants.maxFallSpeed) {
      player.velocity.y = constants.maxFallSpeed;
    }
    if (player.velocity.y < -constants.maxFallSpeed) {
      player.velocity.y = -constants.maxFallSpeed;
    }

    player.position.x += player.velocity.x * delta;
    player.position.y += player.velocity.y * delta;

    resolveCollisions(player);
    clampWorld(player);
  }

  function emitPlayerState(player) {
    if (!player || !socket.connected || !level) {
      return;
    }
    socket.emit("playerState", {
      position: player.position,
      velocity: player.velocity,
      facing: player.facing,
      moving: Math.abs(player.velocity.x) > 0.5 || Math.abs(player.velocity.y) > 0.5,
      onGround: player.grounded,
      abilityState: player.abilityState,
    });
  }

  function renderBackground() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function renderPlatforms() {
    if (!level) return;
    ctx.fillStyle = "#fefefe";
    (level.platforms || []).forEach((platform) => {
      ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    });
    if (level.goal) {
      ctx.fillStyle = "#9ef7ff";
      ctx.fillRect(level.goal.x, level.goal.y, level.goal.width, level.goal.height);
    }
  }

  function updateBobby(delta) {
    if (!level?.bobby) {
      return;
    }
    if (bobbyState.lines !== level.bobby.lines) {
      bobbyState.lines = level.bobby.lines;
      bobbyState.currentLine = 0;
      bobbyState.charIndex = 0;
      bobbyState.visibleText = "";
      bobbyState.holdTimer = 0;
      bobbyState.textSpeed = level.bobby.textSpeed || 40;
    }
    if (bobbyState.lines.length === 0) {
      return;
    }
    bobbyState.holdTimer -= delta;
    if (bobbyState.holdTimer > 0) {
      return;
    }
    const line = bobbyState.lines[bobbyState.currentLine] || "";
    if (bobbyState.charIndex < line.length) {
      bobbyState.visibleText = line.slice(0, bobbyState.charIndex + 1);
      bobbyState.charIndex += 1;
      bobbyState.holdTimer = (bobbyState.textSpeed || 40) / 1000;
    } else {
      bobbyState.holdTimer = 1.8;
      bobbyState.currentLine = (bobbyState.currentLine + 1) % bobbyState.lines.length;
      bobbyState.charIndex = 0;
    }
  }

  function renderBobby() {
    if (!level?.bobby) {
      return;
    }
    const npc = level.bobby;
    ctx.fillStyle = "#fefefe";
    ctx.fillRect(npc.x, npc.y, npc.width, npc.height);
    if (bobbyState.visibleText) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(npc.x - 10, npc.y - 60, 260, 48);
      ctx.strokeStyle = "#fefefe";
      ctx.strokeRect(npc.x - 10, npc.y - 60, 260, 48);
      ctx.fillStyle = "#fefefe";
      ctx.font = "20px VT323, monospace";
      ctx.fillText(bobbyState.visibleText, npc.x - 4, npc.y - 32);
    }
  }

  function renderPlayers() {
    players.forEach((player) => {
      const isLocal = player.id === localPlayerId;
      const baseColor = isLocal ? "#ffffff" : "#c7c7c7";
      ctx.fillStyle = baseColor;
      ctx.fillRect(player.position.x, player.position.y, player.width, player.height);
      if (player.abilityState.phaseActive) {
        ctx.strokeStyle = "#9ef7ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(player.position.x - 2, player.position.y - 2, player.width + 4, player.height + 4);
      }
      if (player.abilityState.ceilingActive) {
        ctx.strokeStyle = "#ffda6b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(player.position.x + player.width / 2, player.position.y - 6, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (player.abilityState.dashActive) {
        ctx.strokeStyle = "#ff7b7b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(player.position.x, player.position.y + player.height);
        ctx.lineTo(player.position.x + player.width * player.abilityState.dashDirection, player.position.y + player.height);
        ctx.stroke();
      }
      ctx.fillStyle = "#000";
      ctx.font = "16px VT323, monospace";
      ctx.fillText(player.name || "?", player.position.x - 4, player.position.y - 6);
    });
  }

  function render() {
    renderBackground();
    renderPlatforms();
    renderBobby();
    renderPlayers();
  }

  function update(delta) {
    updateBobby(delta);
    players.forEach((player) => {
      if (player.id === localPlayerId) {
        stepPlayer(player, delta);
      } else {
        updateAbilityTimers(player, delta);
      }
    });
    const localPlayer = ensureLocalPlayer();
    if (localPlayer) {
      emitPlayerState(localPlayer);
    }
    updateTimerDisplay();
    updateAbilityUI();
  }

  let lastFrameTime = performance.now();
  function gameLoop() {
    const now = performance.now();
    const delta = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    update(delta);
    render();
    requestAnimationFrame(gameLoop);
  }

  requestAnimationFrame(gameLoop);

  function handleKeyDown(event) {
    if (event.repeat) return;
    switch (event.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        inputState.left = true;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        inputState.right = true;
        break;
      case "ArrowUp":
      case "w":
      case "W":
        inputState.jump = true;
        break;
      case " ":
      case "Space":
        triggerAbility();
        break;
      default:
        break;
    }
  }

  function handleKeyUp(event) {
    switch (event.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        inputState.left = false;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        inputState.right = false;
        break;
      case "ArrowUp":
      case "w":
      case "W":
        inputState.jump = false;
        break;
      default:
        break;
    }
  }

  function triggerAbility() {
    const player = ensureLocalPlayer();
    if (!player || !abilityInfo) {
      return;
    }
    if (session && session.waitingForPlayers) {
      return;
    }
    if (player.abilityUsed || player.abilityState.phaseActive || player.abilityState.dashActive || player.abilityState.ceilingActive) {
      return;
    }
    const context = {};
    if (player.abilityId === "dash-sprinter") {
      context.direction = player.facing >= 0 ? 1 : -1;
    }
    applyAbilityState(player, player.abilityId, context);
    socket.emit("useAbility", { context });
  }

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      joinError.textContent = "Enter a name first.";
      return;
    }
    joinError.textContent = "";
    socket.emit("registerPlayer", { name });
  });

  closeLeaderboardBtn.addEventListener("click", () => {
    showLeaderboardOverlay(false);
  });

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  socket.on("connect", () => {
    statusLineEl.textContent = "";
  });

  socket.on("disconnect", () => {
    statusLineEl.textContent = "Disconnected. Attempting reconnect...";
  });

  socket.on("initialData", (payload) => {
    level = payload.level;
    leaderboard = payload.leaderboard || [];
    updateLeaderboardList();
    setSession(payload.session);
    if (level?.bobby) {
      bobbyState.lines = level.bobby.lines || [];
      bobbyState.currentLine = 0;
      bobbyState.charIndex = 0;
      bobbyState.visibleText = "";
      bobbyState.textSpeed = level.bobby.textSpeed || 40;
    }
  });

  socket.on("joinAccepted", ({ playerId, ability, session: newSession, leaderboard: lb }) => {
    localPlayerId = playerId;
    abilityInfo = ability;
    leaderboard = lb || leaderboard;
    updateLeaderboardList();
    setSession(newSession);
    setJoinScreenVisible(false);
    updateAbilityUI();
  });

  socket.on("joinRejected", ({ reason }) => {
    joinError.textContent = reason || "Unable to join.";
  });

  socket.on("sessionUpdate", ({ session: newSession }) => {
    setSession(newSession);
  });

  socket.on("runReset", (payload) => {
    handleRunReset(payload);
  });

  socket.on("playerState", ({ id, position, velocity, facing, abilityState }) => {
    const player = players.get(id);
    if (!player) {
      return;
    }
    if (id !== localPlayerId) {
      if (position) {
        player.position.x = position.x;
        player.position.y = position.y;
      }
      if (velocity) {
        player.velocity.x = velocity.x;
        player.velocity.y = velocity.y;
      }
      if (typeof facing === "number") {
        player.facing = facing >= 0 ? 1 : -1;
      }
      if (abilityState) {
        player.abilityState.phaseActive = Boolean(abilityState.phaseActive);
        player.abilityState.dashActive = Boolean(abilityState.dashActive);
        player.abilityState.ceilingActive = Boolean(abilityState.ceilingActive);
      }
    }
  });

  socket.on("abilityUsed", ({ playerId, abilityId, context }) => {
    const player = players.get(playerId);
    applyAbilityState(player, abilityId, context);
  });

  socket.on("abilityConfirmed", ({ playerId, abilityId, context }) => {
    if (playerId === localPlayerId) {
      applyAbilityState(players.get(playerId), abilityId, context);
    }
  });

  socket.on("timerStarted", ({ startTime }) => {
    timerState.running = true;
    timerState.startTime = performance.now() - (Date.now() - startTime);
  });

  socket.on("runCompleted", ({ timeMs, leaderboard: lb, teamName }) => {
    timerState.running = false;
    timerState.elapsed = timeMs;
    leaderboard = lb || leaderboard;
    updateLeaderboardList();
    completionTimeEl.textContent = `Team ${teamName || ""} — ${formatTime(timeMs)}`;
    showLeaderboardOverlay(true);
    updateStatusLine("Level complete!");
  });
})();
