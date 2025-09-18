(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LEVELS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  return [
    {
      id: "retro-training",
      name: "Retro Run",
      world: {
        width: 960,
        height: 540,
        gravity: 0.7,
      },
      spawnPoints: [
        { x: 80, y: 420 },
        { x: 120, y: 420 },
        { x: 160, y: 420 },
      ],
      platforms: [
        { x: 0, y: 500, width: 960, height: 40 },
        { x: 200, y: 420, width: 160, height: 16 },
        { x: 380, y: 360, width: 160, height: 16 },
        { x: 560, y: 300, width: 160, height: 16 },
        { x: 740, y: 240, width: 140, height: 16 },
      ],
      dots: [
        { id: "dot-1", x: 260, y: 388, radius: 6 },
        { id: "dot-2", x: 460, y: 328, radius: 6 },
        { id: "dot-3", x: 660, y: 268, radius: 6 },
        { id: "dot-4", x: 810, y: 208, radius: 6 },
      ],
      flag: { x: 860, y: 140, width: 24, height: 120 },
    },
  ];
});
