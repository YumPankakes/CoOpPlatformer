const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const timerEl = document.getElementById("timer");
const abilityEl = document.getElementById("ability-info");
const statusEl = document.getElementById("status-message");
const leaderboardEl = document.getElementById("leaderboard");
const leaderboardListEl = document.getElementById("leaderboard-list");

const socket = io();

const state = {
  level: null,
  players: new Map(),
  localPlayerId: null,
  startTime: Date.now(),
  levelComplete: false,
  completeTime: 0,
  leaderboard: [],
  status: {
    message: "",
    expires: 0,
  },
};

const abilityEffects = {
  phaseActive: false,
  phaseTimer: 0,
  phaseConsumed: false,
  dashTimer: 0,
  dashDirection: 1,
  gravityInverted: false,
  ceilingTimer: 0,
};

const npcState = {
  messageIndex: 0,
  targetText: "",
  displayedText: "",
  timer: 0,
  pauseTimer: 0,
  typingSpeed: 35,
  pauseDuration: 2000,
};

const input = {
  left: false,
  right: false,
  jump: false,
  jumpQueued: false,
};

function createPlayer(data) {
  return {
    id: data.id,
    ability: data.ability,
    abilityName: data.abilityName,
    color: data.color || "#ffffff",
    spectator: data.spectator,
    width: 32,
    height: 48,
    position: { x: data.position.x, y: data.position.y },
    velocity: { x: data.velocity.x, y: data.velocity.y },
    goalReached: data.goalReached,
    abilityUsed: data.abilityUsed,
    onGround: false,
  };
}

function setStatus(message, duration = 3000) {
  state.status.message = message;
  state.status.expires = performance.now() + duration;
  statusEl.textContent = message;
}

function updateStatus(now) {
  if (state.status.expires && now > state.status.expires) {
    state.status.message = "";
    state.status.expires = 0;
    statusEl.textContent = "";
  }
}

function updateAbilityInfo() {
  const player = state.players.get(state.localPlayerId);
  if (!player) {
    abilityEl.textContent = "Ability: --";
    return;
  }
  const suffix = player.abilityUsed ? " (used)" : "";
  abilityEl.textContent = `Ability: ${player.abilityName || "Spectator"}${suffix}`;
}

function updateLeaderboard(entries) {
  state.leaderboard = entries || [];
  leaderboardListEl.innerHTML = "";
  if (!state.leaderboard.length) {
    const emptyLi = document.createElement("li");
    emptyLi.textContent = "No runs yet";
    leaderboardListEl.appendChild(emptyLi);
    return;
  }
  state.leaderboard.forEach((entry) => {
    const li = document.createElement("li");
    const seconds = (entry.timeMs / 1000).toFixed(3);
    const names = (entry.players || []).join(", ") || "Team";
    const date = new Date(entry.recordedAt).toLocaleTimeString();
    li.textContent = `${seconds}s - ${names} @ ${date}`;
    leaderboardListEl.appendChild(li);
  });
}

function resetAbilityEffects() {
  abilityEffects.phaseActive = false;
  abilityEffects.phaseTimer = 0;
  abilityEffects.phaseConsumed = false;
  abilityEffects.dashTimer = 0;
  abilityEffects.dashDirection = 1;
  abilityEffects.gravityInverted = false;
  abilityEffects.ceilingTimer = 0;
}

function requestAbility() {
  const player = state.players.get(state.localPlayerId);
  if (!player || player.spectator || player.abilityUsed) {
    return;
  }
  socket.emit("requestAbility");
}

function activateAbility(ability) {
  const player = state.players.get(state.localPlayerId);
  if (!player) {
    return;
  }
  player.abilityUsed = true;
  updateAbilityInfo();
  switch (ability) {
    case "phase":
      abilityEffects.phaseActive = true;
      abilityEffects.phaseConsumed = false;
      abilityEffects.phaseTimer = 1800;
      setStatus("Phase Walker: Ghost mode!", 1500);
      break;
    case "dash":
      abilityEffects.dashTimer = 220;
      abilityEffects.dashDirection = input.left ? -1 : input.right ? 1 : player.velocity.x >= 0 ? 1 : -1;
      setStatus("Dash Sprinter: Zoom!", 1500);
      break;
    case "ceiling":
      abilityEffects.gravityInverted = true;
      abilityEffects.ceilingTimer = 4500;
      setStatus("Ceiling Walker: Gravity flipped!", 2000);
      break;
    default:
      break;
  }
}

