import * as THREE from 'three';
import { COLORS, CAMERA, MAX_DELTA, SPAWN, ROUND, INFANTRY, TRUCK, APC, JAMMER, TANK, POWERUP, ENDLESS, SCORE, CHUNK, DRONE, MESSAGES, BOMBER, COLLISION, TARGETING, EMPLACEMENT, BASE, CRATER, AMMO, MINELAYER, TRANSPORT, ALLY, RUIN } from '../utils/constants.js';
import GameState from './GameState.js';
import InputManager from '../input/InputManager.js';
import ChunkedTerrain from '../terrain/ChunkedTerrain.js';
import { seededRandom } from '../terrain/noise.js';
import EffectsManager from '../rendering/EffectsManager.js';
import CameraController from '../camera/CameraController.js';
import MovementValidator from '../physics/MovementValidator.js';
import CollisionManager from '../physics/CollisionManager.js';
import ObstacleManager from '../terrain/ObstacleManager.js';
import Tank from '../entities/Tank.js';
import PlayerMech from '../entities/PlayerMech.js';
import ProjectileManager from '../entities/ProjectileManager.js';
import AIController from '../ai/AIController.js';
import InfantryUnit from '../entities/InfantryUnit.js';
import TruckVehicle  from '../entities/TruckVehicle.js';
import APCVehicle    from '../entities/APCVehicle.js';
import JammerTruck   from '../entities/JammerTruck.js';
import EntityManager from '../entities/EntityManager.js';
import PowerUp from '../entities/PowerUp.js';
import Bomber from '../entities/Bomber.js';
import TurretEmplacement from '../entities/TurretEmplacement.js';
import DestructibleBuilding from '../entities/DestructibleBuilding.js';
import MinelayerVehicle from '../entities/MinelayerVehicle.js';
import Transport from '../entities/Transport.js';
import SoundManager from '../audio/SoundManager.js';
import Drone from '../entities/Drone.js';
import MineManager from '../entities/MineManager.js';

export class GameManager {
  constructor() {
    this.renderer             = null;
    this.scene                = null;
    this.camera               = null;
    this.clock                = null;
    this.state                = null;
    this._stateChangeCallback = null;
    this._roundEndCallback    = null;
    this._rafId               = null;
    this._resizeHandler       = null;

    // Named system references
    this.inputManager         = null;
    this.terrain              = null;
    this.cameraController     = null;
    this.movementValidator    = null;
    this.playerTank           = null;
    this.enemyUnits           = []; // [{ tank, ai }] — threat-scaled pool
    this.allyUnits            = []; // [{ tank, ai }] — friendly armour
    this.projectileManager    = null;
    this.collisionManager     = null;
    this.obstacleManager      = null;
    this.effectsManager       = null;
    this.entityManager        = null; // unified registry: infantry, trucks, APCs, jammers, ...
    this.drones               = [];   // friendly drone fleet — [0] is the base spotter

    // Gunsight target lock (first-person only)
    this.aimTarget            = null;

    // Jammer effect state
    this._jamFlickerTimer     = 0;
    this._jamVisible          = true;
    this.mineManager          = null;

    // Audio
    this.soundManager         = null;

    // Endless mode: arcade points, power-up timers, vehicle respawns
    this.points               = 0;
    this._onPointsCallback    = null;
    this._radarTimer          = 0;   // jam immunity remaining (s)
    this._rapidTimer          = 0;   // rapid-fire remaining (s)
    this._overdriveTimer      = 0;   // speed boost remaining (s)
    this._apTimer             = 0;   // double damage remaining (s)
    this._respawnQueue        = [];  // [{ kind, timer }]
    this._cullTimer           = 0;   // periodic sweep of dead/far entities

    // Event message feed (bottom-of-screen ticker)
    this._onMessageCallback   = null;
    this._wasJamming          = false;
    this._droneRangeTimer     = 0;   // cooldown for repeated out-of-range alerts
    this._canvas              = null;

    // Threat rating
    this._threatSpawnTimer    = 0;
    this._threatLevel         = 1;

    // Bomber runs
    this._bomberTimer         = 0;

    // Deterministic world features already materialised (base + crater nests)
    this._spawnedBases        = new Set();
    this._spawnedNests        = new Set();
    this._spawnedAllies       = new Set();
    this._transportTimer      = 0;

    // Map type for current round + player-selected preference ('random' = pick randomly)
    this.mapType              = 'hills';
    this._mapTypePreference   = 'random';

    // Round flow
    this.pendingRoundResult   = null;
    this.roundEndDelayTimer   = 0;

    this._loop = this._loop.bind(this);
  }

  init(canvasElement) {
    this._canvas = canvasElement;
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvasElement,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = true;
    this.renderer.setClearColor(COLORS.background);
    this.renderer.setSize(canvasElement.clientWidth, canvasElement.clientHeight, false);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    const aspect = canvasElement.clientWidth / canvasElement.clientHeight;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);

    // Clock
    this.clock = new THREE.Clock();

    // Input
    this.inputManager = new InputManager();
    this.inputManager.init();

    // Infinite chunked terrain — biome pockets stream in around the player
    this.mapType = 'infinite';
    this.terrain = new ChunkedTerrain(this.scene);

    // Obstacles generate per chunk as terrain streams; wire before build so
    // the synchronously-built spawn chunks get populated too
    this.obstacleManager = new ObstacleManager(this.scene, this.terrain);
    this.terrain.build(undefined, this.mapType);
    this.obstacleManager.generate(this.terrain.seed, this.mapType);

    // Convenience reference on terrain
    this.terrain.obstacleManager = this.obstacleManager;

    // Movement validator — obstacle-aware
    this.movementValidator = new MovementValidator(this.terrain, this.obstacleManager);

    // Player vehicle — starts as the tank; the menu can swap it to the walker
    this.playerVehicleType = 'tank';
    this.playerTank = new Tank(this.scene, {
      position: SPAWN.player,
      color: COLORS.playerTank,
      terrain: this.terrain,
      inputManager: this.inputManager,
      movementValidator: this.movementValidator,
    });

    // Projectile manager
    this.projectileManager = new ProjectileManager(this.scene, this.terrain);

    // Wire player turret aiming
    this.playerTank.setAimDependencies(this.camera, this.projectileManager);

    // Collision manager — obstacle-aware
    this.collisionManager = new CollisionManager(this.projectileManager, this.obstacleManager);
    this.collisionManager.registerTank(this.playerTank);
    this.collisionManager.onHit((tank, proj) => this._handleHit(tank, proj));

    // Effects (muzzle flash + hit sparks)
    this.effectsManager = new EffectsManager(this.scene);
    this.playerTank.effectsManager = this.effectsManager;
    this.projectileManager.setEffectsManager(this.effectsManager);

    // Orbit camera
    this.cameraController = new CameraController(
      this.camera,
      this.inputManager,
      this.terrain,
    );
    this.cameraController.setPlayerTank(this.playerTank);
    this.playerTank.cameraController = this.cameraController;

    // P toggles first-person mode. Registered as a DOM-event callback so the
    // pointer lock request carries transient user activation.
    this.inputManager.onKeyPress('KeyP', () => {
      if (this.state === GameState.PLAYING) {
        this.cameraController.toggleFirstPerson(canvasElement);
      }
    });

    // R retasks the drone fleet to circle a point above the tank's position
    this.inputManager.onKeyPress('KeyR', () => {
      if (this.state !== GameState.PLAYING) return;
      const idle = this.drones.filter(d => d.isAlive && !d.isStriking);
      if (idle.length === 0) return;
      for (const d of idle) d.retask(this.playerTank.position);
      this._pushMessage('DRONES RETASKED — MOVING TO STATION');
      this._droneRangeTimer = 0;
    });

    // Esc pauses (orbit mode — under pointer lock the browser consumes Esc
    // and the lock-lost handler below pauses instead) or resumes
    this.inputManager.onKeyPress('Escape', () => {
      if (this.state === GameState.PLAYING) this.pauseGame();
      else if (this.state === GameState.PAUSED) this.resumeGame();
    });

    // Pointer-lock loss while playing in first person → pause menu
    this.cameraController.onLockLost(() => {
      if (this.state === GameState.PLAYING) this.pauseGame();
    });

    // Drone fleet — the base spotter; power-ups add more
    this.drones = [new Drone(this.scene)];

    // X launches a drone strike on the locked target
    this.inputManager.onKeyPress('KeyX', () => this._tryDroneStrike());

    // Number keys select ammunition
    for (const type of AMMO.order) {
      this.inputManager.onKeyPress(AMMO.types[type].key, () => {
        if (this.state !== GameState.PLAYING) return;
        if (!this.playerTank.selectAmmo(type)) return;
        const n = this.playerTank.ammo[type];
        this._pushMessage(`${AMMO.types[type].label} — ${n} ROUND${n === 1 ? '' : 'S'}`);
      });
    }

    // Mine manager — generates 0-2 clusters of small red mines each round
    this.mineManager = new MineManager(this.scene);
    this.mineManager.generate(this.terrain, this.terrain.seed);

    // Audio — synthesised retro sound (unlocks on first user gesture)
    this.soundManager = new SoundManager();
    this.soundManager.init();
    this.playerTank.soundManager = this.soundManager;

