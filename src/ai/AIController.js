import * as THREE from 'three';
import { AI, CELL_SIZE, COLLISION, PROJECTILE, TANK, HAZARD } from '../utils/constants.js';
import GameState from '../game/GameState.js';
import { terrainBlocksShot, hitPointOf } from '../utils/lineOfSight.js';

const VALID_STATES = new Set(['patrol', 'detect', 'pursue', 'aim', 'fire']);

/**
 * Five-state FSM that drives an enemy tank.
 * Produces a `commands` object each frame; Tank.update() reads those commands
 * through the same validation pipeline as player input.
 *
 * States: patrol → detect → pursue → aim → fire (→ pursue)
 */
export default class AIController {
  /**
   * @param {object}      tank              - The Tank instance this AI controls.
   * @param {object}      terrain           - Terrain reference.
   * @param {object}      projectileManager - Shared ProjectileManager.
   * @param {object|null} obstacleManager   - ObstacleManager for nav and LOS checks.
   */
  constructor(tank, terrain, projectileManager, obstacleManager) {
    this.tank              = tank;
    this.terrain           = terrain;
    this.projectileManager = projectileManager;
    this.obstacleManager   = obstacleManager || null;
    this.mineManager       = null; // injected by GameManager after MineManager is created
    this.playerTank        = null; // set via setTarget()

    // FSM
    this.state                  = 'patrol';
    this.stateTimer             = 0;
    this.patrolWaypoints        = [];
    this.currentWaypointIndex   = 0;
    this.pursuitRepositionTimer = 0;
    this.pursuitOffset          = null;
    this.aimSettleTimer         = 0;
    this.postFireTimer          = 0;

    // Combat manoeuvring — the hull keeps circling while the turret works
    this.orbitDirection = Math.random() < 0.5 ? 1 : -1;
    this.orbitTimer     = AI.orbitFlipInterval;

    // Stuck detection
    this.stuckCheckTimer         = 0;
    this.lastStuckCheckPosition  = new THREE.Vector3();
    this.isRecoveringFromStuck   = false;
    this.stuckRecoveryTimer      = 0;
    this.stuckRecoveryDirection  = 1; // alternates between +1 and -1 each recovery

    // Command output — read by Tank.update() as if they were player inputs
    this.commands = {
      moveInput: 0,
      turnInput: 0,
      aimTarget: null,
      fire:      false,
      elevation: TANK.barrel.defaultElevation,
    };

    // Current game state — guards update() during non-PLAYING states
    this.gameState = null;
  }

  /** Called by GameManager after construction. */
  setTarget(playerTank) {
    this.playerTank = playerTank;
  }

  /**
   * Supplies a function returning the unit this tank should currently be
   * fighting. Called every frame so the AI always engages whoever is nearest
   * rather than locking onto one opponent for the whole battle.
   * @param {() => object|null} fn
   */
  setTargetProvider(fn) {
    this._targetProvider = fn;
  }

  /**
   * Notifies the AI of the current game state.
   * Clears all commands immediately when the game is not PLAYING.
   */
  setGameState(state) {
    this.gameState = state;
    if (state === GameState.ROUND_END || state === GameState.MENU) {
      this.commands.moveInput = 0;
      this.commands.turnInput = 0;
      this.commands.aimTarget = null;
      this.commands.fire      = false;
      this.commands.elevation = TANK.barrel.defaultElevation;
    }
  }

  // ---------------------------------------------------------------------------
  // System interface
  // ---------------------------------------------------------------------------

