(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LEVELS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  return [
    {
      id: "tutorial-001",
      name: "Bobby's Tutorial",
      world: {
        width: 960,
        height: 540,
        gravity: 1200,
      },
      spawnPoints: [
        { x: 96, y: 420 },
        { x: 144, y: 420 },
        { x: 192, y: 420 },
      ],
      platforms: [
        { x: 0, y: 500, width: 960, height: 40, type: "floor" },
        { x: 320, y: 360, width: 40, height: 140, type: "wall" },
        { x: 560, y: 320, width: 220, height: 16, type: "platform" },
      ],
      goal: { x: 760, y: 440, width: 120, height: 60 },
      bobby: {
        x: 240,
        y: 452,
        width: 32,
        height: 48,
        lines: [
          "Welcome recruits! I'm Bobby.",
          "Try those arrows to move and jump!",
          "Space uses your special ability once per run.",
        ],
        textSpeed: 40,
      },
    },
  ];
});
