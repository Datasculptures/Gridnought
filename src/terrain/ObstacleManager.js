import ObstacleGenerator from './ObstacleGenerator.js';
import Obstacle from './Obstacle.js';
import { COLLISION, OBSTACLES, SPAWN } from '../utils/constants.js';

/**
 * Manages the lifecycle of all obstacles on the current map.
 * Provides collision query methods for MovementValidator, CollisionManager, and AIController.
 */
export default class ObstacleManager {
  /**
   * @param {THREE.Scene} scene
   * @param {object}      terrain
   */
  constructor(scene, terrain) {
    this.scene     = scene;
    this.terrain   = terrain;
    this.obstacles = [];
  }

  /**
   * Generates and instantiates all obstacles for the given seed and map type.
   * Call clear() first if regenerating on the same terrain.
   * @param {number} seed    - Use terrain.seed for a deterministic layout.
   * @param {string} mapType - 'hills' | 'city' | 'river'
   */
  generate(seed, mapType = 'hills') {
    const generator  = new ObstacleGenerator();
    const descriptors = generator.generate(this.terrain, seed, mapType);

    for (const desc of descriptors) {
      this.obstacles.push(new Obstacle(this.scene, desc, this.terrain));
    }

    // Safety net: remove any obstacle that lands on a spawn point despite
    // the minDistanceFromSpawn filter (e.g. very awkward terrain seeds).
    this._clearSpawnAreas();
  }

  /** Removes any obstacle whose OBB overlaps either spawn point. */
  _clearSpawnAreas() {
    const spawnPoints = [
      { x: SPAWN.player.x, y: this.terrain.getHeightAt(SPAWN.player.x, SPAWN.player.z) + COLLISION.tankHitYOffset, z: SPAWN.player.z },
      { x: SPAWN.enemy.x,  y: this.terrain.getHeightAt(SPAWN.enemy.x,  SPAWN.enemy.z)  + COLLISION.tankHitYOffset, z: SPAWN.enemy.z  },
    ];

    for (const sp of spawnPoints) {
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        if (this.obstacles[i].intersectsSphere(sp, COLLISION.tankHitRadius, OBSTACLES.collisionPadding)) {
          this.obstacles[i].dispose();
          this.obstacles.splice(i, 1);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Collision queries
  // ---------------------------------------------------------------------------

  /**
   * Returns { blocked: boolean, obstacle: Obstacle|null }.
   * @param {{ x, y, z }} tankPosition - World-space position (with Y).
   * @param {number}      tankRadius
   */
  checkTankCollision(tankPosition, tankRadius) {
    for (const obs of this.obstacles) {
      if (obs.intersectsSphere(tankPosition, tankRadius, OBSTACLES.collisionPadding)) {
        return { blocked: true, obstacle: obs };
      }
    }
    return { blocked: false, obstacle: null };
  }

  /**
   * Returns { hit: boolean, obstacle: Obstacle|null }.
   * Checks containsPoint (current frame) plus a backward ray sweep (tunnelling guard).
   *
   * @param {{ x, y, z }} position  - Current projectile head position.
   * @param {{ x, y, z }} direction - Normalised travel direction.
   * @param {number}      speed
   * @param {number}      delta
   */
  checkProjectileHit(position, direction, speed, delta) {
    for (const obs of this.obstacles) {
      // Direct point check
      if (obs.containsPoint(position.x, position.y, position.z, OBSTACLES.projectileCollisionPadding)) {
        return { hit: true, obstacle: obs };
      }

      // Swept check: ray cast backward along the path the projectile just took
      const negDir = { x: -direction.x, y: -direction.y, z: -direction.z };
      const result = obs.intersectsRay(position, negDir, speed * delta);
      if (result.hit) {
        return { hit: true, obstacle: obs };
      }
    }
    return { hit: false, obstacle: null };
  }

  /**
   * Returns true if a straight line from (x1,y1,z1) to (x2,y2,z2) is not blocked
   * by any obstacle OBB. Used for minimap LOS checks.
   */
  hasLineOfSight(x1, y1, z1, x2, y2, z2) {
    const dx  = x2 - x1;
    const dy  = y2 - y1;
    const dz  = z2 - z1;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return true;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    const from = { x: x1, y: y1, z: z1 };
    for (const obs of this.obstacles) {
      const result = obs.intersectsRay(from, dir, len);
      if (result.hit) return false;
    }
    return true;
  }

  /** Returns the live obstacles array (read-only intent). */
  getObstacles() {
    return this.obstacles;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Disposes all obstacles and clears the list. */
  clear() {
    for (const obs of this.obstacles) {
      obs.dispose();
    }
    this.obstacles = [];
  }

  /** No-op — obstacles are static. Satisfies the system interface. */
  update(_delta) {}

  dispose() {
    this.clear();
    this.scene   = null;
    this.terrain = null;
  }
}
