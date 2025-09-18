# Retro Co-op Platformer

Simple cooperative platformer prototype with black and white visuals. Players connect through their browsers, form lobbies, and race to collect every dot as quickly as possible.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm start
   ```

3. Open `http://localhost:3000` in one or more browsers or machines on the same network.

## How to play

- The menu displays the top team runs and offers a **Join** button.
- Choose a display name, then either create a lobby (selecting 1–3 players) or join an open lobby.
- When a lobby reaches its chosen capacity, the leader can start the level.
- Arrow keys move the player; double jump is allowed by pressing the up arrow again while airborne.
- A shared timer starts when the first player moves and ends when every dot in the level is collected.
- After finishing, the leader enters a team name to save the run to the leaderboard. Everyone then returns to the menu.

Leaderboard data persists in `data/leaderboard.json` so top runs survive restarts. New levels can be added by extending `shared/levels.js`.