  update(delta) {
    if (!this.tank || !this.terrain) return;
    if (this.gameState === GameState.ROUND_END || this.gameState === GameState.MENU) return;

    // Reset per-frame commands (fire is reset by Tank.update after reading)
    this.commands.moveInput = 0;
    this.commands.turnInput = 0;
    this.commands.aimTarget = null;

    if (!this.tank.isAlive) return;

    // Re-acquire the nearest opponent each frame. Whoever is closest gets
    // hunted; if they're out of reach the pursuit states close the distance.
    if (this._targetProvider) {
      const next = this._targetProvider();
      if (next !== this.playerTank) {
        this.playerTank = next;
        // A new target means the old approach is stale
        if (this.state === 'aim' || this.state === 'fire') this.state = 'pursue';
      }
    }

    // Stuck detection always runs before the state machine
    this._runStuckDetection(delta);

    if (this.isRecoveringFromStuck) {
      this._runStuckRecovery(delta);
      return;
    }

    // Ravine escape overrides everything — a tank that ends up in deep water
    // climbs the bank before it resumes hunting.
    if (this._runRavineEscape(delta)) return;

    // Validate state
    if (!VALID_STATES.has(this.state)) {
      console.warn(`AIController: unknown state "${this.state}", resetting to patrol`);
      this.state = 'patrol';
    }

    // No live target — patrol only
    if (!this.playerTank || !this.playerTank.isAlive) {
      this.updatePatrol(delta);
      return;
    }

    switch (this.state) {
      case 'patrol': this.updatePatrol(delta); break;
      case 'detect': this.updateDetect(delta); break;
      case 'pursue': this.updatePursue(delta); break;
      case 'aim':    this.updateAim(delta);    break;
      case 'fire':   this.updateFire(delta);   break;
    }

    // Last word on steering: whatever the state machine wants, don't drive
    // into a ravine to get there.
    this._avoidHazardAhead();
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  updatePatrol(delta) {
    if (this.patrolWaypoints.length === 0) {
      this.generatePatrolWaypoints();
    }

    const tank = this.tank;
    let wp     = this.patrolWaypoints[this.currentWaypointIndex];
    const dx   = wp.x - tank.position.x;
    const dz   = wp.z - tank.position.z;

    // Reaching a waypoint rolls straight on to the next — a patrol that parks
    // is a free kill, so the tracks never stop turning.
    if (Math.sqrt(dx * dx + dz * dz) <= CELL_SIZE * 2) {
      this.currentWaypointIndex =
        (this.currentWaypointIndex + 1) % this.patrolWaypoints.length;
      wp = this.patrolWaypoints[this.currentWaypointIndex];
    }
    this.stateTimer = 0;
    this.commands.moveInput = 1;
    this.commands.turnInput = this._computeTurnCommand(
      tank.heading, wp.x, wp.z, tank.position.x, tank.position.z,
    );

    // Detection check
    if (this.playerTank && this.playerTank.isAlive) {
      const pdx   = this.playerTank.position.x - tank.position.x;
      const pdz   = this.playerTank.position.z - tank.position.z;
      const pDist = Math.sqrt(pdx * pdx + pdz * pdz);
      if (pDist <= AI.detectionRange) {
        this.state      = 'detect';
        this.stateTimer = 0;
      }
    }
  }

  /**
   * Computes the elevation angle (radians) for a straight-line (gravity=0) shot
   * to reach a target at the given horizontal distance and height difference.
   */
  _directElevation(horizDist, dy) {
    return Math.atan2(dy, Math.max(0.1, horizDist));
  }

  /** Maximum horizontal range the cannon can reach (gravity=0, straight line). */
  _maxRange() {
    return PROJECTILE.muzzleVelocity * 40; // 31 * 40 = 1240 — full map and beyond
  }

  updateDetect(delta) {
    this.stateTimer += delta;
    this.commands.aimTarget = this.playerTank.position.clone();

    const dx    = this.playerTank.position.x - this.tank.position.x;
    const dz    = this.playerTank.position.z - this.tank.position.z;
    const pDist = Math.sqrt(dx * dx + dz * dz);

    // Close the distance while the crew reacts, rather than sitting still
    this.commands.moveInput = 1;
    this.commands.turnInput = this._computeTurnCommand(
      this.tank.heading, this.playerTank.position.x, this.playerTank.position.z,
      this.tank.position.x, this.tank.position.z,
    );

    if (pDist > AI.loseTargetRange || !this.playerTank.isAlive) {
      this.state      = 'patrol';
      this.stateTimer = 0;
      return;
    }

    if (this.stateTimer >= AI.reactionDelay) {
      this.state      = 'pursue';
      this.stateTimer = 0;
      this._generatePursuitOffset();
    }
  }

  updatePursue(delta) {
    const tank   = this.tank;
    const player = this.playerTank;
    const dx     = player.position.x - tank.position.x;
    const dz     = player.position.z - tank.position.z;
    const pDist  = Math.sqrt(dx * dx + dz * dz);

    if (pDist > AI.loseTargetRange || !player.isAlive) {
      this.state = 'patrol';
      return;
    }

    this.pursuitRepositionTimer -= delta;
    if (this.pursuitRepositionTimer <= 0) {
      this._generatePursuitOffset();
    }

    const off = this.pursuitOffset || { x: 0, z: AI.pursuitDistance };
    let targetX = player.position.x + off.x;
    let targetZ = player.position.z + off.z;

    // Validate pursuit target is not inside an obstacle; retry up to 3 times
    if (this.obstacleManager) {
      const ty = this.terrain.getHeightAt(targetX, targetZ) + COLLISION.tankHitYOffset;
      if (this.obstacleManager.checkTankCollision({ x: targetX, y: ty, z: targetZ }, COLLISION.tankHitRadius).blocked) {
        let found = false;
        for (let retry = 0; retry < 3; retry++) {
          this._generatePursuitOffset();
          const nx = player.position.x + this.pursuitOffset.x;
          const nz = player.position.z + this.pursuitOffset.z;
          const ny = this.terrain.getHeightAt(nx, nz) + COLLISION.tankHitYOffset;
          if (!this.obstacleManager.checkTankCollision({ x: nx, y: ny, z: nz }, COLLISION.tankHitRadius).blocked) {
            targetX = nx;
            targetZ = nz;
            found   = true;
            break;
          }
        }
        if (!found) {
          // Fall back to player position directly
          targetX = player.position.x;
          targetZ = player.position.z;
        }
      }
    }

    // Mine avoidance: if target position is in a mine zone, abort pursuit and reposition
    if (this.mineManager && this.mineManager.isMineNearby(targetX, targetZ)) {
      this._generatePursuitOffset();
    }

    const tdx   = targetX - tank.position.x;
    const tdz   = targetZ - tank.position.z;
    const tDist = Math.sqrt(tdx * tdx + tdz * tdz);

    if (tDist > AI.pursuitDistanceTolerance) {
      this.commands.moveInput = 1;
      this.commands.turnInput = this._computeTurnCommand(
        tank.heading, targetX, targetZ, tank.position.x, tank.position.z,
      );
    } else {
      // Arrived at the stand — start circling rather than stopping dead
      this._orbitDrive(delta, player);
    }

    this.commands.aimTarget = player.position.clone();
    this.commands.elevation = this._directElevation(pDist, player.position.y - this.tank.position.y);

    // Transition to aim when close enough, turret is roughly on-target, and
    // there is actually a shot to take from here
    if (pDist <= AI.pursuitDistance + AI.pursuitDistanceTolerance) {
      const toPlayer  = new THREE.Vector3(dx, 0, dz).normalize();
      const turretDir = tank.getTurretDirection();
      const dot       = Math.min(1, Math.max(-1, toPlayer.dot(turretDir)));
      if (Math.acos(dot) < AI.aimTolerance * 3 && this.hasFiringSolution(player)) {
        this.state          = 'aim';
        this.aimSettleTimer = 0;
      }
    }
  }

  updateAim(delta) {
    const tank   = this.tank;
    const player = this.playerTank;
    const dx     = player.position.x - tank.position.x;
    const dz     = player.position.z - tank.position.z;
    const pDist  = Math.sqrt(dx * dx + dz * dz);

    // Aiming happens on the move — the turret tracks independently of the hull
    this._orbitDrive(delta, player);
    this.commands.aimTarget = player.position.clone();
    this.commands.elevation = this._directElevation(pDist, player.position.y - this.tank.position.y);

    if (pDist > AI.loseTargetRange || !player.isAlive) {
      this.state = 'patrol';
      return;
    }

    if (pDist > AI.pursuitDistance + AI.pursuitDistanceTolerance * 2) {
      this.state = 'pursue';
      return;
    }

    // Re-check the shot every frame, not just at the moment of firing. A hill
    // or a wall between gun and target means this stand is worthless — go find
    // one that can actually see out.
    if (!this.hasFiringSolution(player)) {
      this.state = 'pursue';
      this._generatePursuitOffset(player);
      this.aimSettleTimer = 0;
      return;
    }

    const toPlayer  = new THREE.Vector3(dx, 0, dz).normalize();
    const turretDir = tank.getTurretDirection();
    const dot       = Math.min(1, Math.max(-1, toPlayer.dot(turretDir)));
    const angle     = Math.acos(dot);

    if (angle <= AI.aimTolerance) {
      this.aimSettleTimer += delta;
      if (this.aimSettleTimer >= AI.aimSettleTime) {
        this.state         = 'fire';
        this.postFireTimer = 0;
      }
    } else {
      this.aimSettleTimer = 0;
    }
  }

  updateFire(delta) {
    const dx = this.playerTank.position.x - this.tank.position.x;
    const dz = this.playerTank.position.z - this.tank.position.z;
    const pDist = Math.sqrt(dx * dx + dz * dz);

    this.commands.aimTarget = this.playerTank.position.clone();
    this.commands.elevation = this._directElevation(pDist, this.playerTank.position.y - this.tank.position.y);
    this._orbitDrive(delta, this.playerTank); // keep rolling through the shot

    // A hill or a wall between the gun and the target makes this stand
    // worthless — break off and find one that can actually see out rather
    // than dumping rounds into dirt.
    if (!this.hasFiringSolution(this.playerTank)) {
      this.state = 'pursue';
      this._generatePursuitOffset(this.playerTank);
      return;
    }

    // Fire whenever the gun is loaded and the target is in reach. The tank's
    // own reload timer rate-limits this, so it shoots as fast as it can rather
    // than missing its window while circling.
    if (this.tank.canFire && pDist <= this._maxRange()) {
      this.commands.fire = true;
    }

    // Periodically break off to a fresh orbit stand so it never settles into
    // a predictable circle the player can lead.
    this.postFireTimer += delta;
    if (this.postFireTimer >= AI.postFirePause) {
      this.state = 'pursue';
      this._generatePursuitOffset(this.playerTank);
    }
  }

  // ---------------------------------------------------------------------------
  // Combat manoeuvring
  // ---------------------------------------------------------------------------

  /**
   * Keeps the hull rolling while the turret does the work. The tank circles
   * its target at the preferred standoff, reversing direction every few
   * seconds — a moving gun platform is a far harder thing to hit than one
   * that parks itself to shoot.
   * @param {number} delta
   * @param {object} target
   */
  _orbitDrive(delta, target) {
    if (!target) { this.commands.moveInput = 1; return; }

    this.orbitTimer -= delta;
    if (this.orbitTimer <= 0) {
      this.orbitDirection = -this.orbitDirection;
      this.orbitTimer     = AI.orbitFlipInterval * (0.6 + Math.random() * 0.8);
    }

    const tank = this.tank;
    const dx   = tank.position.x - target.position.x;
    const dz   = tank.position.z - target.position.z;
    const dist = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));

