# Cooperative Platformer Prototype

Multiplayer cooperative tutorial built with Node.js, Socket.IO, and an HTML5 Canvas client. Up to three players connect from different machines, try out unique abilities, and race to the goal while a shared timer tracks their run.

## Features

- **Three-player co-op** – each player receives one of three one-shot abilities: Phase Walker, Dash Sprinter, or Ceiling Walker.
- **Shared tutorial level** – flat retro floor, a single wall, a small platform, a goal zone, and Bobby the NPC with looping tutorial dialog.
- **Synchronized movement** – server relays player state and ability usage so everyone sees the same world.
- **Team timer and leaderboard** – timer starts on the first movement once all three heroes are present, and top five completion times persist to `data/leaderboard.json`.
- **Modular level data** – add more levels later by appending to `shared/levels.js`.

## Getting started

```bash
npm install
npm start
```

Open `http://localhost:3000` in up to three browsers (or machines on the same network). Each player enters a name and automatically receives one of the three abilities. When all three have connected, the level resets and waits for movement to start the timer.

## Controls

- **Move** – Arrow keys (or WASD)
- **Jump** – Up arrow / W
- **Ability** – Spacebar (usable once per level)

## Goal flow

1. When the session has fewer than three players, the game waits and resets positions.
2. As soon as three players connect, the run arms and Bobby offers tutorial tips.
3. The shared timer begins when the first player moves.
4. Each player must reach the glowing goal zone on the right side of the level.
5. When all three arrive, the run ends, the time is recorded, and everyone sees the leaderboard before the level resets.

Leaderboard entries are automatically generated using the connected player names and saved locally. Delete `data/leaderboard.json` to clear stored times.
