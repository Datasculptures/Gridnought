// App identity — shown on the menu and the How To page
export const APP = {
  version: '0.1.0',
  date: '2026-07-18',
};

// Grid — legacy constants kept for HUD/minimap scaling references
export const GRID_SIZE = 108;
export const CELL_SIZE = 2;
export const WORLD_SIZE = GRID_SIZE * CELL_SIZE; // 216

// Chunked infinite terrain
export const CHUNK = {
  cells: 32,                    // grid cells per chunk side
  size: 32 * CELL_SIZE,         // 64 world units per chunk side
  loadRadius: 3,                // chunks kept loaded around the focus (7×7 ring)
  unloadRadius: 4,              // hysteresis — unload only beyond this
  buildsPerFrame: 2,            // max chunk meshes built per frame (hitch guard)
};

// Biome pockets — the infinite world is tiled into large cells, each assigned
// a biome type from a weighted table; heights blend smoothly across borders.
export const BIOME = {
  size: 240,                    // world units per biome cell
  blendRadius: 1.4,             // weight falloff radius in units of BIOME.size
  // Weighted biome table — must sum to 1.0
  weights: [
    ['plains',    0.22],
    ['hills',     0.22],
    ['forest',    0.16],
    ['desert',    0.12],
    ['mountains', 0.13],
    ['city',      0.10],
    ['fortress',  0.05],
  ],
};

// River network carved through the world (any biome)
export const RIVER = {
  fieldScale: 0.0045,           // noise frequency for the river field
  channelWidth: 0.075,          // |field| below this → river channel (wider ravines)
  maxDepth: 9,                  // carve depth at channel centre
  fordScale: 0.02,              // ford noise frequency
  fordThreshold: 0.45,          // lower → more fords, so more bridges
  fordDepth: 0.4,               // near-level crossings under the bridge decks
};

// Roads — flattened strips connecting adjacent city biome centres
export const ROAD = {
  halfWidth: 5,                 // full flat width = 10
  shoulder: 13,                 // blend-to-terrain distance
  height: 0.4,                  // road surface elevation
};

// City generation — abstracted but realistic districts
export const CITY = {
  blockSize: 32,                // global street lattice period
  avenueEvery: 4,               // every Nth grid line is a major avenue
  avenueInset: 8,               // building setback from an avenue
  streetInset: 5,               // setback from a minor street
  coreRadius: 0.5,              // height falloff radius (× BIOME.size)
  maxHeight: 32,                // tallest downtown towers
};

// Water surface in deep ravines (visual only)
export const WATER = {
  enabled: true,
  // World Y of the waterline. Channel ground below this floods and is
  // outlined in rimColor, so "cyan" and "wet" always mean the same thing;
  // fords sit above it and stay dry, marking the crossings.
  level: -1.5,
  fillColor: 0x1144ee,
  fillOpacity: 0.5,
  gridColor: 0x66aaff,
  gridOpacity: 0.75,
  gridDivisions: 6,
  // Submerged channel grid lines are redrawn in rimColor at near-full
  // opacity — the ravine outlines itself from any angle.
  rimColor: 0x33ccff,
};

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
  maxPanRadius: 120,        // orbit pan limit around the player anchor
};

// Whitelisted input keys — InputManager ignores all others
export const VALID_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',  // tank movement
  'KeyQ', 'KeyE',                    // camera rotation
  'ArrowUp', 'ArrowDown',            // camera pan
  'ArrowLeft', 'ArrowRight',         // camera pan
  'KeyP',                            // camera pin toggle
  'KeyR',                            // retask drone
  'KeyX',                            // drone strike
  'Digit1', 'Digit2', 'Digit3',      // ammo selection
  'Comma', 'Period',                 // barrel elevation down/up
  'Space',                           // future use
  'Escape',                          // menu / pause
]);

