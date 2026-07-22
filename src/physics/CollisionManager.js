import * as THREE from 'three';
import { COLLISION } from '../utils/constants.js';

/**
 * Detects projectile-vs-obstacle and projectile-vs-tank collisions each frame.
 * Obstacle check runs first — a blocked projectile never reaches a tank.
 * Uses a direct sphere check plus a swept intermediate check (tunnelling guard).
 */
export default class CollisionManager {
  /**
   * @param {import('../entities/ProjectileManager.js').default} projectileManager
   * @param {import('../terrain/ObstacleManager.js').default}    obstacleManager
   */
  constructor(projectileManager, obstacleManager) {
    this._projectileManager = projectileManager;
    this._obstacleManager   = obstacleManager || null;
    this._tanks             = [];
    this._onHitCallback     = null;
    // Maps projectile → previous head position (for swept tank-hit check)
    this._prevPositions     = new Map();
  }

  /** Register a tank to be checked as a potential hit target. */
  registerTank(tank) {
    this._tanks.push(tank);
  }

  /** Empties the tank list (rebuilt when the enemy pool is reset). */
  clearTanks() {
    this._tanks = [];
  }

  /** Removes a single tank (an allied unit being retired). */
  unregisterTank(tank) {
    const i = this._tanks.indexOf(tank);
    if (i !== -1) this._tanks.splice(i, 1);
  }

  /** Callback fired with (tank, projectile) when a tank is hit. */
  onHit(callback) {
    this._onHitCallback = callback;
  }

  update(delta) {
    const projectiles = this._projectileManager.getActiveProjectiles();

    // Remove stale entries for projectiles no longer in the active list
    for (const proj of this._prevPositions.keys()) {
      if (!projectiles.includes(proj)) {
        this._prevPositions.delete(proj);
      }
    }

    const hitCenter = new THREE.Vector3();

    for (const proj of projectiles) {
      if (!proj.isAlive) continue;

      const pos = proj.position;
      if (!pos) continue;

      // -----------------------------------------------------------------------
      // 1. Obstacle hit check (runs before tank check)
      // -----------------------------------------------------------------------
      if (this._obstacleManager) {
        const vel    = proj.velocity;
        const spd    = vel ? vel.length() : 0;
        const dir    = (vel && spd > 0) ? { x: vel.x / spd, y: vel.y / spd, z: vel.z / spd }
                                        : { x: 0, y: 0, z: 0 };
        const obsResult = this._obstacleManager.checkProjectileHit(pos, dir, spd, delta);
        if (obsResult.hit) {
          proj.kill();
          this._prevPositions.delete(proj);
          continue; // skip tank checks
        }
      }

      // -----------------------------------------------------------------------
      // 2. Tank hit check (skip rounds flagged canHitTanks: false)
      // -----------------------------------------------------------------------
      if (proj.canHitTanks === false) {
        if (proj.isAlive) {
          const s = this._prevPositions.get(proj);
          if (s) s.copy(pos); else this._prevPositions.set(proj, pos.clone());
        }
        continue;
      }

      const prev = this._prevPositions.get(proj) || null;

      for (const tank of this._tanks) {
        if (!tank.isAlive) continue;
        if (proj.owner === tank) continue; // no self-hits (friendly fire is live)

        hitCenter.set(
          tank.position.x,
          tank.position.y + COLLISION.tankHitYOffset,
          tank.position.z,
        );

        // Direct sphere check
        let hit = pos.distanceTo(hitCenter) <= COLLISION.tankHitRadius;

        // Swept check — sample intermediate points to catch fast projectiles
        if (!hit && prev) {
          for (let s = 1; s <= COLLISION.sweepSteps; s++) {
            const t  = s / (COLLISION.sweepSteps + 1);
            const sx = prev.x + (pos.x - prev.x) * t;
            const sy = prev.y + (pos.y - prev.y) * t;
            const sz = prev.z + (pos.z - prev.z) * t;
            const dx = sx - hitCenter.x;
            const dy = sy - hitCenter.y;
            const dz = sz - hitCenter.z;
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= COLLISION.tankHitRadius) {
              hit = true;
              break;
            }
          }
        }

        if (hit) {
          proj.kill();
          if (typeof this._onHitCallback === 'function') {
            try {
              this._onHitCallback(tank, proj);
            } catch (e) {
              console.error('CollisionManager: onHit callback threw:', e);
            }
          }
          break; // projectile dead — skip remaining tanks
        }
      }

      // Track current position as prev for next frame (only if still alive)
      if (proj.isAlive) {
        const stored = this._prevPositions.get(proj);
        if (stored) {
          stored.copy(pos);
        } else {
          this._prevPositions.set(proj, pos.clone());
        }
      } else {
        this._prevPositions.delete(proj);
      }
    }
  }

  /** Clears tracked state (call when starting a new round). */
  clear() {
    this._prevPositions.clear();
  }

  dispose() {
    this._tanks             = [];
    this._onHitCallback     = null;
    this._projectileManager = null;
    this._obstacleManager   = null;
    this._prevPositions.clear();
  }
}
