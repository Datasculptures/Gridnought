import * as THREE from 'three';
import { COLORS, CAMERA, MAX_DELTA, SPAWN, ROUND, MAP_TYPES, INFANTRY, WORLD_SIZE } from '../utils/constants.js';
import GameState from './GameState.js';
import InputManager from '../input/InputManager.js';
import Terrain from '../terrain/Terrain.js';
import EffectsManager from '../rendering/EffectsManager.js';
import CameraController from '../camera/CameraController.js';
import MovementValidator from '../physics/MovementValidator.js';
import CollisionManager from '../physics/CollisionManager.js';
import ObstacleManager from '../terrain/ObstacleManager.js';
import Tank from '../entities/Tank.js';
import ProjectileManager from '../entities/ProjectileManager.js';
import AIController from '../ai/AIController.js';
import InfantryUnit from '../entities/InfantryUnit.js';
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
    this.infantry             = [];  // InfantryUnit[]
    this.drone                = null;
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

    // Terrain — pick map type randomly each session
    this.mapType = MAP_TYPES[Math.floor(Math.random() * MAP_TYPES.length)];
    this.terrain = new Terrain(this.scene);
    this.terrain.build(undefined, this.mapType);

    // Obstacles (generated from same seed as terrain for determinism)
    this.obstacleManager = new ObstacleManager(this.scene, this.terrain);
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

    // Drone — passive observer, flies a circular orbit above the battlefield
    this.drone = new Drone(this.scene);

    // Mine manager — generates 0-2 clusters of small red mines each round
    this.mineManager = new MineManager(this.scene);
    this.mineManager.generate(this.terrain, this.terrain.seed);
    this.aiController.mineManager = this.mineManager;

    // Spawn infantry (they wait idle until the round starts)
    this._spawnInfantry();

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

      // Update infantry and check projectile hits against them
      for (const inf of this.infantry) {
        inf.update(delta, this.playerTank, this.projectileManager);
      }

      this.projectileManager.update(delta);
      this.collisionManager.update(delta);

      // Infantry hit detection — runs after CollisionManager so dead projectiles are skipped
      this._checkInfantryHits();

      // Infantry crush — player tank running over infantry kills them
      this._checkInfantryCrush();

      // Mine trigger check — player only (AI avoids mines on its own)
      this._checkMineTrigger();

      // Mines blown up by projectiles
      this._checkMineProjectileHits();

      // Drone hit check
      this._checkDroneHits();

      this.drone.update(delta);
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
      for (const inf of this.infantry) {
        if (!inf.isAlive) inf.update(delta, this.playerTank, this.projectileManager);
      }
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
    // If the player selected a specific map type that differs from the current terrain, rebuild it.
    if (this._mapTypePreference !== 'random' && this.terrain.mapType !== this._mapTypePreference) {
      this.regenerateTerrain();
    }

    this.projectileManager.clear();
    this.collisionManager.clear();
    this.effectsManager.clear();
    this.drone.reset();
    this.mineManager.generate(this.terrain, this.terrain.seed);
    this.playerTank.reset(SPAWN.player);
    this.enemyTank.reset(SPAWN.enemy);
    this.aiController.reset();
    this.aiController.generatePatrolWaypoints();
    this._resetInfantry();
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    this.aiController.setGameState(GameState.PLAYING);
    this.setState(GameState.PLAYING);
  }

  /**
   * Play-Again path — regenerates terrain (and obstacles) then starts a fresh round.
   */
  restartRound() {
    this.pendingRoundResult = null;
    this.roundEndDelayTimer = 0;
    this.regenerateTerrain(); // also calls _resetInfantry() via _spawnInfantry
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
  // Infantry helpers
  // ---------------------------------------------------------------------------

  /**
   * Checks all live projectiles against all live infantry.
   * Runs after CollisionManager so projectiles killed by obstacles/tanks are skipped.
   */
  _checkInfantryHits() {
    const projectiles = this.projectileManager.getActiveProjectiles();
    for (const proj of projectiles) {
      if (!proj.isAlive) continue;
      const pos = proj.position;
      if (!pos) continue;

      for (const inf of this.infantry) {
        if (!inf.isAlive) continue;
        if (proj.owner === inf) continue; // no self-hits
        const hc = inf.getHitCenter();
        const dx = pos.x - hc.x;
        const dy = pos.y - hc.y;
        const dz = pos.z - hc.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= INFANTRY.hitRadius) {
          proj.kill();
          inf.takeHit(null, proj.weaponType?.damage ?? 1);
          break;
        }
      }
    }
  }

  /**
   * Checks whether the player tank has driven over a mine.
   * A triggered mine deals 1 HP to every armor zone.
   */
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
    for (const inf of this.infantry) {
      if (!inf.isAlive) continue;
      const dx = inf.position.x - tx;
      const dz = inf.position.z - tz;
      if (dx * dx + dz * dz <= crushR2) {
        inf.takeHit();
      }
    }
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

  /**
   * Creates INFANTRY.count infantry units at random map positions,
   * kept at least INFANTRY.minSpawnDist away from the player spawn.
   */
  _spawnInfantry() {
    // Dispose any existing infantry first
    for (const inf of this.infantry) inf.dispose();
    this.infantry = [];

    const spawnX   = SPAWN.player.x;
    const spawnZ   = SPAWN.player.z;
    const minD2    = INFANTRY.minSpawnDist * INFANTRY.minSpawnDist;
    const halfW    = WORLD_SIZE * 0.4; // keep 20% margin from edges

    for (let i = 0; i < INFANTRY.count; i++) {
      let x, z, attempts = 0;
      do {
        x = (Math.random() - 0.5) * halfW * 2;
        z = (Math.random() - 0.5) * halfW * 2;
        attempts++;
      } while (((x - spawnX) * (x - spawnX) + (z - spawnZ) * (z - spawnZ)) < minD2 && attempts < 25);

      this.infantry.push(new InfantryUnit(this.scene, {
        position: { x, z },
        terrain:  this.terrain,
        movementValidator: this.movementValidator,
        mineManager: this.mineManager,
      }));
    }
  }

  /**
   * Respawns infantry at new random positions for a new round
   * (reuses existing InfantryUnit instances if available, otherwise spawns fresh).
   */
  _resetInfantry() {
    if (this.infantry.length === 0) {
      this._spawnInfantry();
      return;
    }
    const spawnX = SPAWN.player.x;
    const spawnZ = SPAWN.player.z;
    const minD2  = INFANTRY.minSpawnDist * INFANTRY.minSpawnDist;
    const halfW  = WORLD_SIZE * 0.4;

    // Make sure we have the right count
    while (this.infantry.length < INFANTRY.count) {
      this.infantry.push(new InfantryUnit(this.scene, {
        position: { x: 0, z: 0 },
        terrain:  this.terrain,
        movementValidator: this.movementValidator,
        mineManager: this.mineManager,
      }));
    }
    while (this.infantry.length > INFANTRY.count) {
      this.infantry.pop().dispose();
    }

    for (const inf of this.infantry) {
      let x, z, attempts = 0;
      do {
        x = (Math.random() - 0.5) * halfW * 2;
        z = (Math.random() - 0.5) * halfW * 2;
        attempts++;
      } while (((x - spawnX) * (x - spawnX) + (z - spawnZ) * (z - spawnZ)) < minD2 && attempts < 25);

      // Update terrain/validator/mineManager in case regenerateTerrain was called
      inf.terrain           = this.terrain;
      inf.movementValidator = this.movementValidator;
      inf.mineManager       = this.mineManager;
      inf.reset({ x, z });
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

    // Pick map type — respect player preference; fall back to random
    this.mapType = (this._mapTypePreference && this._mapTypePreference !== 'random')
      ? this._mapTypePreference
      : MAP_TYPES[Math.floor(Math.random() * MAP_TYPES.length)];

    // Rebuild terrain
    this.terrain.dispose();
    this.terrain = new Terrain(this.scene);
    this.terrain.build(seed, this.mapType);

    // Rebuild obstacles for the new terrain
    this.obstacleManager.clear();
    this.obstacleManager.terrain = this.terrain;
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

    // Respawn infantry on the new terrain (picks up new mineManager automatically)
    this._resetInfantry();
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
    ];
    for (const system of systems) {
      if (system) system.dispose();
    }

    for (const inf of this.infantry) inf.dispose();
    this.infantry = [];

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
  }
}