// Player ammunition types — selected with the number keys
export const AMMO = {
  order: ['mg', 'shell', 'ap'],
  types: {
    mg: {
      key: 'Digit1', label: 'MACHINE GUN', short: 'MG',
      max: 150, start: 90, pickup: 60,
      shotsPerFire: 3,        // burst
      burstInterval: 0.07,
      reload: 0.55,           // rapid
      muzzleVelocity: 46,
      radius: 0.09,
      color: 0xffffff,
      weapon: 'PLAYER_MG',
    },
    shell: {
      key: 'Digit2', label: 'HE SHELL', short: 'HE',
      max: 30, start: 18, pickup: 10,
      shotsPerFire: 1,
      reload: 1.8,            // TANK.reloadTime
      muzzleVelocity: 31,
      radius: 0.15,
      color: 0xffff00,
      weapon: 'HEAVY_CANNON',
    },
    ap: {
      key: 'Digit3', label: 'AP SHELL', short: 'AP',
      max: 10, start: 4, pickup: 4,
      shotsPerFire: 1,
      reload: 1.8,
      muzzleVelocity: 34,
      radius: 0.13,
      color: 0xff8844,
      weapon: 'AP_SHELL',
    },
  },
};

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
    width: 1.35,             // narrower than the hull so the tracks read clearly
    height: 0.7,
    depth: 1.8,
    yOffset: 1.35,            // hull.height + turret.height/2 — sits ON the hull
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
    topOffset: 1.5,           // barrel pivot Y — level with the raised turret centre
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
    // Anti-tank caltrop — height matches the built geometry (hubY + legLen)
    bollard:  { weight: 0, width: 3.2,  height: 2.63, depth: 3.2  },
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
  // Weapon — same MG capability as infantry
  fireRange:            30,  // stop-and-fire distance to the player
  fireCooldown:         2.0, // seconds between bursts
  turretTraverse:       1.6, // rad/s turret slew toward the player
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

// Spawn positions — the infinite world guarantees a plains biome at the
// origin, so both tanks start on safe open ground.
export const SPAWN = {
  player: { x: 0,  z: 0,  heading: Math.PI / 4 },
  enemy:  { x: 60, z: 60, heading: -Math.PI * 3 / 4 },
};

export const MINIMAP = {
  size: 160,            // canvas px
  padding: 12,          // px from corner
  tankRadius: 4,        // px
  projectileRadius: 2,  // px
  borderColor: '#00ff00',
  playerColor: '#4488ff',
  droneColor: '#00ccff',
  enemyColor: '#ff4444',
  projectileColor: '#ffff00',
  enemyProjectileColor: '#ff6600',
  viewSize: 220,        // world units across the minimap window
  // Enemies only appear within this radius of the player OR any drone
  // (~22% of the view window). Rings drawn at each sensor.
  detectRadius: 48,     // world units
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
  enemyTank: 10,          // points for destroying the enemy tank
  highScoreKey: 'wirezone_highscores',
  highScoreCount: 10,
};

// Power-up pickups
export const POWERUP = {
  pickupRadius: 2.6,       // player distance to collect
  bobAmplitude: 0.35,
  bobFrequency: 1.2,       // Hz
  spinSpeed: 1.4,          // radians/second
  size: 0.9,               // octahedron radius
  chunkChance: 0.07,       // ambient spawn probability per chunk
  radarDuration: 25,       // seconds of jam immunity
  rapidDuration: 20,       // seconds of half reload time
  repairAmount: 3,         // HP restored to every armor zone
  overdriveDuration: 20,   // seconds of boosted tank speed
  overdriveFactor: 1.35,
  apDuration: 25,          // seconds of double damage
  apFactor: 2,
  armourPerZone: 1,        // armour pickup adds this to every zone
  armourCap:     5,        // and never past this
  types: {
    armour:    { color: 0x00ffff, label: 'ARMOUR', shape: 'shield' },
    ammo:      { color: 0xffcc00, label: 'AMMO',   shape: 'shells' },
    rapid:     { color: 0xffff00, label: 'RAPID FIRE' },
    radar:     { color: 0xff00ff, label: 'RADAR' },
    overdrive: { color: 0xff8800, label: 'OVERDRIVE' },
    ap:        { color: 0xff3333, label: 'AP ROUNDS' },
    drone:     { color: 0x00ff88, label: 'DRONE' },
  },
  // Chance a destroyed enemy vehicle leaves supplies behind
  dropChance: 0.25,
};

