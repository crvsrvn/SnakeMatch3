// Tunables, shared by server and client (the client receives a snapshot in the welcome
// message). Restart the server for changes to take effect.

export const CONFIG = {
  net: {
    port: 3000,
    tickRate: 60,          // server simulation rate (Hz)
    framesPerPacket: 2,    // frames per broadcast: the client only interpolates, so the
                           // position stream has to stay dense enough to interpolate within
    interpDelayMs: 80,     // how far the client render clock lags; must exceed packet interval + jitter
  },

  map: {
    size: 100,             // square map edge in world units; all four sides wrap
    gridStep: 5,           // ground grid spacing; must divide size
    borderHeight: 3.2,     // height of the boundary light wall, world units
    borderBand: 0.9,       // half width of the glowing band on the ground
  },

  snake: {
    beadRadius: 0.6,
    beadSpacing: 0.92,     // centre to centre distance, just under a diameter so beads touch
    initialLength: 30,      // length at spawn
    maxLength: 300,         // hard cap, applied when grafting a severed tail
    baseSpeed: 8,          // units per second
    sprintMultiplier: 2,// speed multiplier while Shift is held
    turnRate: 5,         // max angular speed (rad/s) -> min turn radius = baseSpeed/turnRate
    sprintTurnFactor: 0.3, // angular speed is multiplied by this while sprinting: faster,
                           // but much clumsier -- sprinting has to cost something
    jumpHeight: 2.4,
    jumpDuration: 0.6,
    jumpCooldown: 1.0,
    jumpClearance: 1.1,    // a height gap above this counts as clearing, no collision
    hitFactor: 0.92,       // collision distance = (r1+r2)*hitFactor
    spawnInvulnerable: 1.5,// spawn protection, seconds
    invulnGraceMax: 2,     // if still overlapping when protection expires, extend at most this long
    selfCollision: 'die',  // 'die' = hitting yourself kills you | 'none' = no self collision
    selfCollisionMinIndex: 4, // first bead index that counts as self collision
    headOnTieEpsilon: 0.08,   // head-on "squareness" closer than this is a dead heat, both die

    deathPauseSec: 3,      // pause in place after dying, before respawning
    respawnNearRadius: 12, // respawn within this radius of the death spot, so the marker is visible
    deathMarkerSec: 3,     // how long the death marker lingers after respawn
    winPauseSec: 3,        // pause in place after winning, before starting over
  },

  // Bead palette: add or remove entries to change how many colors are in play
  colors: ['#ff4d5a', '#ffae43', '#e9ff3f', '#4ce060', '#4cd6e0', '#3d49f0', '#cc4ce0'],

  items: {
    count: 25,             // ordinary items topped up to this many (wild beads not included)
    maxOnMap: 50,          // hard cap on items, so nothing piles up in edge cases
    radius: 0.55,
    minSpawnDistance: 6,   // keep spawns at least this far from any bead
    // Wild beads: spawned in clusters on a timer, count as any color when matching,
    // and stay rainbow-colored until cleared
    wild: {
      intervalSec: 30,     // seconds between clusters
      clusterSize: 2,      // beads per cluster
      spread: 5,         // cluster radius
      maxOnMap: 5,        // cap on wild beads; over it, the spawn is skipped
    },
  },

  ai: {
    count: 10,              // number of bots; they are always named bot1 / bot2 / ...
    turnIntervalMin: 0.5,
    turnIntervalMax: 2.2,
    maxTurnDelta: 1.8,     // largest random turn per decision, radians
    lookAhead: 3.5,        // how far ahead a bot looks for its own body
  },

  camera: {
    distance: 28,          // camera distance to the head
    minDistance: 16,
    maxDistance: 64,
    pitchDeg: 64,          // pitch in degrees (90 = straight down)
    fov: 55,
    followLerp: 0.14,      // focus smoothing per frame, normalised to 60fps
    severGlideSec: 1,      // 接上断尾时头部会瞬移到断尾另一端：相机用这么长时间滑过去，而不是直接吸附
  },

  board: {
    maxRows: 30,           // leaderboard rows (you are always one of them)
    updateHz: 5,           // leaderboard refresh rate; no reason to follow the render loop
  },

  minimap: {
    size: 184,             // minimap edge in CSS pixels
    dotSize: 3.4,
  },

  graphics: {
    maxFps: 60,            // client render cap, so a high refresh screen does not run away
    cullMargin: 12,        // visible radius = camera distance * 1.5 + this; anything beyond
                           // is dropped from the render queue
    labelRadius: 30,       // stop drawing name tags past this, or a busy map is all names
    beadSegments: [16, 11],// sphere segments: triangle count multiplies by the number of
                           // beads, so this is the most sensitive knob when the map is busy
    shadows: true,
    fogDensity: 0.009,
    auraScale: 1,          // bead aura particle count multiplier; 0 turns the aura off
    flowSpeed: 1.6,        // how fast a flowing skin pattern travels along the body, cycles/s
    flowSpacing: 1.2,      // phase step between neighbouring beads; larger means shorter wavelength
    severFlashSec: 0.8,    // duration of the scan wave and camera kick after grafting a tail
    // Bloom is what actually makes the emissive skins (neon, magma, galaxy, aurora) and
    // the boundary wall read as glowing. It is one extra post-processing pass; turn
    // `enabled` off if the GPU struggles.
    bloom: {
      enabled: true,
      strength: 0.22,      // bloom strength：过高会让发光皮肤糊成一团白，刺眼
      radius: 0.4,         // spread radius：收窄扩散，光晕更贴合物体轮廓
      // Luminance threshold. Under EffectComposer the scene is linear HDR and sunlit
      // ground sits around 0.6-1.0, so the threshold has to clear 1.0 for bloom to land
      // only on the emissive beads and the boundary wall.
      threshold: 1.6,
      scale: 0.5,          // resolution multiplier for the bloom pyramid: a blur never
                           // needed full resolution, and 0.5 cuts its pixel count to a quarter
    },
  },

  skins: ['glass', 'matte', 'metal', 'neon', 'candy', 'aurora', 'galaxy', 'magma'],
  defaultSkin: 'glass',

  profiles: {
    historyPerIp: 8,       // how many past nicknames to remember per IP for quick pick
  },
};

// Temporary overrides for load testing; not needed to play: SM3_AI=100 SM3_MAP=380 npm start
if (typeof process !== 'undefined' && process.env) {
  if (process.env.SM3_AI) CONFIG.ai.count = Number(process.env.SM3_AI);
  if (process.env.SM3_MAP) CONFIG.map.size = Number(process.env.SM3_MAP);
  if (process.env.SM3_ITEMS) CONFIG.items.count = Number(process.env.SM3_ITEMS);
}
