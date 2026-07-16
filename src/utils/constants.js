// Grid — 50% larger again (72 → 108)
export const GRID_SIZE = 108;
export const CELL_SIZE = 2;
export const WORLD_SIZE = GRID_SIZE * CELL_SIZE; // 216

// Max delta time — clamp to this to prevent physics explosion on tab resume
export const MAX_DELTA = 0.1;

// Colours (hex integers for Three.js)
export const COLORS = {
  background: 0x000000,
  terrain: 0x00ff00,
  playerTank: 0x4488ff,
  enemyTank: 0xff4444,
  projectile: 0xffff00,
  enemyProjectile: 0xff6600,
  obstacle: 0x00ff00,
};

// Camera defaults
export const CAMERA = {
  fov: 60,
  near: 0.1,
  far: 1500,
  initialDistance: 120,
  minDistance: 30,
  maxDistance: 300,
  rotateSpeed: 0.03,
  zoomSpeed: 5,
  panSpeed: 0.5,
  initialPitch: Math.PI / 4,
  minPitch: Math.PI / 18,   // ~10 degrees
  maxPitch: Math.PI * 0.47, // ~85 degrees
};

// Whitelisted input keys — InputManager ignores all others
export const VALID_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',  // tank movement
  'KeyQ', 'KeyE',                    // camera rotation
  'ArrowUp', 'ArrowDown',            // camera pan
  'ArrowLeft', 'ArrowRight',         // camera pan
  'KeyP',                            // camera pin toggle
  'KeyX',                            // machine gun burst
  'Comma', 'Period',                 // barrel elevation down/up
  'Space',                           // future use
  'Escape',                          // menu / pause
]);

// Tank
export const TANK = {
  // Movement
  moveSpeed: 12,              // world units per second at full speed
  reverseSpeedFactor: 0.5,    // reverse is 50% of forward speed
  turnSpeed: 2.2,             // radians per second for hull rotation
  acceleration: 18,           // units/s² — how quickly the tank reaches moveSpeed
  deceleration: 22,           // units/s² — how quickly the tank stops (higher = snappier)
  slopeSlowdown: 0.5,         // speed multiplier when climbing moderate slopes

  // Turret
  turretTraverseSpeed: 3,
  reloadTime: 1.8,

  // Geometry dimensions (world units)
  hull: {
    width: 2.4,
    height: 1.0,
    depth: 3.6,
  },
  turret: {
    width: 1.6,
    height: 0.7,
    depth: 1.8,
    yOffset: 0.85,            // hull.height/2 + turret.height/2
  },
  barrel: {
    length: 3.0,
    radius: 0.1,
    yOffset: 0.3,             // barrel centre relative to turret pivot origin
    zOffset: 0.9,             // barrel starts at front of turret (turret.depth/2)
    defaultElevation: 0.3,    // ~17° starting angle (radians)
    minElevation: -0.35,      // ~-20° — allows aiming at ground targets
    maxElevation: 1.25,       // ~72° — high arc
    elevationSpeed: 1.2,      // radians per second
    topOffset: 1.1,           // barrel pivot Y above turret pivot origin (sits on turret top)
  },

  // Terrain interaction
  groundOffset: 0.0,          // extra gap between hull bottom and terrain surface
  maxClimbAngle: 35,          // degrees — steeper angles are impassable
};

export const PROJECTILE = {
  // Ballistic physics — max range ≈ muzzleVelocity² / gravity ≈ 48 units at 45°
  muzzleVelocity: 31,         // world units per second (22 * √2 → doubles max range)
  gravity: 20,                // world units per second squared (applied to -Y)
  maxFlightTime: 6.0,         // safety kill after this many seconds in flight
  radius: 0.15,
  trailLength: 3,
  trailSpacing: 0.4,
  trailColor: 0xffff00,
  trailOpacityFalloff: 0.3,
};

export const TURRET = {
  maxTraverseSpeed: Math.PI,
  smoothing: 0.12,
  raycasterLayer: 1,
};

export const HUD = {
  reloadBarWidth: 120,
  reloadBarHeight: 8,
  reloadBarColor: '#ffff00',
  reloadBarBackground: '#333333',
  reloadBarOffsetBottom: 60,
};

export const AI = {
  // Detection (scaled for 216-unit world)
  detectionRange: 130,
  loseTargetRange: 175,

  // State timings
  patrolPauseDuration: 1.5,
  aimSettleTime: 0.4,
  reactionDelay: 0.3,

  // Patrol
  patrolRadius: 68,
  patrolWaypointCount: 4,

  // Pursuit
  pursuitDistance: 28,
  pursuitDistanceTolerance: 10,
  repositionInterval: 5.0,

  // Firing
  aimTolerance: 0.08,
  burstCount: 1,
  postFirePause: 0.5,

  // Movement
  turnThreshold: 0.15,
  stuckCheckInterval: 1.0,
  stuckDistanceThreshold: 0.5,
  stuckRecoveryTime: 1.5,
};