// Endless-mode respawns and difficulty scaling
export const ENDLESS = {
  respawnDelay: 30,        // seconds before a destroyed vehicle respawns
  respawnMinDist: 80,      // respawn ring around the player
  respawnMaxDist: 150,

  // Threat rating — enemy tank pressure scales with score
  maxEnemyTanks: 4,
  threatScoreStep: 30,     // +1 concurrent enemy tank per this many points
  tankSpawnCooldown: 14,   // seconds between threat spawns
  expeditedCooldown: 5,    // faster spawn when no enemy tank is near
  noTankNearbyDist: 260,   // "near" threshold for the expedite rule
  infantryCap: 24,         // max live infantry in the world
  infantrySafeRadius: 150, // no ambient infantry this close to the origin
  infantryBaseChance: 0.12,
  infantryMaxChance: 0.55,
  infantryChanceScale: 2500, // chance += dist / this
};

export const CONTROLS_HELP = {
  displayDuration: 5.0,   // seconds before fade starts
  fadeDuration: 1.2,      // CSS transition duration in seconds
};

// Map types — retained for the legacy bounded generator (unused by the
// infinite world, which mixes these as biome pockets instead)
export const MAP_TYPES = ['infinite'];

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

// Drone — observer circling a tasked point; spots enemies for the minimap
export const DRONE = {
  orbitRadius:   75,    // world units from the tasked centre
  orbitHeight:   30,    // units above Y=0 (clears tallest terrain)
  orbitSpeed:    0.3,   // radians / second (full circle ≈ 21 s)
  bobAmplitude:  2.0,   // gentle vertical oscillation
  bobFrequency:  0.6,   // Hz
  range:         170,   // beyond this from the orbit centre → "out of range"
  retaskLerp:    0.35,  // per-second approach rate when flying to a new station
  maxFleet:      5,     // spotter + up to 4 power-up drones
  strikeSpeed:   42,    // kamikaze dive speed
  strikeProximity: 3.5, // detonation distance from the target point
  strikeTimeout: 18,    // seconds before a strike self-detonates
};

// AI hazard avoidance — AI-controlled movers refuse terrain deeper than this
export const HAZARD = {
  maxAIDepth: -2.2,     // ravine walls below this height are a no-go for AI
};

// Turret emplacements — immobile enemy tanks
export const EMPLACEMENT = {
  hp: 4,
  hitRadius: 2.2,
  score: 6,
  range: 90,            // engagement range (matches the cannon reach)
  activateRange: 105,   // player within this → turret rises and goes hot
  traverse: 1.1,        // turret slew rad/s
  aimTolerance: 0.09,
  cooldown: 3.2,        // seconds between shots
  muzzleVelocity: 30,
  riseSpeed: 2.2,       // units/sec the turret rises when activating
  riseHeight: 1.4,      // how far the turret is sunk while dormant
  dormantColor: 0x225533, // camouflaged dark green before activation
  maxLive: 12,          // world population cap
  chunkChance: 0.05,    // ambient lone-strongpoint chance per distant chunk
  minOriginDist: 250,
};

// Enemy base sites — uncommon fortified compounds, findable in the wild
export const BASE = {
  cellSize: 900,        // one candidate site per 900u world cell
  chance: 0.16,         // fraction of cells that actually hold a base
  minOriginDist: 500,   // none this close to spawn
  radius: 34,           // compound wall radius
  turretRing: 5,        // turret emplacements around the perimeter
  infantry: 4,          // defenders
  mineRing: 14,         // mines scattered around the approach
  mineRadius: 46,       // mines spread within this radius of the centre
  // Red HQ bunker — low, squat, and destructible; worth a haul
  hqHp: 10,
  hqScore: 40,
  hqHitRadius: 4.0,
  hqColor: 0xff3333,
  hq: { width: 7.5, height: 2.6, depth: 7.5 },
};

