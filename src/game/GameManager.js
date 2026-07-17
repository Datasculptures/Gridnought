import * as THREE from 'three';
import { COLORS, CAMERA, MAX_DELTA, SPAWN, ROUND, INFANTRY, TRUCK, APC, JAMMER } from '../utils/constants.js';
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
    this.enemyTank            = null;
    this.projectileManager    = null;
    this.aiController         = null;
    this.collisionManager     = null;
    this.obstacleManager      = null;
    this.effectsManager       = null;
    this.entityManager        = null; // unified registry: infantry, trucks, APCs, jammers, ...
    this.drone                = null;

    // Jammer effect state
    this._jamFlickerTimer     = 0;
    this._jamVisible          = true;
    this.mineManager          = null;

    // Map type for current round + player-selected preference ('random' = pick randomly)
    this.mapType              = 'hills';
    this._mapTypePreference   = 'random';

    // Round flow
    this.pendingRoundResult   = null;
    this.roundEndDelayTimer   = 0;

    this._loop = this._loop.bind(this);
  }

  init(canvasElement) {
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

    // Enemy tank (AI-controlled)
    this.enemyTank = new Tank(this.scene, {
      position: SPAWN.enemy,
      color: COLORS.enemyTank,
      terrain: this.terrain,
      inputManager: null,
      movementValidator: this.movementValidator,
    });
    this.enemyTank.setAimDependencies(null, this.projectileManager);

    // AI controller — obstacle-aware
    this.aiController = new AIController(
      this.enemyTank, this.terrain, this.projectileManager, this.obstacleManager,
    );
    this.aiController.setTarget(this.playerTank);
    this.enemyTank.setAIController(this.aiController);

    // Collision manager — obstacle-aware
    this.collisionManager = new CollisionManager(this.projectileManager, this.obstacleManager);
    this.collisionManager.registerTank(this.playerTank);
    this.collisionManager.registerTank(this.enemyTank);
    this.collisionManager.onHit((tank, proj) => this._handleHit(tank, proj));

    // Effects (muzzle flash + hit sparks)
    this.effectsManager = new EffectsManager(this.scene);
    this.playerTank.effectsManager = this.effectsManager;
    this.enemyTank.effectsManager  = this.effectsManager;
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

    // Drone — passive observer, flies a circular orbit above the battlefield
    this.drone = new Drone(this.scene);

    // Mine manager — generates 0-2 clusters of small red mines each round
    this.mineManager = new MineManager(this.scene);
    this.mineManager.generate(this.terrain, this.terrain.seed);
    this.aiController.mineManager = this.mineManager;

    // Unified entity registry + initial spawns (idle until the round starts)
    this.entityManager = new EntityManager();
    this._spawnEntities();

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
      this.aiController.update(delta);
      this.playerTank.update(delta);
      this.enemyTank.update(delta);

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

      this.drone.update(delta, this.playerTank.position);
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
      if (!this.enemyTank.isAlive) this.enemyTank.update(delta);
      this.entityManager.update(delta, this._entityCtx(), { deadOnly: true });
      this._setEnemyVisibility(true); // restore full visibility at round end
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
    this.regenerateTerrain();
    this.drone.reset();
    this.aiController.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
  }

  /**
   * Play-Again path — regenerates terrain (and obstacles) then starts a fresh round.
   */
  restartRound() {
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    // Always pick a random map on Play Again, regardless of player preference
    const saved = this._mapTypePreference;
    this._mapTypePreference = 'random';
    this.regenerateTerrain();
    this._mapTypePreference = saved;
    this.drone.reset();
    this.aiController.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
  }

  _handleHit(tank, projectile) {
    if (this.state !== GameState.PLAYING || this.pendingRoundResult !== null) return;

    const wt = projectile.weaponType;

    // Non-penetrating weapons (e.g. MG) cannot damage armoured targets
    if (wt?.penetrating === false && tank.isArmoured) return;

    const zone      = this._detectHitZone(tank, projectile);
    const damage    = wt?.damage ?? 1;
    const destroyed = tank.takeHit(zone, damage);

    if (destroyed) {
      const isPlayerDead = !this.playerTank.isAlive;
      const isEnemyDead  = !this.enemyTank.isAlive;
      if (isPlayerDead || isEnemyDead) {
        this.pendingRoundResult = isPlayerDead ? 'defeat' : 'victory';
        this.roundEndDelayTimer = ROUND.resultDisplayDelay;
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

  /**
   * Toggles visibility of all enemy entities when a live jammer is within range.
   * Called every frame during PLAYING state.
   */
  _updateJammerEffect(delta) {
    const px = this.playerTank.position.x;
    const pz = this.playerTank.position.z;
    const jamming = this.entityManager
      .alive(e => e.kind === 'jammer')
      .some(j => j.isJammingPosition(px, pz));

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
    if (this.enemyTank?.group) this.enemyTank.group.visible = visible;
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

    this.aiController.setGameState(GameState.ROUND_END);
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

    this.enemyTank.terrain                  = this.terrain;
    this.enemyTank.movementValidator        = this.movementValidator;
    this.enemyTank.reset(SPAWN.enemy);

    this.projectileManager.terrain          = this.terrain;

    // CollisionManager already holds the same obstacleManager reference — no change needed
    // (obstacleManager was cleared and re-generated in-place above)

    this.aiController.terrain               = this.terrain;
    this.aiController.obstacleManager       = this.obstacleManager;
    this.aiController.reset();
    this.aiController.generatePatrolWaypoints();

    // Regenerate mines on the new terrain
    this.mineManager.generate(this.terrain, this.terrain.seed);

    // Respawn all entities on the new terrain (fresh instances pick up the
    // new terrain / validator / mineManager references)
    this._spawnEntities();

    // Re-wire vehicle blocking provider to the new movementValidator instance
    this._updateMobileEntityProvider();
  }

  /**
   * Injects a provider function into the movement validator so all mobile
   * entities (tanks + vehicles) block each other's movement.
   */
  _updateMobileEntityProvider() {
    this.movementValidator.setMobileEntityProvider(() => [
      this.playerTank, this.enemyTank,
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

    const systems = [
      this.inputManager,
      this.aiController,
      this.playerTank,
      this.enemyTank,
      this.projectileManager,
      this.collisionManager,
      this.obstacleManager,
      this.effectsManager,
      this.cameraController,
      this.terrain,
      this.drone,
      this.mineManager,
      this.entityManager,
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
    this.enemyTank            = null;
    this.projectileManager    = null;
    this.aiController         = null;
    this.collisionManager     = null;
    this.obstacleManager      = null;
    this.effectsManager       = null;
    this.drone                = null;
    this.mineManager          = null;
    this.entityManager        = null;
  }
}
