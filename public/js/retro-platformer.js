(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const player = { x: 60, y: 0, w: 20, h: 20, vx: 0, vy: 0, onGround: false, jumpsUsed: 0 };
  const GRAVITY = 0.8;
  const SPEED = 6;
  const JUMP_V = -14;

  function makeDot(x, y) {
    return { x, y, hitR: 18, collected: false };
  }

  const levels = [
    {
      spawn: { x: 60, y: 380 },
      plats: [
        { x: 0, y: 480, w: 900, h: 40, color: "rgb(85,85,85)" },
        { x: 140, y: 420, w: 160, h: 20, color: "rgb(85,85,85)" },
        { x: 360, y: 360, w: 120, h: 20, color: "rgb(85,85,85)" },
        { x: 560, y: 300, w: 160, h: 20, color: "rgb(85,85,85)" },
        { x: 760, y: 260, w: 100, h: 20, color: "rgb(85,85,85)" },
      ],
      dots: [makeDot(180, 400), makeDot(420, 340), makeDot(600, 280), makeDot(800, 240)],
    },
    {
      spawn: { x: 40, y: 420 },
      plats: [
        { x: 0, y: 480, w: 900, h: 40, color: "rgb(85,85,85)" },
        { x: 120, y: 420, w: 100, h: 20, color: "rgb(85,85,85)" },
        { x: 280, y: 370, w: 120, h: 20, color: "rgb(85,85,85)" },
        { x: 470, y: 420, w: 120, h: 20, color: "rgb(85,85,85)" },
        { x: 640, y: 360, w: 120, h: 20, color: "rgb(85,85,85)" },
        { x: 820, y: 300, w: 80, h: 20, color: "rgb(85,85,85)" },
        { x: 740, y: 240, w: 60, h: 20, color: "rgb(85,85,85)" },
      ],
      dots: [
        makeDot(160, 400),
        makeDot(320, 350),
        makeDot(520, 400),
        makeDot(680, 340),
        makeDot(850, 280),
      ],
    },
    {
      spawn: { x: 60, y: 440 },
      plats: [
        { x: 0, y: 480, w: 900, h: 40, color: "rgb(85,85,85)" },
        { x: 120, y: 430, w: 90, h: 20, color: "rgb(85,85,85)" },
        { x: 240, y: 380, w: 90, h: 20, color: "rgb(85,85,85)" },
        { x: 360, y: 330, w: 90, h: 20, color: "rgb(85,85,85)" },
        { x: 480, y: 280, w: 90, h: 20, color: "rgb(85,85,85)" },
        { x: 600, y: 230, w: 90, h: 20, color: "rgb(85,85,85)" },
        { x: 720, y: 185, w: 120, h: 20, color: "rgb(85,85,85)" },
        { x: 820, y: 145, w: 60, h: 20, color: "rgb(85,85,85)" },
      ],
      dots: [
        makeDot(150, 410),
        makeDot(270, 360),
        makeDot(390, 310),
        makeDot(510, 260),
        makeDot(630, 210),
        makeDot(760, 170),
        makeDot(850, 130),
      ],
    },
  ];

  let levelIdx = 0;
  let firstMoveArmed = true;
  let timerStart = null;
  let timerEnd = null;

  const keys = new Set();
  const startKeys = new Set([
    "ArrowLeft",
    "ArrowRight",
    "KeyA",
    "KeyD",
    "Space",
    "KeyW",
    "ArrowUp",
  ]);

  const particles = [];
  const triangles = [];

  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (firstMoveArmed && levelIdx === 0 && startKeys.has(event.code)) {
      firstMoveArmed = false;
      timerStart = performance.now();
      timerEnd = null;
      setOverlay("");
    }
    if (["Space", "KeyW", "ArrowUp"].includes(event.code)) {
      if (player.onGround) {
        spawnJumpTriangles();
        player.vy = JUMP_V;
        player.onGround = false;
        player.jumpsUsed = 1;
      } else if (player.jumpsUsed < 2) {
        player.vy = JUMP_V;
        player.jumpsUsed += 1;
        particles.push({
          x: player.x + player.w / 2,
          y: player.y + player.h + 2,
          w: player.w + 6,
          alpha: 1,
        });
      }
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  const timeText = document.getElementById("timeText");
  const levelText = document.getElementById("levelText");
  const overlayEl = document.getElementById("overlay");

  function fmt(ms) {
    if (ms == null) {
      return "00:00.000";
    }
    const total = Math.floor(ms);
    const minutes = Math.floor(total / 60000)
      .toString()
      .padStart(2, "0");
    const seconds = Math.floor((total % 60000) / 1000)
      .toString()
      .padStart(2, "0");
    const millis = String(total % 1000).padStart(3, "0");
    return `${minutes}:${seconds}.${millis}`;
  }

  function updateTimerUI() {
    const value = timerEnd ?? (timerStart ? performance.now() - timerStart : 0);
    timeText.textContent = fmt(value);
  }

  function setOverlay(message) {
    overlayEl.textContent = message;
  }

  const LB_KEY = "retroPlatformerLB";

  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LB_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("Unable to read leaderboard", err);
      return [];
    }
  }

  function saveLeaderboard(entries) {
    localStorage.setItem(LB_KEY, JSON.stringify(entries));
  }

  function pushTime(ms) {
    const name = prompt("You finished! Enter your name for the leaderboard:", "Player");
    if (!name) {
      return;
    }
    const entries = loadLeaderboard();
    entries.push({ ms, name });
    entries.sort((a, b) => a.ms - b.ms);
    while (entries.length > 5) {
      entries.pop();
    }
    saveLeaderboard(entries);
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const list = document.getElementById("leaderboard");
    const entries = loadLeaderboard();
    if (!entries.length) {
      list.innerHTML = "<li>No times yet</li>";
      return;
    }
    list.innerHTML = entries
      .map((entry) => `<li>${entry.name}: ${fmt(entry.ms)}</li>`)
      .join("");
  }

  function currentLevel() {
    return levels[levelIdx];
  }

  function resetDots(level) {
    level.dots.forEach((dot) => {
      dot.collected = false;
    });
  }

  function resetToSpawn() {
    const level = currentLevel();
    player.x = level.spawn.x;
    player.y = level.spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.jumpsUsed = 0;
  }

  function loadLevel(index) {
    levelIdx = index;
    levelText.textContent = `Level: ${levelIdx + 1} / ${levels.length}`;
    resetDots(currentLevel());
    resetToSpawn();
    particles.length = 0;
    triangles.length = 0;
    if (levelIdx === 0) {
      firstMoveArmed = true;
      timerStart = null;
      timerEnd = null;
      setOverlay("PRESS ANY MOVE KEY TO START");
    } else {
      setOverlay("");
    }
  }

  function aabb(a, b) {
    return !(
      a.x + a.w <= b.x ||
      a.x >= b.x + b.w ||
      a.y + a.h <= b.y ||
      a.y >= b.y + b.h
    );
  }

  function resolve(px, py, vx, vy) {
    const level = currentLevel();
    const box = { x: px, y: py, w: player.w, h: player.h };
    let grounded = false;
    for (const rect of level.plats) {
      if (!aabb(box, rect)) {
        continue;
      }
      const dx1 = rect.x + rect.w - box.x;
      const dx2 = box.x + box.w - rect.x;
      const dy1 = rect.y + rect.h - box.y;
      const dy2 = box.y + box.h - rect.y;
      const penX = Math.min(dx1, dx2);
      const penY = Math.min(dy1, dy2);
      if (penX < penY) {
        if (dx1 < dx2) {
          box.x = rect.x + rect.w;
        } else {
          box.x = rect.x - box.w;
        }
        vx = 0;
      } else {
        if (dy1 < dy2) {
          box.y = rect.y + rect.h;
          vy = Math.max(0, vy);
        } else {
          box.y = rect.y - box.h;
          vy = 0;
          grounded = true;
        }
      }
    }
    if (box.x < 0) {
      box.x = 0;
      vx = 0;
    }
    if (box.x + box.w > W) {
      box.x = W - box.w;
      vx = 0;
    }
    return { x: box.x, y: box.y, vx, vy, onGround: grounded };
  }

  function spawnJumpTriangles() {
    const level = currentLevel();
    for (const rect of level.plats) {
      if (
        player.x + player.w > rect.x &&
        player.x < rect.x + rect.w &&
        Math.abs(player.y + player.h - rect.y) < 5
      ) {
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i += 1) {
          const side = player.x + player.w / 2 < rect.x + rect.w / 2 ? -1 : 1;
          const angle = (Math.random() * 0.5 + 0.25) * Math.PI * side;
          triangles.push({
            x: player.x + player.w / 2,
            y: rect.y,
            size: 4 + Math.random() * 3,
            alpha: 1,
            dx: Math.cos(angle) * 1.5,
            dy: -Math.random() * 1.5 - 0.5,
            color: rect.color,
          });
        }
        break;
      }
    }
  }

  function tick() {
    const left = keys.has("ArrowLeft") || keys.has("KeyA");
    const right = keys.has("ArrowRight") || keys.has("KeyD");

    if (left) {
      player.vx = -SPEED;
    } else if (right) {
      player.vx = SPEED;
    } else {
      player.vx = 0;
    }

    player.vy += GRAVITY;
    const nextX = player.x + player.vx;
    const nextY = player.y + player.vy;
    const resolved = resolve(nextX, nextY, player.vx, player.vy);
    player.x = resolved.x;
    player.y = resolved.y;
    player.vx = resolved.vx;
    player.vy = resolved.vy;
    player.onGround = resolved.onGround;
    if (player.onGround) {
      player.jumpsUsed = 0;
    }

    if (player.y > H + 200) {
      resetToSpawn();
    }

    const level = currentLevel();
    for (const dot of level.dots) {
      if (dot.collected) {
        continue;
      }
      const dx = player.x + player.w / 2 - dot.x;
      const dy = player.y + player.h / 2 - dot.y;
      if (dx * dx + dy * dy < dot.hitR * dot.hitR) {
        dot.collected = true;
      }
    }

    if (level.dots.every((dot) => dot.collected)) {
      if (levelIdx < levels.length - 1) {
        loadLevel(levelIdx + 1);
      } else {
        if (!timerEnd && timerStart) {
          timerEnd = performance.now() - timerStart;
          pushTime(timerEnd);
        }
        setOverlay(`FINISHED ${fmt(timerEnd)}`);
      }
    }

    for (const particle of particles) {
      particle.y += 2;
      particle.alpha -= 0.05;
    }
    while (particles.length && particles[0].alpha <= 0) {
      particles.shift();
    }

    for (const tri of triangles) {
      tri.x += tri.dx;
      tri.y += tri.dy;
      tri.alpha -= 0.04;
    }
    while (triangles.length && triangles[0].alpha <= 0) {
      triangles.shift();
    }

    draw();
    updateTimerUI();
    requestAnimationFrame(tick);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const level = currentLevel();
    for (const rect of level.plats) {
      ctx.fillStyle = rect.color;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    ctx.fillStyle = "red";
    for (const dot of level.dots) {
      if (!dot.collected) {
        ctx.fillRect(dot.x - 3, dot.y - 3, 6, 6);
      }
    }

    ctx.fillStyle = "#fff";
    ctx.fillRect(player.x, player.y, player.w, player.h);

    for (const particle of particles) {
      ctx.fillStyle = `rgba(255,255,255,${particle.alpha})`;
      ctx.fillRect(particle.x - particle.w / 2, particle.y, particle.w, 2);
    }

    for (const tri of triangles) {
      ctx.fillStyle = `rgba(85,85,85,${tri.alpha})`;
      ctx.beginPath();
      ctx.moveTo(tri.x, tri.y);
      ctx.lineTo(tri.x + tri.size, tri.y + tri.size);
      ctx.lineTo(tri.x - tri.size, tri.y + tri.size);
      ctx.closePath();
      ctx.fill();
    }
  }

  document.getElementById("restartBtn").addEventListener("click", () => {
    loadLevel(0);
    renderLeaderboard();
  });

  function init() {
    renderLeaderboard();
    loadLevel(0);
    resetToSpawn();
    requestAnimationFrame(tick);
  }

  init();
})();