export const OBSTACLES = {
  count: { min: 18, max: 33 },
  minDistanceFromSpawn: 20,
  minDistanceBetween: 6,
  maxSlopeForPlacement: 20,
  maxPlacementAttempts: 50,

  types: {
    cube:     { weight: 3, width: 3.0, height: 3.0, depth: 3.0 },
    tallCube: { weight: 2, width: 2.0, height: 5.0, depth: 2.0 },
    wall:     { weight: 2, width: 8.0, height: 3.5, depth: 0.8 },
    wedge:    { weight: 1, width: 3.5, height: 2.5, depth: 3.5 },
    // weight: 0 — excluded from random pool; used explicitly by specific generators
    pyramid:  { weight: 0, width: 4.0,  height: 8.0,  depth: 4.0  },
    // Military base
    bunker:   { weight: 0, width: 10.0, height: 2.5,  depth: 6.0  },
    cylinder: { weight: 0, width: 3.0,  height: 5.0,  depth: 3.0  },
    missile:  { weight: 0, width: 0.8,  height: 7.0,  depth: 0.8  },
    // Valley
    tree:     { weight: 0, width: 2.5,  height: 6.0,  depth: 2.5  },
  },

  collisionPadding: 0.3,
  projectileCollisionPadding: 0.1,
  color: 0x00ff00,
  edgeColor: 0x00cc00,
};

export const COLLISION = {
  tankHitRadius:       2.0,
  tankHitYOffset:      0.8,
  infantryHitRadius:   0.8,
  infantryHitYOffset:  0.4,
  vehicleBlockRadius:  4.0,  // min centre-to-centre distance between any two mobile entities
  sweepSteps: 3,
};

// Machine-gun projectiles — straight-line, short range
export const MACHINEGUN = {
  muzzleVelocity:  40,    // world units / second
  gravity:          0,    // no arc — travels in a straight line
  maxFlightTime:    0.4,  // 40 * 0.4 = 16 units max range
  radius:          0.08,  // smaller than main gun round
  burstCount:       3,    // shots per burst
  burstInterval:   0.07,  // seconds between shots in the burst
  cooldown:         0.8,  // seconds between bursts
  playerColor:   0xffffff, // white tracers for player
  enemyColor:    0xff8800, // orange tracers for infantry
};

// Enemy infantry units
export const INFANTRY = {
  count:           0,     // per round (infantry spawn via APC only)
  moveSpeed:        6,    // half of tank moveSpeed
  turnSpeed:        3.5,
  sightRange:      55,    // detect player beyond this → patrol
  fireRange:       28,    // stop & fire inside this range
  fireCooldown:    MACHINEGUN.cooldown * 2,  // twice the tank MG cooldown (1.6 s)
  hitRadius:        0.8,  // same as COLLISION.infantryHitRadius
  hitYOffset:       0.4,
  minSpawnDist:    28,    // minimum distance from player spawn (scaled for larger map)
};

// Truck — grey wandering vehicle, 1 HP, no weapons
export const TRUCK = {
  count:           2,     // per round
  moveSpeed:       8,
  turnSpeed:       2.0,
  hp:              1,
  color:           0x888888,
  hitRadius:       1.8,
  hitYOffset:      0.5,
  minSpawnDist:    24,
  // Geometry
  hull: { width: 2.2, height: 1.2, depth: 3.8 },
  cab:  { width: 2.0, height: 1.0, depth: 1.6 },
};

// APC — light-red wandering vehicle, 2 HP, spawns infantry when stopped
export const APC = {
  count:                1,   // per round
  moveSpeed:            7,
  turnSpeed:            1.8,
  hp:                   2,
  color:                0xff6666,
  hitRadius:            2.0,
  hitYOffset:           0.6,
  minSpawnDist:         24,
  infantrySpawnInterval: 60, // seconds between infantry drops
  maxInfantrySpawns:    3,   // stops spawning after this many
  // Geometry
  hull:    { width: 2.6, height: 1.4, depth: 4.2 },
  turret:  { width: 1.6, height: 0.6, depth: 1.6 },
};

// Jammer Truck — red, 1 HP, no weapons; jams enemy visibility when close to player
export const JAMMER = {
  count:           1,
  color:           0xff2222,   // bright red
  moveSpeed:       6,
  turnSpeed:       1.8,
  hp:              1,
  hitRadius:       1.8,
  hitYOffset:      0.5,
  minSpawnDist:    24,
  jamRadius:          70,         // world units — doubled for larger map
  flickerOnDuration:  0.8,       // seconds enemies stay INVISIBLE (longer)
  flickerOffDuration: 0.2,       // seconds enemies stay VISIBLE (shorter)
  // Geometry
  hull: { width: 2.2, height: 1.1, depth: 3.6 },
  cab:  { width: 2.0, height: 0.9, depth: 1.4 },
};

