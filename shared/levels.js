(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LEVELS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  return [
    {
      id: "tutorial",
      name: "Tutorial Run",
      world: {
        width: 960,
        height: 540,
        gravity: 0.6,
      },
      spawnPoints: [
        { x: 120, y: 420 },
        { x: 160, y: 420 },
        { x: 200, y: 420 },
      ],
      floor: {
        y: 480,
        height: 60,
      },
      walls: [
        { x: 420, y: 320, width: 40, height: 160 },
      ],
      platforms: [
        { x: 0, y: 480, width: 960, height: 60 },
      ],
      goal: {
        x: 780,
        y: 320,
        width: 120,
        height: 160,
      },
      npc: {
        name: "Bobby",
        x: 300,
        y: 360,
        width: 40,
        height: 80,
        messages: [
          "Hey team! Use the arrow keys to move.",
          "Jump with the up arrow. Space triggers your unique power.",
          "Work together to cross the wall and reach the glowing goal!",
        ],
      },
    },
  ];
});
