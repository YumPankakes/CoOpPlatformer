# CoOpPlatformer

Prototype cooperative platformer that supports up to three players working together online. The game runs in the browser using HTML5 Canvas, while a Node.js + Socket.IO server keeps everyone in sync.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open `http://localhost:3000` in up to three different browsers/computers on the same network to play together.

## Gameplay overview

- Arrow keys move and jump.
- Spacebar activates your unique ability (once per level).
- Work together to cross the tutorial obstacle and reach the goal.
- NPC Bobby provides tutorial tips via a retro text box.
- A shared team timer tracks progress and top runs are stored in `data/leaderboard.json`.

New levels can be added by appending definitions to `shared/levels.js`.
