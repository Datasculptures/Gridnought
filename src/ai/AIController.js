import * as THREE from 'three';
import { AI, CELL_SIZE, WORLD_SIZE, COLLISION, PROJECTILE, TANK } from '../utils/constants.js';
import GameState from '../game/GameState.js';

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

    // Stuck detection always runs before the state machine
    this._runStuckDetection(delta);

    if (this.isRecoveringFromStuck) {
      this._runStuckRecovery(delta);
      return;
    }

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
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  updatePatrol(delta) {
    if (this.patrolWaypoints.length === 0) {
      this.generatePatrolWaypoints();
    }

    const wp   = this.patrolWaypoints[this.currentWaypointIndex];
    const tank = this.tank;
    const dx   = wp.x - tank.position.x;
    const dz   = wp.z - tank.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= CELL_SIZE * 2) {
      this.stateTimer += delta;
      this.commands.moveInput = 0;
      if (this.stateTimer >= AI.patrolPauseDuration) {
        this.currentWaypointIndex =
          (this.currentWaypointIndex + 1) % this.patrolWaypoints.length;
        this.stateTimer = 0;
      }
    } else {
      this.commands.moveInput = 1;
      this.commands.turnInput = this._computeTurnCommand(
        tank.heading, wp.x, wp.z, tank.position.x, tank.position.z,
      );
      this.stateTimer = 0;
    }

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
    this.commands.moveInput = 0;
    this.commands.aimTarget = this.playerTank.position.clone();

    const dx    = this.playerTank.position.x - this.tank.position.x;
    const dz    = this.playerTank.position.z - this.tank.position.z;
    const pDist = Math.sqrt(dx * dx + dz * dz);

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
      this.commands.moveInput = 0;
    }

    this.commands.aimTarget = player.position.clone();
    this.commands.elevation = this._directElevation(pDist, player.position.y - this.tank.position.y);

    // Transition to aim when close enough and turret is roughly on-target
    if (pDist <= AI.pursuitDistance + AI.pursuitDistanceTolerance) {
      const toPlayer  = new THREE.Vector3(dx, 0, dz).normalize();
      const turretDir = tank.getTurretDirection();
      const dot       = Math.min(1, Math.max(-1, toPlayer.dot(turretDir)));
      if (Math.acos(dot) < AI.aimTolerance * 3) {
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

    this.commands.moveInput = 0;
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

    const toPlayer  = new THREE.Vector3(dx, 0, dz).normalize();
    const turretDir = tank.getTurretDirection();
    const dot       = Math.min(1, Math.max(-1, toPlayer.dot(turretDir)));
    const angle     = Math.acos(dot);

    if (angle <= AI.aimTolerance) {
      this.aimSettleTimer += delta;
      if (this.aimSettleTimer >= AI.aimSettleTime) {
        // Check line of sight before committing to fire
        if (!this.hasLineOfSight(tank.position, player.position)) {
          // Player is behind cover — reposition
          this.state = 'pursue';
          this._generatePursuitOffset();
          this.aimSettleTimer = 0;
          return;
        }
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

    if (this.postFireTimer === 0 && this.tank.canFire && pDist <= this._maxRange()) {
      this.commands.fire = true;
    }

    this.postFireTimer += delta;
    this.commands.moveInput = 0;

    if (this.postFireTimer >= AI.postFirePause) {
      this.state = 'pursue';
      this._generatePursuitOffset();
    }
  }

  // ---------------------------------------------------------------------------
  // Line-of-sight
  // ---------------------------------------------------------------------------

  /**
   * Returns true if a straight-line projectile path from fromPos to toPos
   * is not blocked by any obstacle. O(n) where n ≤ OBSTACLES.count.max.
   *
   * @param {{ x, y, z }} fromPos
   * @param {{ x, y, z }} toPos
   */
  hasLineOfSight(fromPos, toPos) {
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
    const half   = WORLD_SIZE / 2;

    this.patrolWaypoints = [];

    for (let i = 0; i < AI.patrolWaypointCount; i++) {
      const baseAngle = (i / AI.patrolWaypointCount) * Math.PI * 2;
      let placed = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / AI.patrolWaypointCount);
        const dist  = AI.patrolRadius * (0.4 + Math.random() * 0.6);
        const wx    = spawnX + Math.sin(angle) * dist;
        const wz    = spawnZ + Math.cos(angle) * dist;

        if (wx >= -half && wx <= half && wz >= -half && wz <= half) {
          const h = this.terrain.getHeightAt(wx, wz);
          if (!Number.isFinite(h)) continue;

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
      }

      if (!placed) {
        this.patrolWaypoints.push({ x: spawnX, z: spawnZ });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pursuit offset
  // ---------------------------------------------------------------------------

  _generatePursuitOffset() {
    const angle        = Math.random() * Math.PI * 2;
    this.pursuitOffset = {
      x: Math.sin(angle) * AI.pursuitDistance,
      z: Math.cos(angle) * AI.pursuitDistance,
    };
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