// Craters — shallow circular depressions carved into the terrain itself.
// Drivable at any angle; infantry sometimes take cover in the larger ones.
export const CRATER = {
  cellSize: 80,         // one candidate crater per 80u world cell
  chance: 0.45,         // fraction of cells that hold one
  minRadius: 5,
  maxRadius: 17,
  minDepth: 0.8,
  maxDepth: 2.4,
  rimHeight: 0.35,      // raised lip of ejecta around the bowl
  // Infantry nests in the bigger craters
  garrisonMinRadius: 11,
  garrisonChance: 0.5,
  garrison: 3,
  coverChance: 0.5,     // chance an incoming ranged hit is absorbed by the lip
  garrisonMinOriginDist: 170,
};

// Minelayer — enemy vehicle that seeds live mines along its patrol route
export const MINELAYER = {
  count:        1,
  moveSpeed:    7,
  turnSpeed:    1.7,
  hp:           2,
  color:        0xff9933,
  hitRadius:    2.0,
  minSpawnDist: 30,
  score:        7,
  layInterval:  7,     // seconds between mines
  maxMines:     10,    // per vehicle
  hull: { width: 2.4, height: 1.3, depth: 4.0 },
};

// Transport aircraft — airdrops mines or paratroops
export const TRANSPORT = {
  intervalMin: 90,
  intervalMax: 200,
  altitude: 30,
  speed: 22,
  hitRadius: 5.0,
  score: 25,
  dropCount: 5,
  dropInterval: 0.55,
  dropStartDist: 60,
  spawnDist: 420,
  despawnDist: 380,
  fallSpeed: 9,        // paratroop/mine descent rate
};

// Friendly infantry — allied squads that engage nearby enemies
export const ALLY = {
  cellSize: 320,        // candidate squad per world cell
  chance: 0.3,
  minOriginDist: 120,
  squadMin: 2,
  squadMax: 4,
  color: 0x4488ff,
  sightRange: 60,
  fireRange: 26,
  fireCooldown: 1.4,
  cap: 14,              // max live allies in the world
};

// Anti-tank bollards — big immovable caltrops
export const BOLLARD = {
  cellChance: 0.16,     // per eligible chunk
  clusterMin: 2,
  clusterMax: 5,
  spacing: 7,
  size: 3.2,            // spike span
  minOriginDist: 120,
};

// Ruined buildings — fragmented shells with partial floors
export const RUIN = {
  chance: 0.35,         // of city blocks that generate as ruins
  wallChance: 0.7,      // per perimeter segment
  floorChance: 0.6,     // per storey
  storeyHeight: 3.2,
  garrisonChance: 0.5,
  garrisonMax: 2,
  coverChance: 0.5,
};

// Gunsight target lock
export const TARGETING = {
  maxRange: 260,        // lock acquisition distance
  aimAssist: 0.7,       // extra radius added to hit spheres for the lock test
};

// Enemy bomber — periodic straight-line bombing runs over the player
export const BOMBER = {
  intervalMin: 110,     // seconds between runs (random in [min, max])
  intervalMax: 280,
  altitude: 24,         // low enough to engage with the main gun
  speed: 26,            // slow enough to lead
  hitRadius: 4.5,
  score: 20,
  bombCount: 7,
  dropInterval: 0.35,   // seconds between bombs in the stick
  dropStartDist: 65,    // begins releasing this far before the target point
  bombGravity: 22,
  spawnDist: 420,       // run starts this far out
  despawnDist: 380,     // leaves this far past the target
  blastRadius: 6.5,     // ground detonation damage radius
  playerZoneDamage: 2,  // armor damage to the player's top zone per blast
};

// Bottom-of-screen event messages
export const MESSAGES = {
  displayDuration: 6,   // seconds before a message fades
  maxVisible: 4,
  droneRangeRepeat: 25, // seconds between repeated out-of-range reminders
};