    // Bearing from the target out to us, swung sideways to make it a circle,
    // with the radius pulled back toward the standoff ring.
    const bearing = Math.atan2(dx, dz) + this.orbitDirection * AI.orbitStep;
    const ring    = Math.max(AI.minStandoff, dist + (AI.pursuitDistance - dist) * 0.5);
    const gx      = target.position.x + Math.sin(bearing) * ring;
    const gz      = target.position.z + Math.cos(bearing) * ring;

    this.commands.moveInput = 1;
    this.commands.turnInput = this._computeTurnCommand(
      tank.heading, gx, gz, tank.position.x, tank.position.z,
    );
  }

  // ---------------------------------------------------------------------------
  // Line-of-sight
  // ---------------------------------------------------------------------------

  /**
   * True when this tank can actually put a round into `target` from where it
   * stands — gun to hit-centre, checked against both obstacles and the ground
   * itself.
   * @param {object} target
   */
  hasFiringSolution(target) {
    if (!target) return false;
    const from = this.tank.getBarrelTip
      ? this.tank.getBarrelTip()
      : { x: this.tank.position.x, y: this.tank.position.y + AI.muzzleHeight, z: this.tank.position.z };
    return this.hasLineOfSight(from, hitPointOf(target));
  }

  /**
   * Returns true if a straight-line projectile path from fromPos to toPos
   * is not blocked by terrain or by any obstacle.
   * O(n) where n ≤ OBSTACLES.count.max, plus a fixed terrain march.
   *
   * @param {{ x, y, z }} fromPos
   * @param {{ x, y, z }} toPos
   */
  hasLineOfSight(fromPos, toPos) {
    if (terrainBlocksShot(this.terrain, fromPos, toPos)) return false;
    if (!this.obstacleManager) return true;

    const ddx = toPos.x - fromPos.x;
    const ddy = toPos.y - fromPos.y;
    const ddz = toPos.z - fromPos.z;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

    if (dist < 0.001) return true;

    const dir = { x: ddx / dist, y: ddy / dist, z: ddz / dist };

    for (const obs of this.obstacleManager.getObstacles()) {
      const result = obs.intersectsRay(fromPos, dir, dist);
      if (result.hit && result.distance < dist) {
        return false;
      }
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // Hazard steering
  // ---------------------------------------------------------------------------

  /**
   * Looks down the intended line of travel and steers clear of a ravine
   * before the tracks reach the lip. _runRavineEscape only helps once a tank
   * is already in the water; this is what keeps it out in the first place.
   * @returns {boolean} true when it has taken over the steering commands
   */
  _avoidHazardAhead() {
    if (this.commands.escaping) return false;
    if (this.commands.moveInput <= 0) return false;
    if (!this.terrain?.isHazardAt) return false;

    const p = this.tank.position;
    const h = this.tank.heading;
    if (!this._hazardOnBearing(p, h, HAZARD.lookahead)) return false;

    // Wet ground ahead — swing to whichever side is clear and keep rolling
    for (const spread of [HAZARD.probeSpread, HAZARD.probeSpread * 2]) {
      for (const side of [this.orbitDirection, -this.orbitDirection]) {
        if (!this._hazardOnBearing(p, h + side * spread, HAZARD.lookahead)) {
          this.commands.turnInput = side;
          return true;
        }
      }
    }

    // Boxed in on every bearing — back out the way we came
    this.commands.moveInput = -1;
    this.commands.turnInput = this.stuckRecoveryDirection;
    return true;
  }

  /** True if any point along `bearing` within `dist` is hazard terrain. */
  _hazardOnBearing(p, bearing, dist) {
    const sin = Math.sin(bearing);
    const cos = Math.cos(bearing);
    for (let i = 1; i <= 4; i++) {
      const d = (i / 4) * dist;
      if (this.terrain.isHazardAt(p.x + sin * d, p.z + cos * d)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Stuck detection
  // ---------------------------------------------------------------------------

  _runStuckDetection(delta) {
    this.stuckCheckTimer += delta;
    if (this.stuckCheckTimer >= AI.stuckCheckInterval) {
      const moved = this.tank.position.distanceTo(this.lastStuckCheckPosition);
      if (moved < AI.stuckDistanceThreshold && this.commands.moveInput !== 0) {
        this.isRecoveringFromStuck  = true;
        this.stuckRecoveryTimer     = AI.stuckRecoveryTime;
        // Flip turn direction so the AI doesn't always get stuck the same way
        this.stuckRecoveryDirection = -this.stuckRecoveryDirection;
      }
      this.lastStuckCheckPosition.copy(this.tank.position);
      this.stuckCheckTimer = 0;
    }
  }

  _runStuckRecovery(delta) {
    this.commands.moveInput = -1; // reverse
    this.commands.turnInput = this.stuckRecoveryDirection; // alternates each stuck event
    this.stuckRecoveryTimer -= delta;
    if (this.stuckRecoveryTimer <= 0) {
      this.isRecoveringFromStuck = false;
      this.state = 'patrol';
      this.generatePatrolWaypoints();
    }
  }

  // ---------------------------------------------------------------------------
  // Heading utility
  // ---------------------------------------------------------------------------

  /**
   * Returns -1 (right) or +1 (left) or 0 to steer toward a world position.
   * Sign convention: turnInput +1 → heading increases → left turn.
   */
  _computeTurnCommand(currentHeading, targetX, targetZ, tankX, tankZ) {
    const desired = Math.atan2(targetX - tankX, targetZ - tankZ);
    let error = desired - currentHeading;
    error = ((error + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (Math.abs(error) < AI.turnThreshold) return 0;
    return error > 0 ? 1 : -1;
  }

  /**
   * If the tank is sitting in deep ground (ravine/riverbed), drive up the
   * steepest available slope until it's clear. Returns true while escaping,
   * which suspends the normal state machine.
   * @returns {boolean}
   */
  _runRavineEscape(_delta) {
    const p = this.tank.position;
    if (!this.terrain.isHazardAt(p.x, p.z)) {
      this.commands.escaping = false;
      return false;
    }
    const here = this.terrain.getHeightAt(p.x, p.z);

    // Sample a ring around the tank and head for the highest ground
    let bestAngle = null, bestH = here;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const h = this.terrain.getHeightAt(p.x + Math.sin(a) * 9, p.z + Math.cos(a) * 9);
      if (h > bestH) { bestH = h; bestAngle = a; }
    }
    if (bestAngle === null) { this.commands.escaping = false; return false; }

    let diff = ((bestAngle - this.tank.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.commands.turnInput = Math.abs(diff) > AI.turnThreshold ? Math.sign(diff) : 0;
    this.commands.moveInput = Math.abs(diff) < Math.PI / 2 ? 1 : 0; // drive once roughly facing uphill
    this.commands.fire      = false;
    this.commands.escaping  = true; // lets the validator relax the climb limit
    return true;
  }

  // ---------------------------------------------------------------------------
  // Patrol waypoints
  // ---------------------------------------------------------------------------

  /**
   * Generates a fresh patrol circuit. Public so GameManager can call it after
   * terrain reset. Obstacle-aware — skips positions inside obstacles.
   */
  generatePatrolWaypoints() {
    const spawnX = this.tank._spawnConfig.x;
    const spawnZ = this.tank._spawnConfig.z;

    this.patrolWaypoints = [];

    for (let i = 0; i < AI.patrolWaypointCount; i++) {
      const baseAngle = (i / AI.patrolWaypointCount) * Math.PI * 2;
      let placed = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / AI.patrolWaypointCount);
        const dist  = AI.patrolRadius * (0.4 + Math.random() * 0.6);
        const wx    = spawnX + Math.sin(angle) * dist;
        const wz    = spawnZ + Math.cos(angle) * dist;

        const h = this.terrain.getHeightAt(wx, wz);
        if (!Number.isFinite(h)) continue;

        // Never route a patrol through a ravine
        if (this.terrain.isHazardAt?.(wx, wz)) continue;

        // Obstacle check for waypoint
        if (this.obstacleManager) {
          const wy  = h + COLLISION.tankHitYOffset;
          const res = this.obstacleManager.checkTankCollision({ x: wx, y: wy, z: wz }, COLLISION.tankHitRadius);
          if (res.blocked) continue;
        }

        // Mine check for waypoint — avoid placing patrol points in mine zones
        if (this.mineManager && this.mineManager.isMineNearby(wx, wz)) continue;

        this.patrolWaypoints.push({ x: wx, z: wz });
        placed = true;
        break;
      }

      if (!placed) {
        this.patrolWaypoints.push({ x: spawnX, z: spawnZ });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pursuit offset
  // ---------------------------------------------------------------------------

  /**
   * Picks the next stand to roll to. Candidates that sit in a ravine or that
   * still can't see the target are rejected, so a tank driven off by a blocked
   * shot moves somewhere the shot actually opens up.
   * @param {object|null} target
   */
  _generatePursuitOffset(target = this.playerTank) {
    let chosen = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const off   = {
        x: Math.sin(angle) * AI.pursuitDistance,
        z: Math.cos(angle) * AI.pursuitDistance,
      };
      if (!chosen) chosen = off; // keep the first as a fallback
      if (!target || !this.terrain) break;

      const sx = target.position.x + off.x;
      const sz = target.position.z + off.z;
      if (this.terrain.isHazardAt?.(sx, sz)) continue;

      const from = { x: sx, y: this.terrain.getHeightAt(sx, sz) + AI.muzzleHeight, z: sz };
      if (this.hasLineOfSight(from, hitPointOf(target))) {
        chosen = off;
        break;
      }
    }

    this.pursuitOffset          = chosen;
    this.pursuitRepositionTimer = AI.repositionInterval;
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  reset() {
    this.state                  = 'patrol';
    this.stateTimer             = 0;
    this.patrolWaypoints        = [];
    this.currentWaypointIndex   = 0;
    this.pursuitRepositionTimer = 0;
    this.pursuitOffset          = null;
    this.aimSettleTimer         = 0;
    this.postFireTimer          = 0;
    this.orbitTimer             = AI.orbitFlipInterval;
    this.isRecoveringFromStuck  = false;
    this.stuckRecoveryTimer     = 0;
    this.stuckCheckTimer        = 0;
    this.stuckRecoveryDirection = 1;
    this.commands.moveInput     = 0;
    this.commands.turnInput     = 0;
    this.commands.aimTarget     = null;
    this.commands.fire          = false;
    this.commands.elevation     = TANK.barrel.defaultElevation;
  }

  dispose() {
    this.tank              = null;
    this.terrain           = null;
    this.projectileManager = null;
    this.obstacleManager   = null;
    this.mineManager       = null;
    this.playerTank        = null;
    this.patrolWaypoints   = [];
    this.commands          = { moveInput: 0, turnInput: 0, aimTarget: null, fire: false, elevation: TANK.barrel.defaultElevation };
  }
}
