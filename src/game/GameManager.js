import * as THREE from 'three';
import { COLORS, CAMERA, MAX_DELTA, SPAWN, ROUND, INFANTRY, TRUCK, APC, JAMMER, TANK, POWERUP, ENDLESS, SCORE, CHUNK, DRONE, MESSAGES } from '../utils/constants.js';
import GameState from './GameState.js';
import InputManager from '../input/InputManager.js';
import ChunkedTerrain from '../terrain/ChunkedTerrain.js';
import EffectsManager from '../rendering/EffectsManager.js';
import CameraController from '../camera/CameraController.js';
import MovementValidator from '../physics/MovementValidator.js';
import CollisionManager from '../physics/CollisionManager.js';
import ObstacleManager from '../terrain/ObstacleManager.js';
import Tank from '../entities/Tank.js';
import ProjectileManager from '../entities/ProjectileManager.js';
import AIController from '../ai/AIController.js';
import InfantryUnit from '../entities/InfantryUnit.js';
import TruckVehicle  from '../entities/TruckVehicle.js';
import APCVehicle    from '../entities/APCVehicle.js';
import JammerTruck   from '../entities/JammerTruck.js';
import EntityManager from '../entities/EntityManager.js';
import PowerUp from '../entities/PowerUp.js';
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
    this.projectileManager    = null;
    this.collisionManager     = null;
    this.obstacleManager      = null;
    this.effectsManager       = null;
    this.entityManager        = null; // unified registry: infantry, trucks, APCs, jammers, ...
    this.drone                = null;

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

    // Player tank
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

    // R retasks the drone to circle a point above the tank's position
    this.inputManager.onKeyPress('KeyR', () => {
      if (this.state !== GameState.PLAYING || !this.drone?.isAlive) return;
      this.drone.retask(this.playerTank.position);
      this._pushMessage('DRONE RETASKED — MOVING TO STATION');
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

    // Drone — passive observer, flies a circular orbit above the battlefield
    this.drone = new Drone(this.scene);

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
      this._updateThreat(delta);

      // Stream terrain chunks around the player
      this.terrain.setFocus(this.playerTank.position.x, this.playerTank.position.z);

      // All registered entities (infantry, trucks, APCs, jammers, ...)
      this.entityManager.update(delta, this._entityCtx());

      // Jammer flicker effect
      this._updateJammerEffect(delta);

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
      this._checkPowerUpPickup();
      this._updatePowerUpTimers(delta);
      this._updateRespawns(delta);
      this._cullFarEntities(delta);

      // Audio: listener follows player, engine hum tracks speed
      this.soundManager.setListenerPosition(this.playerTank.position.x, this.playerTank.position.z);
      this.soundManager.engine(Math.min(1, Math.abs(this.playerTank.speed) / TANK.moveSpeed));

      this.drone.update(delta);
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
  startRound() {
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    this._resetEndlessState();
    this.regenerateTerrain();
    this.drone.reset(SPAWN.player);
    for (const u of this.enemyUnits) u.ai.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
    // Straight into the tank — first-person from the first frame.
    // Called from the start button/key event, so pointer lock is granted.
    this.cameraController.enterFirstPerson(this._canvas);
  }

  /**
   * Play-Again path — regenerates terrain (and obstacles) then starts a fresh round.
   */
  restartRound() {
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    this._resetEndlessState();
    this.regenerateTerrain();
    this.drone.reset(SPAWN.player);
    for (const u of this.enemyUnits) u.ai.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
    this.cameraController.enterFirstPerson(this._canvas);
  }

  // ---------------------------------------------------------------------------
  // Enemy tank pool (threat rating)
  // ---------------------------------------------------------------------------

  /** Creates a fully-wired AI enemy tank and adds it to the pool. */
  _createEnemyUnit(spawn) {
    const tank = new Tank(this.scene, {
      position: { x: spawn.x, z: spawn.z, heading: spawn.heading ?? Math.random() * Math.PI * 2 },
      color: COLORS.enemyTank,
      terrain: this.terrain,
      inputManager: null,
      movementValidator: this.movementValidator,
    });
    tank.setAimDependencies(null, this.projectileManager);
    tank.effectsManager = this.effectsManager;
    tank.soundManager   = this.soundManager;

    const ai = new AIController(tank, this.terrain, this.projectileManager, this.obstacleManager);
    ai.setTarget(this.playerTank);
    ai.mineManager = this.mineManager;
    ai.setGameState(this.state ?? GameState.MENU);
    tank.setAIController(ai);

    this.collisionManager.registerTank(tank);
    const unit = { tank, ai };
    this.enemyUnits.push(unit);
    return unit;
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
      const unit = this._createEnemyUnit(spawn);
      unit.ai.setGameState(GameState.PLAYING);
      unit.ai.generatePatrolWaypoints();
    }
    this._pushMessage('ENEMY ARMOR INBOUND');
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
      } else {
        // An enemy tank went down — the threat manager refills the pool
        this._addPoints(SCORE.enemyTank);
        this._pushMessage('ENEMY TANK DESTROYED');
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
    };
  }

  /**
   * Checks all live projectiles against the drone.
   */
  _checkDroneHits() {
    if (!this.drone || !this.drone.isAlive) return;
    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (!proj.isAlive || !proj.position) continue;
      if (this.drone.tryHit(proj.position, proj.radius)) {
        proj.kill();
        break;
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
    if (!this.drone?.isAlive) return;
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

  /** Fired by EntityManager whenever a registered entity is destroyed. */
  _handleEntityKill(e, _proj) {
    this._addPoints(e.scoreValue);
    this.soundManager.explosion(e.position);

    // Supply trucks drop a random power-up where they died
    if (e.kind === 'truck') {
      const types = Object.keys(POWERUP.types);
      const type  = types[Math.floor(Math.random() * types.length)];
      this.entityManager.add(new PowerUp(this.scene, {
        position: { x: e.position.x, z: e.position.z },
        type,
        terrain: this.terrain,
      }));
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
      this._pushMessage(`${POWERUP.types[pu.type]?.label ?? 'POWER-UP'} ACQUIRED`);
      if (pu.type === 'repair') {
        this.playerTank.repair(POWERUP.repairAmount);
      } else if (pu.type === 'rapid') {
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

      // Distance-scaled infantry — the world gets meaner the farther you go
      const originDist = Math.sqrt(cx * cx + cz * cz);
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

    const systems = [
      this.inputManager,
      this.playerTank,
      this.projectileManager,
      this.collisionManager,
      this.obstacleManager,
      this.effectsManager,
      this.cameraController,
      this.terrain,
      this.drone,
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
    this.drone                = null;
    this.mineManager          = null;
    this.entityManager        = null;
  }
}
