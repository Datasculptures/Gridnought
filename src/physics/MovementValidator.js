import { WORLD_SIZE, CELL_SIZE, TANK, COLLISION } from '../utils/constants.js';

/**
 * Centralised movement validation. Both the player tank and AI tanks use this
 * to determine whether a proposed move is legal before applying it.
 *
 * Coordinate convention (matches TerrainGenerator passability grid):
 *   - World +Z = South  (grid z+1)
 *   - World -Z = North  (grid z-1)
 *   - World +X = East   (grid x+1)
 *   - World -X = West   (grid x-1)
 */
export default class MovementValidator {
  /**
   * @param {object}      terrain         - Terrain instance.
   * @param {object|null} obstacleManager - ObstacleManager; checked in canMoveTo.
   */
  constructor(terrain, obstacleManager) {
    this.terrain         = terrain;
    this.obstacleManager = obstacleManager || null;
  }

  /**
   * Returns the cardinal direction that best describes the movement vector.
   * @returns {'north'|'south'|'east'|'west'}
   */
  getMovementDirection(fromX, fromZ, toX, toZ) {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    if (Math.abs(dz) >= Math.abs(dx)) {
      return dz >= 0 ? 'south' : 'north';
    }
    return dx >= 0 ? 'east' : 'west';
  }

  /**
   * Determines whether moving from (fromX, fromZ) to (toX, toZ) is legal.
   * Returns { allowed: boolean, reason: string }.
   */
  canMoveTo(fromX, fromZ, toX, toZ) {
    const half = WORLD_SIZE / 2;

    // Step 1 — Bounds check
    if (toX < -half || toX > half || toZ < -half || toZ > half) {
      return { allowed: false, reason: 'out_of_bounds' };
    }

    // Step 2 — Grid passability (cardinal direction)
    const dir = this.getMovementDirection(fromX, fromZ, toX, toZ);
    if (!this.terrain.isPassable(fromX, fromZ, dir)) {
      return { allowed: false, reason: 'impassable_slope' };
    }

    // Step 2.5 — Obstacle check
    if (this.obstacleManager) {
      const proposedY  = this.terrain.getHeightAt(toX, toZ) + COLLISION.tankHitYOffset;
      const proposedPos = { x: toX, y: proposedY, z: toZ };
      const result = this.obstacleManager.checkTankCollision(proposedPos, COLLISION.tankHitRadius);
      if (result.blocked) {
        return { allowed: false, reason: 'obstacle' };
      }
    }

    // Step 3 — Angle backup check
    const hFrom = this.terrain.getHeightAt(fromX, fromZ);
    const hTo   = this.terrain.getHeightAt(toX, toZ);
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const horizDist = Math.sqrt(dx * dx + dz * dz);
    if (horizDist > 0) {
      const slopeAngle = Math.atan2(Math.abs(hTo - hFrom), horizDist);
      const slopeAngleDeg = slopeAngle * (180 / Math.PI);
      if (slopeAngleDeg > TANK.maxClimbAngle) {
        return { allowed: false, reason: 'too_steep' };
      }
    }

    return { allowed: true, reason: 'ok' };
  }

  /**
   * Returns a speed multiplier in [TANK.slopeSlowdown, 1.0] based on the
   * terrain slope along the direction of travel. Uphill = slower.
   */
  getSlopeSpeedMultiplier(worldX, worldZ, headingRadians) {
    const sampleDist = CELL_SIZE;
    const sinH = Math.sin(headingRadians);
    const cosH = Math.cos(headingRadians);

    const hFwd = this.terrain.getHeightAt(worldX + sinH * sampleDist, worldZ + cosH * sampleDist);
    const hBwd = this.terrain.getHeightAt(worldX - sinH * sampleDist, worldZ - cosH * sampleDist);
    const heightDiff = hFwd - hBwd;

    if (heightDiff <= 0) return 1.0;

    const slopeAngleDeg = Math.atan2(heightDiff, 2 * sampleDist) * (180 / Math.PI);
    const t = Math.min(1.0, slopeAngleDeg / TANK.maxClimbAngle);
    return 1.0 - t * (1.0 - TANK.slopeSlowdown);
  }

  update(_delta) {
    // No-op — satisfies system interface
  }

  dispose() {
    this.terrain         = null;
    this.obstacleManager = null;
  }
}