    // First enemy tank of the threat pool (more join as the score climbs)
    this._createEnemyUnit(SPAWN.enemy);

    // Unified entity registry + initial spawns (idle until the round starts)
    this.entityManager = new EntityManager();
    this.entityManager.onKill((e, proj) => this._handleEntityKill(e, proj));
    this._spawnEntities();

    // Distance-scaled ambient enemies + power-ups stream in with chunks
    this._hookChunkSpawns();

    // Wire vehicle-blocking provider into the movement validator
    this._updateMobileEntityProvider();

    // Initial state — show the start menu
    this.state = GameState.MENU;

    // Resize handler
    this._resizeHandler = () => {
      const w = canvasElement.clientWidth;
      const h = canvasElement.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  start() {
    this._rafId = requestAnimationFrame(this._loop);
  }

  _loop() {
    this._rafId = requestAnimationFrame(this._loop);

    let delta = this.clock.getDelta();
    delta = Math.min(delta, MAX_DELTA);

    // These run in every state — camera and input remain responsive
    this.inputManager.update(delta);
    this.cameraController.update(delta);
    this.terrain.update(delta);

    if (this.state === GameState.PLAYING) {
      this.playerTank.update(delta);
      for (const u of this.enemyUnits) {
        u.ai.update(delta);
        u.tank.update(delta);
      }
      for (const u of this.allyUnits) {
        u.ai.update(delta);
        u.tank.update(delta);
      }
      this._updateThreat(delta);
      this._updateBomber(delta);
      this._updateTransport(delta);

      // Stream terrain chunks around the player
      this.terrain.setFocus(this.playerTank.position.x, this.playerTank.position.z);

      // All registered entities (infantry, trucks, APCs, jammers, ...)
      this.entityManager.update(delta, this._entityCtx());

      // Jammer flicker effect
      this._updateJammerEffect(delta);

      // Hide anything past the terrain horizon — distant units used to hang
      // in empty sky where no ground is drawn
      this._updateHorizonVisibility();

      this.projectileManager.update(delta);
      this.collisionManager.update(delta);

      // Entity hit detection — runs after CollisionManager so projectiles
      // stopped by obstacles/tanks are already dead and skipped
      this.entityManager.checkProjectileHits(this.projectileManager.getActiveProjectiles());

      // Infantry crush — player tank running over infantry kills them
      this._checkInfantryCrush();

      // Mine trigger check — player only (AI avoids mines on its own)
      this._checkMineTrigger();

      // Mines blown up by projectiles
      this._checkMineProjectileHits();

      // Drone hit check
      this._checkDroneHits();

      // Endless-mode systems
      this._checkRavineWarning(delta);
      this._checkPowerUpPickup();
      this._updatePowerUpTimers(delta);
      this._updateRespawns(delta);
      this._cullFarEntities(delta);

      // Audio: listener follows player, engine hum tracks speed
      this.soundManager.setListenerPosition(this.playerTank.position.x, this.playerTank.position.z);
      this.soundManager.engine(Math.min(1, Math.abs(this.playerTank.speed) / TANK.moveSpeed));

      for (const d of this.drones) d.update(delta);
      this._updateAimTarget();
      this._updateDroneStrikes();
      this._checkDroneRange(delta);
      this.effectsManager.update(delta);

      if (this.pendingRoundResult !== null) {
        this.roundEndDelayTimer -= delta;
        if (this.roundEndDelayTimer <= 0) {
          this._finishRoundEnd();
        }
      }
    } else if (this.state === GameState.ROUND_END) {
      // Animate destruction effects on destroyed tanks + any lingering effects
      if (!this.playerTank.isAlive) this.playerTank.update(delta);
      for (const u of this.enemyUnits) {
        if (!u.tank.isAlive) u.tank.update(delta);
      }
      for (const u of this.allyUnits) {
        if (!u.tank.isAlive) u.tank.update(delta);
      }
      this.entityManager.update(delta, this._entityCtx(), { deadOnly: true });
      this._setEnemyVisibility(true); // restore full visibility at round end
      this.soundManager.engineOff();
      this.effectsManager.update(delta);
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // Round lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Begins a round from the start menu — resets tanks and AI on the current
   * terrain (no regen). Obstacles from init() remain in place.
   */
  /**
   * Swaps the player chassis between the tank and the walker, re-wiring every
   * system that holds a reference. Safe to call before a round starts;
   * regenerateTerrain() (run by startRound) then resets it onto fresh terrain.
   * @param {'tank'|'mech'} type
   */
  setPlayerVehicle(type) {
    const target = type === 'mech' ? 'mech' : 'tank';
    if (this.playerTank && this.playerVehicleType === target) return;

    if (this.playerTank) {
      this.collisionManager.unregisterTank(this.playerTank);
      this.playerTank.dispose();
    }

    const Chassis = target === 'mech' ? PlayerMech : Tank;
    this.playerTank = new Chassis(this.scene, {
      position: SPAWN.player,
      color: COLORS.playerTank,
      terrain: this.terrain,
      inputManager: this.inputManager,
      movementValidator: this.movementValidator,
    });

    // Re-wire the systems that were bound to the old instance in init()
    this.playerTank.setAimDependencies(this.camera, this.projectileManager);
    this.playerTank.effectsManager   = this.effectsManager;
    this.playerTank.soundManager     = this.soundManager;
    this.playerTank.cameraController  = this.cameraController;
    this.cameraController.setPlayerTank(this.playerTank);
    this.collisionManager.registerTank(this.playerTank);

    this.playerVehicleType = target;
  }

  startRound(vehicle = 'tank') {
    this.setPlayerVehicle(vehicle);
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    this._resetEndlessState();
    this.regenerateTerrain();
    this._resetDrones();
    for (const u of this.enemyUnits) u.ai.setGameState(GameState.PLAYING);
    for (const u of this.allyUnits)  u.ai.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
    // Straight into the cockpit — first-person from the first frame.
    // Called from the start button/key event, so pointer lock is granted.
    this.cameraController.enterFirstPerson(this._canvas);
  }

  /**
   * Play-Again path — regenerates terrain (and obstacles) then starts a fresh
   * round, keeping the current chassis unless a different one is requested.
   */
  restartRound(vehicle = this.playerVehicleType) {
    this.setPlayerVehicle(vehicle);
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    this._resetEndlessState();
    this.regenerateTerrain();
    this._resetDrones();
    for (const u of this.enemyUnits) u.ai.setGameState(GameState.PLAYING);
    for (const u of this.allyUnits)  u.ai.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
    this.cameraController.enterFirstPerson(this._canvas);
  }

  // ---------------------------------------------------------------------------
  // Enemy tank pool (threat rating)
  // ---------------------------------------------------------------------------

  /** Weighted enemy tank class pick — heavies appear at higher threat. */
  _pickEnemyClass() {
    const level = this._desiredEnemyTanks();
    if (level <= 1) return 'medium';
    const roll = Math.random();
    if (level >= 3 && roll < 0.25) return 'heavy';
    if (roll < 0.55) return 'light';
    return 'medium';
  }

  /**
   * Creates a fully-wired AI tank for either side and adds it to that side's
   * pool. Both use the same controller; only the faction, colour, and target
   * provider differ — an enemy hunts the nearest friendly, an ally hunts the
   * nearest hostile.
   */
  _createTankUnit(spawn, { faction = 'enemy', tankClass = 'medium' } = {}) {
    const tank = new Tank(this.scene, {
      position: { x: spawn.x, z: spawn.z, heading: spawn.heading ?? Math.random() * Math.PI * 2 },
      color: faction === 'enemy' ? COLORS.enemyTank : ALLY.tankColor,
      faction,
      tankClass,
      terrain: this.terrain,
      inputManager: null,
      movementValidator: this.movementValidator,
    });
    tank.setAimDependencies(null, this.projectileManager);
    tank.effectsManager = this.effectsManager;
    tank.soundManager   = this.soundManager;

    const ai = new AIController(tank, this.terrain, this.projectileManager, this.obstacleManager);
    ai.mineManager = this.mineManager;
    // Re-acquire the closest opponent every frame rather than fixating
    ai.setTargetProvider(() => this.findHostile(tank));
    ai.setTarget(this.findHostile(tank));
    ai.setGameState(this.state ?? GameState.MENU);
    tank.setAIController(ai);

    this.collisionManager.registerTank(tank);
    const unit = { tank, ai };
    (faction === 'enemy' ? this.enemyUnits : this.allyUnits).push(unit);
    return unit;
  }

  /** Back-compat helper for the threat system. */
  _createEnemyUnit(spawn, tankClass = 'medium') {
    return this._createTankUnit(spawn, { faction: 'enemy', tankClass });
  }

  /** Current threat level and the enemy tank count it allows. */
  _desiredEnemyTanks() {
    return Math.min(
      1 + Math.floor(this.points / ENDLESS.threatScoreStep),
      ENDLESS.maxEnemyTanks,
    );
  }

  /**
   * Keeps enemy tank pressure matched to the threat level: revives dead
   * pool tanks (or grows the pool) on a cooldown, expedited when no enemy
   * tank is anywhere near the player — you can't just drive away from war.
   */
  _updateThreat(delta) {
    // Announce threat level increases
    const level = this._desiredEnemyTanks();
    if (level > this._threatLevel) {
      this._threatLevel = level;
      this._pushMessage(`THREAT LEVEL ${level} — MORE ENEMY ARMOR ACTIVE`);
    }

    this._threatSpawnTimer -= delta;
    const alive = this.enemyUnits.filter(u => u.tank.isAlive);
    if (alive.length >= level) return;

    // Expedite when nothing is hunting the player
    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    const anyNear = alive.some(u => {
      const dx = u.tank.position.x - px;
      const dz = u.tank.position.z - pz;
      return (dx * dx + dz * dz) < ENDLESS.noTankNearbyDist ** 2;
    });
    if (!anyNear && this._threatSpawnTimer > ENDLESS.expeditedCooldown) {
      this._threatSpawnTimer = ENDLESS.expeditedCooldown;
    }
    if (this._threatSpawnTimer > 0) return;
    this._threatSpawnTimer = ENDLESS.tankSpawnCooldown;

    const pos = this._findClearPosNearPlayer(ENDLESS.respawnMinDist, ENDLESS.respawnMaxDist);
    const spawn = { ...pos, heading: Math.random() * Math.PI * 2 };
    const dead = this.enemyUnits.find(u => !u.tank.isAlive);
    if (dead) {
      dead.tank._spawnConfig = spawn;
      dead.tank.reset(spawn);
      dead.ai.reset();
      dead.ai.setGameState(GameState.PLAYING);
      dead.ai.generatePatrolWaypoints();
    } else {
      const unit = this._createEnemyUnit(spawn, this._pickEnemyClass());
      unit.ai.setGameState(GameState.PLAYING);
      unit.ai.generatePatrolWaypoints();
    }
    this._pushMessage('ENEMY ARMOR INBOUND');
  }

  // ---------------------------------------------------------------------------
  // Drone fleet: target lock + kamikaze strikes
  // ---------------------------------------------------------------------------

  /** Minimap compatibility — the base spotter drone. */
  get drone() {
    return this.drones[0] ?? null;
  }

  _resetDrones() {
    while (this.drones.length > 1) this.drones.pop().dispose();
    this.drones[0].reset(SPAWN.player);
  }

  /**
   * First-person target lock: casts the aim line from the camera eye and
   * picks the nearest enemy whose (padded) hit sphere it crosses.
   */
  _updateAimTarget() {
    this.aimTarget = null;
    if (!this.cameraController.isPinned || !this.playerTank.isAlive) return;

    const tank   = this.playerTank;
    const yaw    = tank.heading + tank.turretAngle;
    const elev   = tank.getViewElevation();
    const cosE   = Math.cos(elev);
    const dir    = { x: Math.sin(yaw) * cosE, y: Math.sin(elev), z: Math.cos(yaw) * cosE };
    const origin = this.camera.position;

    let best = null, bestT = Infinity;
    const consider = (entity, cx, cy, cz, radius) => {
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;   // along-ray distance
      if (t < 2 || t > TARGETING.maxRange || t >= bestT) return;
      const px = ox - dir.x * t, py = oy - dir.y * t, pz = oz - dir.z * t;
      const r  = radius + TARGETING.aimAssist;
      if (px * px + py * py + pz * pz <= r * r) { best = entity; bestT = t; }
    };

    for (const u of this.enemyUnits) {
      if (!u.tank.isAlive) continue;
      consider(u.tank,
        u.tank.position.x, u.tank.position.y + COLLISION.tankHitYOffset, u.tank.position.z,
        COLLISION.tankHitRadius);
    }
    for (const e of this.entityManager.alive(en => en.faction === 'enemy')) {
      const hc = e.getHitCenter();
      consider(e, hc.x, hc.y, hc.z, e.hitRadius);
    }
    this.aimTarget = best;
  }

  /** True when X should launch a drone strike instead of the machine gun. */
  _canDroneStrike() {
    return this.state === GameState.PLAYING
      && this.cameraController.isPinned
      && this.aimTarget !== null
      && this.drones.some(d => d.isAlive && !d.isStriking);
  }

  _tryDroneStrike() {
    if (!this._canDroneStrike()) return;
    const target = this.aimTarget;

    // Prefer spending power-up drones; the base spotter goes last
    const idle  = this.drones.filter(d => d.isAlive && !d.isStriking);
    const drone = idle.length > 1 ? idle[idle.length - 1] : idle[0];

    // Track the target while it lives; freeze on its last position after
    const lastPos = target.getHitCenter
      ? target.getHitCenter()
      : target.position.clone();
    drone.strikeAt(() => {
      if (target.isAlive) {
        const p = target.getHitCenter
          ? target.getHitCenter()
          : lastPos.set(target.position.x, target.position.y + COLLISION.tankHitYOffset, target.position.z);
        lastPos.copy(p);
      }
      return lastPos;
    });
    this._pushMessage('DRONE COMMITTED — STRIKE INBOUND');
  }

  /** Detonates striking drones on arrival, ground impact, or timeout. */
  _updateDroneStrikes() {
    for (const d of this.drones) {
      if (!d.isAlive || !d.isStriking) continue;
      const p       = d.position;
      const aim     = d._strikeFn();
      const dx = p.x - aim.x, dy = p.y - aim.y, dz = p.z - aim.z;
      const arrived = (dx * dx + dy * dy + dz * dz) <= DRONE.strikeProximity ** 2;
      const crashed = p.y <= this.terrain.getHeightAt(p.x, p.z) + 0.5;
      const expired = d._strikeTimer > DRONE.strikeTimeout;
      if (arrived || crashed || expired) {
        const at = p.clone();
        d.consume();
        this._handleBombDetonation(at); // same blast as a bomber bomb
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bomber runs
  // ---------------------------------------------------------------------------

  _updateBomber(delta) {
    if (this._bomberTimer <= 0) {
      this._bomberTimer = BOMBER.intervalMin
        + Math.random() * (BOMBER.intervalMax - BOMBER.intervalMin);
      return;
    }
    this._bomberTimer -= delta;
    if (this._bomberTimer > 0) return;

    // Launch a run: random bearing, path passes over the player's position
    const ang = Math.random() * Math.PI * 2;
    const px  = this.playerTank.position.x;
    const pz  = this.playerTank.position.z;
    this.entityManager.add(new Bomber(this.scene, {
      start:  { x: px - Math.sin(ang) * BOMBER.spawnDist, z: pz - Math.cos(ang) * BOMBER.spawnDist },
      target: { x: px, z: pz },
      terrain: this.terrain,
      onDetonate: (pos) => this._handleBombDetonation(pos),
    }));
    this._pushMessage('AIRCRAFT INBOUND — ENEMY BOMBER');
  }

  /**
   * Enemy transport runs — periodically a cargo aircraft crosses overhead
   * and airdrops either a mine string or a stick of paratroops.
   */
  _updateTransport(delta) {
    if (this._transportTimer === undefined || this._transportTimer <= 0) {
      this._transportTimer = TRANSPORT.intervalMin
        + Math.random() * (TRANSPORT.intervalMax - TRANSPORT.intervalMin);
      return;
    }
    this._transportTimer -= delta;
    if (this._transportTimer > 0) return;

    const ang = Math.random() * Math.PI * 2;
    const px  = this.playerTank.position.x;
    const pz  = this.playerTank.position.z;
    const payload = Math.random() < 0.5 ? 'mines' : 'troops';
    this.entityManager.add(new Transport(this.scene, {
      start:  { x: px - Math.sin(ang) * TRANSPORT.spawnDist, z: pz - Math.cos(ang) * TRANSPORT.spawnDist },
      target: { x: px, z: pz },
      payload,
      terrain: this.terrain,
      onDeliver: (pos, kind) => this._handleAirdrop(pos, kind),
    }));
    this._pushMessage(payload === 'mines'
      ? 'TRANSPORT INBOUND — MINE DROP'
      : 'TRANSPORT INBOUND — PARATROOPS');
  }

  /** A dropped crate has landed: seed a mine or deploy a trooper. */
  _handleAirdrop(pos, kind) {
    if (kind === 'mines') {
      this.mineManager?.addMineAt(this.terrain, pos.x, pos.z);
      return;
    }
    if (this.entityManager.alive(e => e.kind === 'infantry').length >= ENDLESS.infantryCap + 8) return;
    this.entityManager.add(new InfantryUnit(this.scene, {
      position:          { x: pos.x, z: pos.z },
      terrain:           this.terrain,
      movementValidator: this.movementValidator,
      mineManager:       this.mineManager,
    }));
  }

  /** Ground detonation: area damage to the player and anything nearby. */
  _handleBombDetonation(pos) {
    this.soundManager.explosion(pos);
    this.effectsManager.spawnExplosion(pos, COLORS.enemyProjectile);

    const r2 = BOMBER.blastRadius * BOMBER.blastRadius;

    // Player: top-armor damage (bombs come from above)
    if (this.playerTank.isAlive && this.pendingRoundResult === null) {
      const dx = this.playerTank.position.x - pos.x;
      const dz = this.playerTank.position.z - pos.z;
      if (dx * dx + dz * dz <= r2) {
        if (this.playerTank.takeHit('top', BOMBER.playerZoneDamage)) {
          this.pendingRoundResult = 'defeat';
          this.roundEndDelayTimer = ROUND.resultDisplayDelay;
        } else {
          this._pushMessage("WE'VE BEEN HIT — TOP ARMOR");
        }
      }
    }

    // Entities caught in the blast — 3D distance, so a bomber at altitude
    // is safe from its own ground bombs but not from a drone strike
    for (const e of this.entityManager.alive()) {
      if (e.kind === 'powerup') continue;
      const hc = e.getHitCenter ? e.getHitCenter() : e.position;
      const dx = hc.x - pos.x;
      const dy = (hc.y ?? 0) - pos.y;
      const dz = hc.z - pos.z;
      if (dx * dx + dy * dy + dz * dz <= r2) e.takeHit(3, true);
    }

    // Enemy tanks in the blast take top-zone damage too (friendly fire)
    for (const u of this.enemyUnits) {
      if (!u.tank.isAlive) continue;
      const dx = u.tank.position.x - pos.x;
      const dz = u.tank.position.z - pos.z;
      if (dx * dx + dz * dz <= r2) u.tank.takeHit('top', BOMBER.playerZoneDamage);
    }
  }

  // ---------------------------------------------------------------------------
  // Pause / resume
  // ---------------------------------------------------------------------------

  pauseGame() {
    if (this.state !== GameState.PLAYING) return;
    this.setState(GameState.PAUSED);
    this.soundManager.engineOff();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Must be called from a user input event so pointer lock re-engages. */
  resumeGame() {
    if (this.state !== GameState.PAUSED) return;
    this.setState(GameState.PLAYING);
    this.inputManager.consumeMouseDelta(); // discard motion accumulated while paused
    if (this.cameraController.isPinned) {
      this.cameraController.enterFirstPerson(this._canvas);
    }
  }

  quitToTitle() {
    if (this.state !== GameState.PAUSED && this.state !== GameState.ROUND_END) return;
    this.cameraController.isPinned = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.soundManager.engineOff();
    for (const u of this.enemyUnits) u.ai.setGameState(GameState.MENU);
    for (const u of this.allyUnits)  u.ai.setGameState(GameState.MENU);
    this.setState(GameState.MENU);
  }

  _handleHit(tank, projectile) {
    if (this.state !== GameState.PLAYING || this.pendingRoundResult !== null) return;

    const wt = projectile.weaponType;

    // Non-penetrating weapons (e.g. MG) cannot damage armoured targets
    if (wt?.penetrating === false && tank.isArmoured) return;

    const zone      = this._detectHitZone(tank, projectile);
    const damage    = (wt?.damage ?? 1) * (projectile.damageMultiplier ?? 1);
    const destroyed = tank.takeHit(zone, damage);

    if (destroyed) {
      this.soundManager.explosion(tank.position);
      if (!this.playerTank.isAlive) {
        // Player death ends the run
        this.pendingRoundResult = 'defeat';
        this.roundEndDelayTimer = ROUND.resultDisplayDelay;
      } else if (tank.faction === 'friendly') {
        // An allied tank was lost — no score either way
        this._pushMessage('FRIENDLY ARMOUR LOST');
      } else {
        // An enemy tank went down — the threat manager refills the pool
        this._addPoints(tank.scoreValue ?? SCORE.enemyTank);
        this._pushMessage('ENEMY TANK DESTROYED');
        this._maybeDropSupplies(tank.position.x, tank.position.z);
      }
    } else {
      this.soundManager.clank(tank.position);
      if (tank === this.playerTank) {
        this._pushMessage(`WE'VE BEEN HIT — ${zone.replace('Side', ' side').toUpperCase()} ARMOR`);
      }
    }
  }

  /**
   * Determines which armor zone of `tank` was struck by `projectile`.
   * Uses the projectile's velocity direction transformed into tank local space,
   * then picks the dominant face based on the approach angle.
   *
   * @returns {'top'|'front'|'back'|'leftSide'|'rightSide'}
   */
  _detectHitZone(tank, projectile) {
    const vel = projectile.velocity;
    if (!vel || vel.lengthSq() < 1e-6) return 'front'; // fallback

    const h    = tank.heading;
    const cosH = Math.cos(h);
    const sinH = Math.sin(h);

    // Rotate velocity into tank local space (inverse Y-rotation by -heading)
    // Tank local: +Z = forward, +X = right, +Y = up
    const localVx =  vel.x * cosH - vel.z * sinH;
    const localVy =  vel.y;
    const localVz =  vel.x * sinH + vel.z * cosH;

    const ax = Math.abs(localVx);
    const ay = Math.abs(localVy);
    const az = Math.abs(localVz);

    // Dominant component determines which face was penetrated
    if (ay >= ax && ay >= az) return 'top';
    if (az >= ax)             return localVz < 0 ? 'front' : 'back';
    return localVx < 0 ? 'rightSide' : 'leftSide';
  }

  // ---------------------------------------------------------------------------
  // Entity helpers
  // ---------------------------------------------------------------------------

  /** Shared context passed to every entity update. */
  _entityCtx() {
    return {
      playerTank:        this.playerTank,
      projectileManager: this.projectileManager,
      entityManager:     this.entityManager,
      enemyUnits:        this.enemyUnits,
      findHostile:       (self, maxRange) => this.findHostile(self, maxRange),
    };
  }

  /**
   * Nearest live unit of the opposing side. Enemies use this to pick whoever
   * is closest — the player, an allied tank, or an allied trooper — instead
   * of fixating on the player; allies use it to pick their next target.
   * @param {{faction:string, position:THREE.Vector3}} self
   * @param {number} [maxRange]
   * @returns {object|null}
   */
  findHostile(self, maxRange = Infinity) {
    const seekEnemy = self.faction !== 'enemy';
    let best = null;
    let bestD2 = maxRange * maxRange;

    const consider = (u) => {
      if (!u || !u.isAlive) return;
      const dx = u.position.x - self.position.x;
      const dz = u.position.z - self.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = u; }
    };

    // May be called during init(), before the entity registry exists
    const registry = this.entityManager?.entities ?? [];

    if (seekEnemy) {
      for (const u of this.enemyUnits) consider(u.tank);
      for (const e of registry) {
        // Aircraft are engaged by the player's gun, not chased on the ground
        if (e.faction === 'enemy' && e.kind !== 'bomber' && e.kind !== 'transport') consider(e);
      }
    } else {
      consider(this.playerTank);
      for (const u of this.allyUnits) consider(u.tank);
      for (const e of registry) {
        if (e.faction === 'friendly') consider(e);
      }
    }
    return best;
  }

  /**
   * Checks all live projectiles against the drone.
   */
  _checkDroneHits() {
    for (const d of this.drones) {
      if (!d.isAlive) continue;
      for (const proj of this.projectileManager.getActiveProjectiles()) {
        if (!proj.isAlive || !proj.position) continue;
        if (d.tryHit(proj.position, proj.radius)) {
          proj.kill();
          break;
        }
      }
    }
  }

  /**
   * Checks all live projectiles against all live mines.
   * A hit destroys the mine and kills the projectile.
   */
  _checkMineProjectileHits() {
    if (!this.mineManager) return;
    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (!proj.isAlive || !proj.position) continue;
      if (this.mineManager.checkProjectileHit(proj.position, proj.radius)) {
        proj.kill();
      }
    }
  }

  /**
   * Kills any infantry whose centre is within the player tank's crush radius.
   */
  _checkInfantryCrush() {
    const tx = this.playerTank.position.x;
    const tz = this.playerTank.position.z;
    const crushR2 = 2.0 * 2.0; // (tank half-width + infantry hit radius)²
    for (const inf of this.entityManager.alive(e => e.kind === 'infantry')) {
      const dx = inf.position.x - tx;
      const dz = inf.position.z - tz;
      if (dx * dx + dz * dz <= crushR2) {
        inf.takeHit();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Entity spawning
  // ---------------------------------------------------------------------------

  _makeVehicleSpawnPos(rng, minDist) {
    const spawnX  = SPAWN.player.x;
    const spawnZ  = SPAWN.player.z;
    const maxDist = 110;  // stay inside the initially loaded chunk ring
    const clearR  = 4.5;  // clearance radius to avoid spawning inside obstacles
    let x = 0, z = 0;
    for (let attempts = 0; attempts < 40; attempts++) {
      const ang  = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      x = spawnX + Math.sin(ang) * dist;
      z = spawnZ + Math.cos(ang) * dist;
      const testPos = new THREE.Vector3(x, this.terrain.getHeightAt(x, z), z);
      const blocked = this.obstacleManager?.obstacles.some(
        obs => obs.intersectsSphere(testPos, clearR, 0),
      );
      if (!blocked) break;
    }
    return { x, z };
  }

  /**
   * Clears the registry and spawns a fresh set of every entity type.
   * Entities constructed here pick up the current terrain / validator /
   * mineManager references, so this is also the "reset for new terrain" path.
   */
  _spawnEntities() {
    this.entityManager.clear();
    this._jamVisible      = true;
    this._jamFlickerTimer = 0;

    const base = () => ({
      terrain:           this.terrain,
      movementValidator: this.movementValidator,
      mineManager:       this.mineManager,
    });

    for (let i = 0; i < INFANTRY.count; i++) {
      this.entityManager.add(new InfantryUnit(this.scene, {
        position: this._makeVehicleSpawnPos(null, INFANTRY.minSpawnDist),
        ...base(),
      }));
    }
    for (let i = 0; i < TRUCK.count; i++) {
      this.entityManager.add(new TruckVehicle(this.scene, {
        position: this._makeVehicleSpawnPos(null, TRUCK.minSpawnDist),
        ...base(),
      }));
    }
    for (let i = 0; i < APC.count; i++) {
      this.entityManager.add(new APCVehicle(this.scene, {
        position:        this._makeVehicleSpawnPos(null, APC.minSpawnDist),
        onSpawnInfantry: (inf) => this.entityManager.add(inf),
        ...base(),
      }));
    }
    for (let i = 0; i < JAMMER.count; i++) {
      this.entityManager.add(new JammerTruck(this.scene, {
        position: this._makeVehicleSpawnPos(null, JAMMER.minSpawnDist),
        ...base(),
      }));
    }
    for (let i = 0; i < MINELAYER.count; i++) {
      this.entityManager.add(new MinelayerVehicle(this.scene, {
        position: this._makeVehicleSpawnPos(null, MINELAYER.minSpawnDist),
        ...base(),
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Endless mode: scoring, power-ups, respawns, distance scaling
  // ---------------------------------------------------------------------------

  /** Resets score, power-up timers, and the respawn queue for a new run. */
  _resetEndlessState() {
    this.points        = 0;
    this._radarTimer   = 0;
    this._rapidTimer   = 0;
    this._respawnQueue    = [];
    this._cullTimer       = 0;
    this._wasJamming      = false;
    this._droneRangeTimer = 0;
    this._overdriveTimer  = 0;
    this._apTimer         = 0;
    this._bomberTimer     = 0; // re-rolls a fresh random interval on first tick
    this._spawnedBases    = new Set();
    this._spawnedNests    = new Set();
    this._spawnedAllies   = new Set();
    this._transportTimer  = 0;
    if (this.playerTank) {
      this.playerTank.reloadFactor = 1;
      this.playerTank.speedFactor  = 1;
      this.playerTank.damageFactor = 1;
    }
    if (typeof this._onPointsCallback === 'function') this._onPointsCallback(0);
  }

  _addPoints(n) {
    if (!n) return;
    this.points += n;
    if (typeof this._onPointsCallback === 'function') {
      this._onPointsCallback(this.points);
    }
  }

  /** React subscribes here to display the arcade score. */
  onPointsChange(callback) {
    this._onPointsCallback = callback;
  }

  /** React subscribes here for bottom-of-screen event messages. */
  onMessage(callback) {
    this._onMessageCallback = callback;
  }

  _pushMessage(text) {
    if (typeof this._onMessageCallback === 'function') {
      this._onMessageCallback(text);
    }
  }

  /**
   * Warns when the player has driven beyond the drone's surveillance range;
   * repeats on a cooldown while out of range.
   */
  _checkDroneRange(delta) {
    if (!this.drone?.isAlive || this.drone.isStriking) return;
    this._droneRangeTimer -= delta;
    const dx = this.playerTank.position.x - this.drone.center.x;
    const dz = this.playerTank.position.z - this.drone.center.z;
    const outOfRange = (dx * dx + dz * dz) > DRONE.range * DRONE.range;
    if (outOfRange && this._droneRangeTimer <= 0) {
      this._pushMessage('OUT OF DRONE RANGE — PRESS R TO RETASK');
      this._droneRangeTimer = MESSAGES.droneRangeRepeat;
    } else if (!outOfRange && this._droneRangeTimer > 0) {
      this._droneRangeTimer = 0; // back in range — re-arm immediate warning
    }
  }

  /** Spawns a pickup of `type` at a world position. */
  _dropPickup(x, z, type) {
    this.entityManager.add(new PowerUp(this.scene, {
      position: { x, z }, type, terrain: this.terrain,
    }));
  }

  /**
   * Destroyed enemy armour and vehicles leave supplies behind a quarter of
   * the time — either armour plating or a load of ammunition.
   */
  _maybeDropSupplies(x, z) {
    if (Math.random() >= POWERUP.dropChance) return;
    this._dropPickup(x, z, Math.random() < 0.5 ? 'armour' : 'ammo');
    this._pushMessage('SUPPLIES DROPPED');
  }

  /** Fired by EntityManager whenever a registered entity is destroyed. */
  _handleEntityKill(e, _proj) {
    this._addPoints(e.scoreValue);
    this.soundManager.explosion(e.position);

    // Supply trucks always drop a random power-up where they died
    if (e.kind === 'truck') {
      const types = Object.keys(POWERUP.types);
      const type  = types[Math.floor(Math.random() * types.length)];
      this._dropPickup(e.position.x, e.position.z, type);
    } else if (e.faction === 'enemy' && e.kind !== 'infantry') {
      // APCs, jammers, minelayers, turrets, aircraft — chance of supplies
      this._maybeDropSupplies(e.position.x, e.position.z);
    }

    // Destroyed vehicles come back elsewhere after a delay
    if (e.kind === 'truck' || e.kind === 'apc' || e.kind === 'jammer') {
      this._respawnQueue.push({ kind: e.kind, timer: ENDLESS.respawnDelay });
    }
  }

  /** Random clear position on a ring around the player. */
  _findClearPosNearPlayer(minDist, maxDist) {
    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    let x = px + minDist, z = pz;
    for (let attempts = 0; attempts < 30; attempts++) {
      const ang  = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * (maxDist - minDist);
      x = px + Math.sin(ang) * dist;
      z = pz + Math.cos(ang) * dist;
      if (this.terrain.getHeightAt(x, z) < -1.2) continue; // river
      const y = this.terrain.getHeightAt(x, z) + 0.8;
      if (this.obstacleManager.checkTankCollision({ x, y, z }, 2.5).blocked) continue;
      break;
    }
    return { x, z };
  }

  _updateRespawns(delta) {
    for (let i = this._respawnQueue.length - 1; i >= 0; i--) {
      const entry = this._respawnQueue[i];
      entry.timer -= delta;
      if (entry.timer > 0) continue;
      this._respawnQueue.splice(i, 1);

      const pos = this._findClearPosNearPlayer(ENDLESS.respawnMinDist, ENDLESS.respawnMaxDist);
      const base = {
        terrain:           this.terrain,
        movementValidator: this.movementValidator,
        mineManager:       this.mineManager,
      };

      if (entry.kind === 'truck') {
        this.entityManager.add(new TruckVehicle(this.scene, { position: pos, ...base }));
      } else if (entry.kind === 'apc') {
        this.entityManager.add(new APCVehicle(this.scene, {
          position: pos,
          onSpawnInfantry: (inf) => this.entityManager.add(inf),
          ...base,
        }));
      } else if (entry.kind === 'jammer') {
        this.entityManager.add(new JammerTruck(this.scene, { position: pos, ...base }));
      }
    }
  }

  /**
   * Warns when the player is driving toward a ravine — narrow channels can
   * be hard to read at speed, especially at a shallow approach angle.
   */
  _checkRavineWarning(delta) {
    this._ravineWarnTimer = Math.max(0, (this._ravineWarnTimer ?? 0) - delta);
    const t = this.playerTank;
    if (!t.isAlive || t.speed <= 0.5 || this._ravineWarnTimer > 0) return;
    const sin = Math.sin(t.heading), cos = Math.cos(t.heading);
    for (const d of [10, 16, 22]) {
      if (this.terrain.isHazardAt(t.position.x + sin * d, t.position.z + cos * d)) {
        this._pushMessage('⚠ RAVINE AHEAD');
        this._ravineWarnTimer = 6;
        return;
      }
    }
  }

  /** Player driving into a power-up collects it. */
  _checkPowerUpPickup() {
    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    for (const pu of this.entityManager.alive(e => e.kind === 'powerup')) {
      const dx = pu.position.x - px;
      const dz = pu.position.z - pz;
      if (dx * dx + dz * dz > POWERUP.pickupRadius * POWERUP.pickupRadius) continue;
      pu.collect();
      this.soundManager.pickup();
      if (pu.type === 'armour') {
        const gained = this.playerTank.repair(POWERUP.armourPerZone, POWERUP.armourCap);
        this._pushMessage(gained ? 'ARMOUR REINFORCED' : 'ARMOUR ALREADY AT MAXIMUM');
        continue;
      }
      if (pu.type === 'ammo') {
        // Resupply the emptiest magazine so pickups always matter
        let best = AMMO.order[0], worst = Infinity;
        for (const t of AMMO.order) {
          const frac = this.playerTank.ammo[t] / AMMO.types[t].max;
          if (frac < worst) { worst = frac; best = t; }
        }
        const added = this.playerTank.addAmmo(best, AMMO.types[best].pickup);
        this._pushMessage(`+${added} ${AMMO.types[best].label}`);
        continue;
      }
      this._pushMessage(`${POWERUP.types[pu.type]?.label ?? 'POWER-UP'} ACQUIRED`);
      if (pu.type === 'rapid') {
        this._rapidTimer = POWERUP.rapidDuration;
        this.playerTank.reloadFactor = 0.5;
      } else if (pu.type === 'radar') {
        this._radarTimer = POWERUP.radarDuration;
      } else if (pu.type === 'overdrive') {
        this._overdriveTimer = POWERUP.overdriveDuration;
        this.playerTank.speedFactor = POWERUP.overdriveFactor;
      } else if (pu.type === 'ap') {
        this._apTimer = POWERUP.apDuration;
        this.playerTank.damageFactor = POWERUP.apFactor;
      } else if (pu.type === 'repair') {
        this.playerTank.repair(POWERUP.repairAmount ?? 3);
      } else if (pu.type === 'drone') {
        if (this.drones.filter(d => d.isAlive).length >= DRONE.maxFleet) {
          this._pushMessage('DRONE BAY FULL');
        } else {
          const d = new Drone(this.scene);
          d.reset(this.playerTank.position);
          this.drones.push(d);
        }
      }
    }
  }

  _updatePowerUpTimers(delta) {
    if (this._rapidTimer > 0) {
      this._rapidTimer -= delta;
      if (this._rapidTimer <= 0) this.playerTank.reloadFactor = 1;
    }
    if (this._radarTimer > 0) {
      this._radarTimer -= delta;
    }
    if (this._overdriveTimer > 0) {
      this._overdriveTimer -= delta;
      if (this._overdriveTimer <= 0) this.playerTank.speedFactor = 1;
    }
    if (this._apTimer > 0) {
      this._apTimer -= delta;
      if (this._apTimer <= 0) this.playerTank.damageFactor = 1;
    }
  }

  /**
   * Periodic sweep: entities left beyond the loaded terrain ring are
   * removed (they would otherwise float in the void once their chunks
   * unload). Culled vehicles re-enter the respawn queue so the world
   * stays populated near the player; a stranded enemy tank relocates.
   */
  _cullFarEntities(delta) {
    this._cullTimer += delta;
    if (this._cullTimer < 5) return;
    this._cullTimer = 0;

    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    const em = this.entityManager;
    const FAR2 = 350 * 350; // beyond the 7×7 chunk ring (±224u)

    for (let i = em.entities.length - 1; i >= 0; i--) {
      const e = em.entities[i];
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      const far = (dx * dx + dz * dz) > FAR2;
      const doneDead = !e.isAlive
        && (!e.destructionEffect || e.destructionEffect.isComplete);
      if (far || (doneDead && e.kind === 'powerup')) {
        // Left-behind vehicles come back near the player after a delay
        if (far && e.isAlive && (e.kind === 'truck' || e.kind === 'apc' || e.kind === 'jammer')) {
          this._respawnQueue.push({ kind: e.kind, timer: 8 });
        }
        e.dispose();
        em.entities.splice(i, 1);
      } else if (doneDead && !far) {
        // Finished corpses near the player can go too
        e.dispose();
        em.entities.splice(i, 1);
      }
    }

    // Enemy tanks stranded outside the loaded world → relocate to the hunt
    for (const u of this.enemyUnits) {
      if (!u.tank.isAlive) continue;
      const dx = u.tank.position.x - px;
      const dz = u.tank.position.z - pz;
      if ((dx * dx + dz * dz) > 450 * 450) {
        const pos = this._findClearPosNearPlayer(ENDLESS.respawnMinDist, ENDLESS.respawnMaxDist);
        u.tank._spawnConfig = { ...pos, heading: Math.random() * Math.PI * 2 };
        u.tank.reset(u.tank._spawnConfig);
        u.ai.reset();
        u.ai.generatePatrolWaypoints();
      }
    }

    // Allied armour left far behind is retired rather than teleported —
    // a fresh squad will bring armour along somewhere ahead instead.
    for (let i = this.allyUnits.length - 1; i >= 0; i--) {
      const u = this.allyUnits[i];
      const dx = u.tank.position.x - px;
      const dz = u.tank.position.z - pz;
      const gone = !u.tank.isAlive
        && (!u.tank.destructionEffect || u.tank.destructionEffect.isComplete);
      if ((dx * dx + dz * dz) > 450 * 450 || gone) {
        this.collisionManager.unregisterTank(u.tank);
        u.ai.dispose();
        u.tank.dispose();
        this.allyUnits.splice(i, 1);
      }
    }
  }

  /** Deterministic [0,1) hash for a world cell + world seed + salt. */
  _cellRng(cellX, cellZ, salt) {
    let h = (this.terrain.seed | 0) ^ salt;
    h = Math.imul(h ^ cellX, 0x9e3779b1);
    h = Math.imul(h ^ cellZ, 0x85ebca6b);
    h ^= h >>> 15;
    return seededRandom(h | 0);
  }

  /**
   * Spawns an enemy base if this chunk contains the (deterministic) centre
   * of a base cell that hosts one. Uncommon but reproducible landmarks.
   */
  _maybeSpawnBase(cx, cz, inThisChunk) {
    const cellX = Math.floor(cx / BASE.cellSize);
    const cellZ = Math.floor(cz / BASE.cellSize);
    const key = cellX + ',' + cellZ;
    if (this._spawnedBases.has(key)) return;

    const rng = this._cellRng(cellX, cellZ, 0x0badf00d);
    if (rng() >= BASE.chance) { this._spawnedBases.add(key); return; }

    // Jittered centre within the cell
    const bx = (cellX + 0.25 + rng() * 0.5) * BASE.cellSize;
    const bz = (cellZ + 0.25 + rng() * 0.5) * BASE.cellSize;
    if (Math.hypot(bx, bz) < BASE.minOriginDist) { this._spawnedBases.add(key); return; }
    if (!inThisChunk(bx, bz)) return; // wait until the centre chunk loads

    this._spawnedBases.add(key);
    const gy = this.terrain.getHeightAt(bx, bz);
    if (gy < -1.0) return; // don't build in a ravine

    // HQ building at the centre
    this.entityManager.add(new DestructibleBuilding(this.scene, {
      position: { x: bx, z: bz }, terrain: this.terrain,
    }));

    // Ring of turret emplacements
    for (let i = 0; i < BASE.turretRing; i++) {
      const a = (i / BASE.turretRing) * Math.PI * 2 + rng() * 0.3;
      const x = bx + Math.cos(a) * BASE.radius;
      const z = bz + Math.sin(a) * BASE.radius;
      if (this.terrain.getHeightAt(x, z) < -1.0) continue;
      this.entityManager.add(new TurretEmplacement(this.scene, {
        position: { x, z }, terrain: this.terrain,
      }));
    }

    // Defending infantry inside the compound
    for (let i = 0; i < BASE.infantry; i++) {
      const a = rng() * Math.PI * 2, r = rng() * BASE.radius * 0.7;
      this.entityManager.add(new InfantryUnit(this.scene, {
        position:          { x: bx + Math.cos(a) * r, z: bz + Math.sin(a) * r },
        terrain:           this.terrain,
        movementValidator: this.movementValidator,
        mineManager:       this.mineManager,
      }));
    }

    // Minefield ringing the approach
    this.mineManager.addField(this.terrain, bx, bz, BASE.mineRing, BASE.mineRadius,
      (cellX * 73856093) ^ (cellZ * 19349663));

    this._pushMessage('ENEMY BASE DETECTED IN SECTOR');
  }

  /**
   * Digs infantry into a large crater inside this chunk. The crater itself
   * is part of the terrain (see WorldGenerator.craterOffsetAt) — this only
   * garrisons it: dug-in troops that hold the rim and shrug off some fire.
   */
  _maybeGarrisonCrater(chunk, inThisChunk) {
    const wg = this.terrain.worldGen;
    // Crater cells overlapping this chunk
    const c0x = Math.floor((chunk.cx * CHUNK.size) / CRATER.cellSize);
    const c0z = Math.floor((chunk.cz * CHUNK.size) / CRATER.cellSize);
    const c1x = Math.floor(((chunk.cx + 1) * CHUNK.size) / CRATER.cellSize);
    const c1z = Math.floor(((chunk.cz + 1) * CHUNK.size) / CRATER.cellSize);

    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const key = cx + ',' + cz;
        if (this._spawnedNests.has(key)) continue;
        const crater = wg.getCraterCell(cx, cz);
        if (!crater.exists || crater.radius < CRATER.garrisonMinRadius) continue;
        if (!inThisChunk(crater.centerX, crater.centerZ)) continue;

        this._spawnedNests.add(key);
        if (Math.hypot(crater.centerX, crater.centerZ) < CRATER.garrisonMinOriginDist) continue;

        const rng = this._cellRng(cx, cz, 0x7f4a7c15);
        if (rng() >= CRATER.garrisonChance) continue;
        // Skip craters that are flooded (a crater floor is legitimately low,
        // so test for river hazard rather than a raw height threshold)
        if (this.terrain.isHazardAt(crater.centerX, crater.centerZ)) continue;

        // Ring the troops around the bowl so they fire over the lip
        for (let i = 0; i < CRATER.garrison; i++) {
          const a = (i / CRATER.garrison) * Math.PI * 2 + rng() * 0.8;
          const r = crater.radius * 0.55;
          this.entityManager.add(new InfantryUnit(this.scene, {
            position: {
              x: crater.centerX + Math.sin(a) * r,
              z: crater.centerZ + Math.cos(a) * r,
            },
            terrain:           this.terrain,
            movementValidator: this.movementValidator,
            mineManager:       this.mineManager,
            coverChance:       CRATER.coverChance,
            stationary:        true,
          }));
        }
      }
    }
  }

  /**
   * Spawns an allied squad if this chunk holds an ally cell's centre.
   * Blue troopers fight nearby enemies on their own initiative.
   */
  _maybeSpawnAllies(cx, cz, inThisChunk) {
    const cellX = Math.floor(cx / ALLY.cellSize);
    const cellZ = Math.floor(cz / ALLY.cellSize);
    const key = cellX + ',' + cellZ;
    if (this._spawnedAllies.has(key)) return;

    const rng = this._cellRng(cellX, cellZ, 0x1a2b3c4d);
    if (rng() >= ALLY.chance) { this._spawnedAllies.add(key); return; }

    const ax = (cellX + 0.25 + rng() * 0.5) * ALLY.cellSize;
    const az = (cellZ + 0.25 + rng() * 0.5) * ALLY.cellSize;
    if (!inThisChunk(ax, az)) return;
    this._spawnedAllies.add(key);
    if (Math.hypot(ax, az) < ALLY.minOriginDist) return;
    if (this.terrain.isHazardAt(ax, az)) return;
    if (this.entityManager.alive(e => e.isAlly).length >= ALLY.cap) return;

    const n = ALLY.squadMin + Math.floor(rng() * (ALLY.squadMax - ALLY.squadMin + 1));
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = rng() * 6;
      this.entityManager.add(new InfantryUnit(this.scene, {
        position:          { x: ax + Math.cos(a) * r, z: az + Math.sin(a) * r },
        faction:           'friendly',
        terrain:           this.terrain,
        movementValidator: this.movementValidator,
        mineManager:       this.mineManager,
      }));
    }

    // Occasional armour support rolling with the squad
    const liveAllyTanks = this.allyUnits.filter(u => u.tank.isAlive).length;
    if (rng() < ALLY.tankChance && liveAllyTanks < ALLY.maxTanks) {
      const unit = this._createTankUnit(
        { x: ax + 8, z: az + 8, heading: rng() * Math.PI * 2 },
        { faction: 'friendly', tankClass: 'medium' },
      );
      unit.ai.setGameState(this.state);
      unit.ai.generatePatrolWaypoints();
      this._pushMessage('FRIENDLY ARMOUR IN SECTOR');
    } else {
      this._pushMessage('FRIENDLY SQUAD IN SECTOR');
    }
  }

  /**
   * Garrisons ruins the obstacle generator just produced — defenders on the
   * ground floor and occasionally up on a surviving slab.
   */
  _garrisonRuins() {
    const ruins = this.obstacleManager?.ruins;
    if (!ruins || ruins.length === 0) return;
    for (const ruin of ruins) {
      if (Math.random() >= RUIN.garrisonChance) continue;
      const n = 1 + Math.floor(Math.random() * RUIN.garrisonMax);
      // Only the first surviving storey is usable — higher slabs would leave
      // troops hanging in mid-air once the ruin scrolls out of view.
      const lowFloors = ruin.floors.filter(f => f.y <= RUIN.storeyHeight + 0.1);
      for (let i = 0; i < n; i++) {
        const floor = (lowFloors.length && Math.random() < 0.5)
          ? lowFloors[Math.floor(Math.random() * lowFloors.length)]
          : null;
        const x = floor ? floor.x + (Math.random() - 0.5) * 3 : ruin.x + (Math.random() - 0.5) * 8;
        const z = floor ? floor.z + (Math.random() - 0.5) * 3 : ruin.z + (Math.random() - 0.5) * 8;
        this.entityManager.add(new InfantryUnit(this.scene, {
          position:          { x, z },
          terrain:           this.terrain,
          movementValidator: this.movementValidator,
          mineManager:       this.mineManager,
          coverChance:       RUIN.coverChance,
          stationary:        true,
          yOffset:           floor ? floor.y + 0.3 : 0,
        }));
      }
    }
    this.obstacleManager.ruins = [];
  }

  /**
   * Registers chunk-load spawning: ambient infantry whose density scales
   * with distance from the origin, plus occasional power-up pickups.
   * Called for the initial terrain and again after regeneration.
   */
  _hookChunkSpawns() {
    this.terrain.onChunkLoaded((chunk) => {
      const cx = chunk.cx * CHUNK.size + CHUNK.size / 2;
      const cz = chunk.cz * CHUNK.size + CHUNK.size / 2;
      const cOx = chunk.cx * CHUNK.size, cOz = chunk.cz * CHUNK.size;
      const inThisChunk = (x, z) =>
        x >= cOx && x < cOx + CHUNK.size && z >= cOz && z < cOz + CHUNK.size;

      // Enemy base sites — uncommon fortified compounds with an HQ, a ring of
      // turret emplacements, defenders, and a minefield around the approach.
      this._maybeSpawnBase(cx, cz, inThisChunk);

      // Crater nests — infantry dug into the bigger shell holes
      this._maybeGarrisonCrater(chunk, inThisChunk);

      // Allied squads patrolling the sector
      this._maybeSpawnAllies(cx, cz, inThisChunk);

      // Defenders holding any ruins this chunk just produced
      this._garrisonRuins();

      // Ambient power-up
      if (Math.random() < POWERUP.chunkChance) {
        const x = chunk.cx * CHUNK.size + 6 + Math.random() * (CHUNK.size - 12);
        const z = chunk.cz * CHUNK.size + 6 + Math.random() * (CHUNK.size - 12);
        if (this.terrain.getHeightAt(x, z) > -1.2) {
          const types = Object.keys(POWERUP.types);
          this.entityManager.add(new PowerUp(this.scene, {
            position: { x, z },
            type: types[Math.floor(Math.random() * types.length)],
            terrain: this.terrain,
          }));
        }
      }

      // Turret emplacements — fortress defenders + scattered strongpoints
      const originDist = Math.sqrt(cx * cx + cz * cz);
      const biome = this.terrain.biomeAt(cx, cz);
      if (originDist >= EMPLACEMENT.minOriginDist) {
        const chance = biome === 'fortress' ? EMPLACEMENT.fortressChance : EMPLACEMENT.chunkChance;
        const liveTurrets = this.entityManager.alive(e => e.kind === 'turret').length;
        if (liveTurrets < EMPLACEMENT.maxLive && Math.random() < chance) {
          const x = chunk.cx * CHUNK.size + 6 + Math.random() * (CHUNK.size - 12);
          const z = chunk.cz * CHUNK.size + 6 + Math.random() * (CHUNK.size - 12);
          const y = this.terrain.getHeightAt(x, z);
          const clear = y > -1.2
            && !this.obstacleManager.checkTankCollision({ x, y: y + 1, z }, 3).blocked;
          if (clear) {
            this.entityManager.add(new TurretEmplacement(this.scene, {
              position: { x, z },
              terrain: this.terrain,
            }));
          }
        }
      }

      // Distance-scaled infantry — the world gets meaner the farther you go
      if (originDist < ENDLESS.infantrySafeRadius) return;
      const chance = Math.min(
        ENDLESS.infantryMaxChance,
        ENDLESS.infantryBaseChance + originDist / ENDLESS.infantryChanceScale,
      );
      if (Math.random() > chance) return;
      const liveInfantry = this.entityManager.alive(e => e.kind === 'infantry').length;
      if (liveInfantry >= ENDLESS.infantryCap) return;

      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const x = chunk.cx * CHUNK.size + 4 + Math.random() * (CHUNK.size - 8);
        const z = chunk.cz * CHUNK.size + 4 + Math.random() * (CHUNK.size - 8);
        if (this.terrain.getHeightAt(x, z) < -1.2) continue; // river
        this.entityManager.add(new InfantryUnit(this.scene, {
          position:          { x, z },
          terrain:           this.terrain,
          movementValidator: this.movementValidator,
          mineManager:       this.mineManager,
        }));
      }
    });
  }

  /**
   * Toggles visibility of all enemy entities when a live jammer is within range.
   * Called every frame during PLAYING state.
   */
  _updateJammerEffect(delta) {
    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    // Radar power-up grants jam immunity
    const jamming = this._radarTimer <= 0 && this.entityManager
      .alive(e => e.kind === 'jammer')
      .some(j => j.isJammingPosition(px, pz));

    // Edge-triggered alert when jamming starts
    if (jamming && !this._wasJamming) this._pushMessage('JAMMING DETECTED');
    this._wasJamming = jamming;

    if (jamming) {
      this._jamFlickerTimer -= delta;
      if (this._jamFlickerTimer <= 0) {
        this._jamVisible = !this._jamVisible;
        // Asymmetric: longer invisible periods, shorter visible periods
        const baseDur = this._jamVisible ? JAMMER.flickerOffDuration : JAMMER.flickerOnDuration;
        this._jamFlickerTimer = baseDur * (0.6 + Math.random() * 0.8);
        this._setEnemyVisibility(this._jamVisible);
      }
    } else if (!this._jamVisible) {
      // Jammer out of range — restore visibility
      this._jamVisible = true;
      this._setEnemyVisibility(true);
    }
  }

  /**
   * Culls anything further out than the loaded terrain reaches. Without this
   * a unit 400 units away still renders — a red dot floating in black sky
   * with no ground beneath it. Jammer concealment takes precedence.
   */
  _updateHorizonVisibility() {
    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    // Just inside the loaded ring (loadRadius chunks each way)
    const maxD2 = (CHUNK.loadRadius * CHUNK.size * 0.95) ** 2;

    const apply = (obj, x, z, isEnemy) => {
      if (!obj) return;
      const inRange = ((x - px) ** 2 + (z - pz) ** 2) <= maxD2;
      obj.visible = inRange && (this._jamVisible || !isEnemy);
    };

    for (const u of this.enemyUnits) {
      if (u.tank.isAlive) apply(u.tank.group, u.tank.position.x, u.tank.position.z, true);
    }
    for (const u of this.allyUnits) {
      if (u.tank.isAlive) apply(u.tank.group, u.tank.position.x, u.tank.position.z, false);
    }
    for (const e of this.entityManager.entities) {
      if (!e.isAlive || !e.group) continue;
      apply(e.group, e.position.x, e.position.z, e.faction === 'enemy');
    }
  }

  /**
   * Show/hide all ENEMY-faction entities (tank, infantry, APCs, jammers)
   * and enemy mines. Neutral entities (grey trucks) stay visible.
   */
  _setEnemyVisibility(visible) {
    for (const u of this.enemyUnits) {
      if (u.tank.group && u.tank.isAlive) u.tank.group.visible = visible;
    }
    this.entityManager.setFactionVisibility('enemy', visible);
    if (this.mineManager) this.mineManager.setVisibility(visible);
  }

  _checkMineTrigger() {
    if (!this.mineManager || this.pendingRoundResult !== null) return;
    const minePos = this.mineManager.checkTrigger(
      this.playerTank.position.x, this.playerTank.position.z,
    );
    if (!minePos) return;

    // Determine which horizontal side is closest to the mine, in tank local space.
    // Tank local: +Z = forward (front), +X = right.
    const tank = this.playerTank;
    const dx   = minePos.x - tank.position.x;
    const dz   = minePos.z - tank.position.z;
    const cosH = Math.cos(tank.heading);
    const sinH = Math.sin(tank.heading);
    const localX = dx * cosH - dz * sinH; // right component
    const localZ = dx * sinH + dz * cosH; // forward component

    const closestSide = (Math.abs(localX) >= Math.abs(localZ))
      ? (localX > 0 ? 'rightSide' : 'leftSide')
      : (localZ > 0 ? 'front'     : 'back');

    this.soundManager.explosion(minePos);

    const MINE_DAMAGE = 3;
    let destroyed = false;
    if (tank.takeHit('bottom', MINE_DAMAGE))      destroyed = true;
    if (tank.isAlive && tank.takeHit(closestSide, MINE_DAMAGE)) destroyed = true;

    if (destroyed) {
      this.pendingRoundResult = 'defeat';
      this.roundEndDelayTimer = ROUND.resultDisplayDelay;
    }
  }

  _finishRoundEnd() {
    const result = this.pendingRoundResult;
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;

    for (const u of this.enemyUnits) u.ai.setGameState(GameState.ROUND_END);
    for (const u of this.allyUnits)  u.ai.setGameState(GameState.ROUND_END);
    this.setState(GameState.ROUND_END);

    if (typeof this._roundEndCallback === 'function') {
      this._roundEndCallback(result);
    }
  }

  // ---------------------------------------------------------------------------
  // State management
  // ---------------------------------------------------------------------------

  setState(newState) {
    if (!Object.values(GameState).includes(newState)) {
      console.error(`GameManager.setState: invalid state "${newState}"`);
      return;
    }
    this.state = newState;
    if (this._stateChangeCallback) {
      this._stateChangeCallback(newState);
    }
  }

  onStateChange(callback) {
    this._stateChangeCallback = callback;
  }

  onRoundEnd(callback) {
    this._roundEndCallback = callback;
  }

  /**
   * Sets the player's preferred map type.
   * 'random' (default) picks a different type each round.
   * Any MAP_TYPES value pins every round to that type.
   */
  setMapTypePreference(type) {
    this._mapTypePreference = type || 'random';
  }

  // ---------------------------------------------------------------------------
  // Terrain regeneration
  // ---------------------------------------------------------------------------

  /**
   * Disposes the current terrain and obstacles, generates fresh ones, then
   * resets all systems that hold terrain / obstacle references.
   * @param {number|undefined} seed - Optional seed; random if omitted.
   */
  regenerateTerrain(seed) {
    this.projectileManager.clear();
    this.collisionManager.clear();
    this.effectsManager.clear();

    this.mapType = 'infinite';

    // Rebuild terrain — a fresh seed produces an entirely new world
    this.terrain.dispose();
    this.terrain = new ChunkedTerrain(this.scene);
    this.obstacleManager.clear();
    this.obstacleManager.terrain = this.terrain;
    this.terrain.build(seed, this.mapType);
    this.obstacleManager.generate(this.terrain.seed, this.mapType);

    // Wire convenience reference
    this.terrain.obstacleManager = this.obstacleManager;

    // Rebuild movement validator (obstacleManager reference is unchanged — same instance)
    this.movementValidator = new MovementValidator(this.terrain, this.obstacleManager);

    // Update all systems that hold a terrain or obstacle reference
    this.cameraController.terrain           = this.terrain;

    this.playerTank.terrain                 = this.terrain;
    this.playerTank.movementValidator       = this.movementValidator;
    this.playerTank.reset(SPAWN.player);

    this.projectileManager.terrain          = this.terrain;

    // Enemy pool: a fresh run starts with a single tank — dispose extras,
    // rewire the survivor to the new terrain, rebuild the collision list
    while (this.enemyUnits.length > 1) {
      const u = this.enemyUnits.pop();
      u.ai.dispose();
      u.tank.dispose();
    }
    for (const u of this.allyUnits) { u.ai.dispose(); u.tank.dispose(); }
    this.allyUnits = [];
    this.collisionManager.clearTanks();
    this.collisionManager.registerTank(this.playerTank);
    for (const u of this.enemyUnits) {
      u.tank.terrain           = this.terrain;
      u.tank.movementValidator = this.movementValidator;
      u.tank._spawnConfig      = SPAWN.enemy;
      u.tank.reset(SPAWN.enemy);
      u.ai.terrain             = this.terrain;
      u.ai.obstacleManager     = this.obstacleManager;
      u.ai.reset();
      u.ai.generatePatrolWaypoints();
      this.collisionManager.registerTank(u.tank);
    }
    this._threatLevel      = 1;
    this._threatSpawnTimer = 0;

    // Regenerate mines on the new terrain
    this.mineManager.generate(this.terrain, this.terrain.seed);

    // Respawn all entities on the new terrain (fresh instances pick up the
    // new terrain / validator / mineManager references)
    this._spawnEntities();

    // Re-register chunk-load spawning on the new terrain instance
    this._hookChunkSpawns();

    // Re-wire vehicle blocking provider to the new movementValidator instance
    this._updateMobileEntityProvider();
  }

  /**
   * Injects a provider function into the movement validator so all mobile
   * entities (tanks + vehicles) block each other's movement.
   */
  _updateMobileEntityProvider() {
    this.movementValidator.setMobileEntityProvider(() => [
      this.playerTank,
      ...this.enemyUnits.map(u => u.tank),
      ...this.allyUnits.map(u => u.tank),
      ...this.entityManager.getBlockers(),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    for (const u of this.enemyUnits) {
      u.ai.dispose();
      u.tank.dispose();
    }
    this.enemyUnits = [];
    for (const u of this.allyUnits) {
      u.ai.dispose();
      u.tank.dispose();
    }
    this.allyUnits = [];

    const systems = [
      this.inputManager,
      this.playerTank,
      this.projectileManager,
      this.collisionManager,
      this.obstacleManager,
      this.effectsManager,
      this.cameraController,
      this.terrain,
      ...this.drones,
      this.mineManager,
      this.entityManager,
      this.soundManager,
    ];
    for (const system of systems) {
      if (system) system.dispose();
    }

    if (this.movementValidator) {
      this.movementValidator.dispose();
    }

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.scene                = null;
    this.camera               = null;
    this.clock                = null;
    this.state                = null;
    this._stateChangeCallback = null;
    this._roundEndCallback    = null;
    this.inputManager         = null;
    this.terrain              = null;
    this.cameraController     = null;
    this.movementValidator    = null;
    this.playerTank           = null;
    this.projectileManager    = null;
    this.collisionManager     = null;
    this.obstacleManager      = null;
    this.effectsManager       = null;
    this.drones               = [];
    this.mineManager          = null;
    this.entityManager        = null;
  }
}