export const DESTRUCTION = {
  duration: 1.5,
  expandRate: 3.0,
  fadeRate: 1.5,
  fragmentCount: 6,
  fragmentSpeed: 8.0,
  fragmentSize: 0.6,
  fragmentGravity: 15.0,
};

export const ROUND = {
  resultDisplayDelay: 1.0,
};

// Spawn positions (world coordinates) — auto-scale with WORLD_SIZE
export const SPAWN = {
  player: { x: -WORLD_SIZE / 2 + 10, z: -WORLD_SIZE / 2 + 10, heading: Math.PI / 4 },
  enemy:  { x:  WORLD_SIZE / 2 - 10, z:  WORLD_SIZE / 2 - 10, heading: -Math.PI * 3 / 4 },
};

export const MINIMAP = {
  size: 160,            // canvas px
  padding: 12,          // px from corner
  tankRadius: 4,        // px
  projectileRadius: 2,  // px
  borderColor: '#00ff00',
  playerColor: '#4488ff',
  enemyColor: '#ff4444',
  projectileColor: '#ffff00',
  enemyProjectileColor: '#ff6600',
};

export const AIM = {
  crosshairSize: 14,        // px arm length (each arm)
  crosshairGap: 5,          // px gap at centre
  crosshairThickness: 2,    // px line width
  readyColor: '#ffff00',
  reloadingColor: '#888888',
};

export const EXPLOSION = {
  particleCount:  10,
  speed:          20,    // world units / second (outward burst)
  duration:       0.7,   // seconds
  size:           0.2,   // particle geometry radius
  gravity:        12,    // particle gravity (gentler than sparks)
  flashSize:      1.0,   // initial flash sphere radius
  flashDuration:  0.12,  // seconds
};

export const EFFECTS = {
  // Muzzle flash
  muzzleFlashDuration: 0.08,
  muzzleFlashSize: 0.7,
  muzzleFlashColor: 0xffffff,
  // Hit sparks
  sparkCount: 8,
  sparkSpeed: 14,
  sparkDuration: 0.45,
  sparkSize: 0.18,
  sparkGravity: 22,
};

export const SCORE = {
  // Kept in React state; these are just display defaults
  initial: 0,
};

export const CONTROLS_HELP = {
  displayDuration: 5.0,   // seconds before fade starts
  fadeDuration: 1.2,      // CSS transition duration in seconds
};

// Map types — randomly chosen each round (or selected by player)
export const MAP_TYPES = [
  'hills',
  'city',
  'river',
  'military_base',
  'crowded_city',
  'valley',
  'desert',    // sparse rock outcrops — open sightlines, long-range duels
  'fortress',  // walled central compound with missile silos and perimeter cover
];

// Terrain generation
export const TERRAIN = {
  slopeThreshold: 4.0,      // max height diff between adjacent cells before impassable
  noiseOctaves: [
    { frequency: 0.03, amplitude: 8.0 },  // broad hills and valleys
    { frequency: 0.08, amplitude: 3.0 },  // ridges, secondary features
    { frequency: 0.15, amplitude: 1.0 },  // surface roughness
  ],
  edgeMargin: 2,             // cells from edge where height tapers to 0 (flat border)
  cameraFloorOffset: 3.0,   // minimum camera height above terrain surface
};

// Mines — small red spheres in random clusters; triggers deal 1 HP to every armor zone
export const MINES = {
  maxClusters:          2,     // 0, 1, or 2 clusters per round
  minPerCluster:        5,
  maxPerCluster:        6,
  clusterSpread:        8,     // world units, cluster radius
  radius:               0.3,   // visual sphere radius
  triggerRadius:        1.2,   // tank must enter this distance to trigger
  avoidRadius:          3.5,   // AI stays outside this distance from each mine
  color:            0xff2222,  // bright red (wireframe outline)
  solidColor:       0x440000,  // dark red (fill surface)
  minDistanceFromSpawn: 18,    // keep mines away from start areas
};

// Drone — passive observer flying in a circle above the battlefield
export const DRONE = {
  orbitRadius:   75,    // world units from map centre
  orbitHeight:   30,    // units above Y=0 (clears tallest terrain)
  orbitSpeed:    0.3,   // radians / second (full circle ≈ 21 s)
  bobAmplitude:  2.0,   // gentle vertical oscillation
  bobFrequency:  0.6,   // Hz
};