function updateAbilityTimers(delta) {
  if (abilityEffects.phaseActive) {
    abilityEffects.phaseTimer -= delta;
    if (abilityEffects.phaseTimer <= 0) {
      abilityEffects.phaseActive = false;
      abilityEffects.phaseTimer = 0;
    }
  }
  if (abilityEffects.dashTimer > 0) {
    abilityEffects.dashTimer -= delta;
    if (abilityEffects.dashTimer <= 0) {
      abilityEffects.dashTimer = 0;
    }
  }
  if (abilityEffects.gravityInverted) {
    abilityEffects.ceilingTimer -= delta;
    if (abilityEffects.ceilingTimer <= 0) {
      abilityEffects.gravityInverted = false;
      abilityEffects.ceilingTimer = 0;
    }
  }
}

function rectsIntersect(a, b) {
  return !(
    a.x + a.width <= b.x ||
    a.x >= b.x + b.width ||
    a.y + a.height <= b.y ||
    a.y >= b.y + b.height
  );
}

function handleHorizontalCollisions(player, nextX) {
  if (!state.level) return nextX;
  const rect = {
    x: nextX,
    y: player.position.y,
    width: player.width,
    height: player.height,
  };
  let collided = false;
  for (const wall of state.level.walls || []) {
    const wallRect = { ...wall };
    if (rectsIntersect(rect, wallRect)) {
      if (abilityEffects.phaseActive && !abilityEffects.phaseConsumed) {
        abilityEffects.phaseConsumed = true;
        continue;
      }
      collided = true;
      if (player.velocity.x > 0) {
        nextX = wall.x - player.width;
      } else if (player.velocity.x < 0) {
        nextX = wall.x + wall.width;
      }
      player.velocity.x = 0;
    }
  }
  if (!collided && abilityEffects.phaseActive && abilityEffects.phaseConsumed) {
    // Phase is consumed after passing through one wall. Turn it off once clear.
    const stillInside = (state.level.walls || []).some((wall) =>
      rectsIntersect(rect, wall)
    );
    if (!stillInside) {
      abilityEffects.phaseActive = false;
    }
  }
  return Math.max(0, Math.min(nextX, state.level.world.width - player.width));
}

function handleVerticalCollisions(player, currentX, nextY) {
  if (!state.level) return { y: nextY, onGround: false };
  const rect = {
    x: currentX,
    y: nextY,
    width: player.width,
    height: player.height,
  };
  const gravityDir = abilityEffects.gravityInverted ? -1 : 1;
  let onGround = false;

  for (const wall of state.level.walls || []) {
    const wallRect = { ...wall };
    if (rectsIntersect(rect, wallRect)) {
      if (abilityEffects.phaseActive && !abilityEffects.phaseConsumed) {
        abilityEffects.phaseConsumed = true;
        continue;
      }
      if (player.velocity.y * gravityDir > 0) {
        // moving with gravity
        if (gravityDir > 0) {
          nextY = wall.y - player.height;
        } else {
          nextY = wall.y + wall.height;
        }
        onGround = true;
      } else {
        if (gravityDir > 0) {
          nextY = wall.y + wall.height;
        } else {
          nextY = wall.y - player.height;
        }
      }
      player.velocity.y = 0;
    }
  }

  // Floor / ceiling collisions
  const floorY = state.level.floor?.y ?? state.level.world.height - 40;
  const ceilingY = state.level.floor?.height ?? 40;

  if (gravityDir > 0) {
    if (nextY + player.height >= floorY) {
      nextY = floorY - player.height;
      player.velocity.y = 0;
      onGround = true;
    }
    if (nextY < 0) {
      nextY = 0;
      player.velocity.y = 0;
    }
  } else {
    if (nextY <= ceilingY) {
      nextY = ceilingY;
      player.velocity.y = 0;
      onGround = true;
    }
    if (nextY + player.height > state.level.world.height) {
      nextY = state.level.world.height - player.height;
      player.velocity.y = 0;
    }
  }

  return { y: nextY, onGround };
}

function updateLocalPlayer(player, delta) {
  updateAbilityTimers(delta);

  const gravity = state.level.world.gravity;
  const gravityDir = abilityEffects.gravityInverted ? -1 : 1;
  const accel = 0.65;
  const maxSpeed = abilityEffects.dashTimer > 0 ? 14 : 4;
  const friction = 0.7;
  const jumpVelocity = 11;

  if (abilityEffects.dashTimer > 0) {
    player.velocity.x = abilityEffects.dashDirection * maxSpeed;
  } else {
    if (input.left && !input.right) {
      player.velocity.x = Math.max(player.velocity.x - accel, -maxSpeed);
    } else if (input.right && !input.left) {
      player.velocity.x = Math.min(player.velocity.x + accel, maxSpeed);
    } else {
      player.velocity.x *= friction;
      if (Math.abs(player.velocity.x) < 0.05) {
        player.velocity.x = 0;
      }
    }
  }

  if (input.jumpQueued && player.onGround) {
    player.velocity.y = -jumpVelocity * gravityDir;
    player.onGround = false;
    input.jumpQueued = false;
  }

  player.velocity.y += gravity * gravityDir * (delta / 16.67);
  player.velocity.y = Math.max(Math.min(player.velocity.y, 20), -20);

  const nextX = handleHorizontalCollisions(player, player.position.x + player.velocity.x);
  const verticalResult = handleVerticalCollisions(player, nextX, player.position.y + player.velocity.y);

  player.position.x = nextX;
  player.position.y = verticalResult.y;
  player.onGround = verticalResult.onGround;

  const goalRect = state.level.goal;
  if (goalRect) {
    const playerRect = {
      x: player.position.x,
      y: player.position.y,
      width: player.width,
      height: player.height,
    };
    player.goalReached = rectsIntersect(playerRect, goalRect);
  }
}

function updateNPC(delta) {
  if (!state.level || !state.level.npc) return;
  const npc = state.level.npc;
  if (!npcState.targetText) {
    npcState.targetText = npc.messages?.[npcState.messageIndex] || "";
    npcState.displayedText = "";
    npcState.timer = 0;
    npcState.pauseTimer = 0;
  }
  if (npcState.displayedText.length < npcState.targetText.length) {
    npcState.timer += delta;
    if (npcState.timer >= npcState.typingSpeed) {
      npcState.timer = 0;
      npcState.displayedText = npcState.targetText.slice(
        0,
        npcState.displayedText.length + 1
      );
    }
  } else {
    npcState.pauseTimer += delta;
    if (npcState.pauseTimer >= npcState.pauseDuration) {
      npcState.messageIndex = (npcState.messageIndex + 1) % (npc.messages?.length || 1);
      npcState.targetText = npc.messages?.[npcState.messageIndex] || "";
      npcState.displayedText = "";
      npcState.timer = 0;
      npcState.pauseTimer = 0;
    }
  }
}

function renderBackground() {
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.level) return;
  ctx.fillStyle = "#2f314d";
  (state.level.platforms || []).forEach((platform) => {
    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
  });
  ctx.fillStyle = "#f8b195";
  (state.level.walls || []).forEach((wall) => {
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
  });
  if (state.level.goal) {
    const goal = state.level.goal;
    const gradient = ctx.createLinearGradient(goal.x, goal.y, goal.x, goal.y + goal.height);
    gradient.addColorStop(0, "#ffd166");
    gradient.addColorStop(1, "#ff6b6b");
    ctx.fillStyle = gradient;
    ctx.fillRect(goal.x, goal.y, goal.width, goal.height);
  }
}

function renderNPC() {
  if (!state.level || !state.level.npc) return;
  const npc = state.level.npc;
  ctx.fillStyle = "#8bc34a";
  ctx.fillRect(npc.x, npc.y, npc.width, npc.height);

  const text = npcState.displayedText;
  if (!text) return;

  const padding = 10;
  const boxWidth = 280;
  const lineHeight = 16;
  const lines = wrapText(text, 32);
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxX = Math.min(npc.x + npc.width + 10, canvas.width - boxWidth - 10);
  const boxY = npc.y - boxHeight - 10;

  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = "#8bc34a";
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = "#dcedc8";
  ctx.font = "12px 'Press Start 2P', monospace";
  lines.forEach((line, index) => {
    ctx.fillText(line, boxX + padding, boxY + padding + lineHeight * (index + 1) - 4);
  });
}

function wrapText(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const testLine = current ? `${current} ${word}` : word;
    if (testLine.length > maxChars) {
      if (current) {
        lines.push(current);
        current = word;
      } else {
        lines.push(word);
        current = "";
      }
    } else {
      current = testLine;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines;
}

function renderPlayers() {
  state.players.forEach((player, id) => {
    if (!player.position) return;
    ctx.fillStyle = player.color || "#ffffff";
    if (player.goalReached) {
      ctx.fillStyle = "#f4f1de";
    }
    ctx.fillRect(player.position.x, player.position.y, player.width, player.height);

    ctx.fillStyle = "#000";
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText(
      player.abilityName || "Spectator",
      player.position.x - 6,
      player.position.y - 6
    );
  });
}

function render() {
  renderBackground();
  renderNPC();
  renderPlayers();
}

function updateTimerDisplay(now) {
  const elapsed = state.levelComplete
    ? state.completeTime
    : Math.max(0, now - state.startTime);
  const totalSeconds = elapsed / 1000;
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  timerEl.textContent = `${minutes}:${seconds}`;
}

function gameLoop(now) {
  if (!gameLoop.last) {
    gameLoop.last = now;
  }
  const delta = now - gameLoop.last;
  gameLoop.last = now;

  updateStatus(now);
  const player = state.players.get(state.localPlayerId);
  if (player && !player.spectator && !state.levelComplete) {
    updateLocalPlayer(player, delta);
    socket.emit("playerUpdate", {
      position: player.position,
      velocity: player.velocity,
      goalReached: player.goalReached,
    });
  } else {
    updateAbilityTimers(delta);
  }

  updateNPC(delta);
  updateTimerDisplay(now);
  render();

  requestAnimationFrame(gameLoop);
}

function resetNPCState() {
  npcState.messageIndex = 0;
  npcState.targetText = "";
  npcState.displayedText = "";
  npcState.timer = 0;
  npcState.pauseTimer = 0;
}

socket.on("initialState", (payload) => {
  state.localPlayerId = payload.playerId;
  state.startTime = payload.startTime;
  state.level = payload.level;
  state.levelComplete = false;
  state.completeTime = 0;
  state.players.clear();
  payload.players.forEach((player) => {
    state.players.set(player.id, createPlayer(player));
  });
  updateAbilityInfo();
  updateLeaderboard(payload.leaderboard || []);
  resetAbilityEffects();
  resetNPCState();
  leaderboardEl.classList.add("hidden");
  requestAnimationFrame(gameLoop);
});

socket.on("playerJoined", ({ player }) => {
  state.players.set(player.id, createPlayer(player));
});

socket.on("playerLeft", ({ id }) => {
  state.players.delete(id);
});

socket.on("playerState", ({ id, position, velocity, goalReached }) => {
  const player = state.players.get(id);
  if (!player) return;
  player.position = position;
  player.velocity = velocity;
  player.goalReached = goalReached;
});

socket.on("levelReset", ({ level, startTime, players, leaderboard }) => {
  state.level = level;
  state.startTime = startTime;
  state.levelComplete = false;
  state.completeTime = 0;
  resetAbilityEffects();
  resetNPCState();
  leaderboardEl.classList.add("hidden");
  players.forEach((player) => {
    state.players.set(player.id, createPlayer(player));
  });
  updateAbilityInfo();
  updateLeaderboard(leaderboard);
  setStatus("Level reset. Abilities refreshed!", 1500);
});

socket.on("levelComplete", ({ timeMs, leaderboard }) => {
  state.levelComplete = true;
  state.completeTime = timeMs;
  updateLeaderboard(leaderboard);
  leaderboardEl.classList.remove("hidden");
  setStatus("Level complete! Resetting soon...", 4000);
});

socket.on("abilityActivated", ({ ability }) => {
  activateAbility(ability);
});

socket.on("abilityDenied", ({ reason }) => {
  setStatus(reason || "Ability denied.", 1500);
});

socket.on("abilityStatus", ({ id }) => {
  const player = state.players.get(id);
  if (player) {
    player.abilityUsed = true;
  }
});

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", " "].includes(event.key)) {
    event.preventDefault();
  }
  if (event.repeat) return;
  switch (event.key) {
    case "ArrowLeft":
      input.left = true;
      break;
    case "ArrowRight":
      input.right = true;
      break;
    case "ArrowUp":
      if (!input.jump) {
        input.jumpQueued = true;
      }
      input.jump = true;
      break;
    case " ":
      requestAbility();
      break;
    default:
      break;
  }
});

window.addEventListener("keyup", (event) => {
  switch (event.key) {
    case "ArrowLeft":
      input.left = false;
      break;
    case "ArrowRight":
      input.right = false;
      break;
    case "ArrowUp":
      input.jump = false;
      input.jumpQueued = false;
      break;
    default:
      break;
  }
});

