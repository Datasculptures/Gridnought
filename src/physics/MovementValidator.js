import { CELL_SIZE, TANK, COLLISION, HAZARD } from '../utils/constants.js';

const BLOCK_R = COLLISION.vehicleBlockRadius; // convenience alias

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
    this.terrain              = terrain;
    this.obstacleManager      = obstacleManager || null;
    this._getMobileEntities   = null; // injected by GameManager
  }

  /**
   * Provides a function that returns the current list of mobile entities
   * (tanks + vehicles) to use for vehicle-blocking checks.
   * @param {() => object[]} fn
   */
  setMobileEntityProvider(fn) {
    this._getMobileEntities = fn;
  }

  /**
   * Returns true if placing `caller` at (x, z) would overlap another mobile entity.
   * Skips dead entities and the caller itself.
   * @param {number} x
   * @param {number} z
   * @param {object|null} caller - The entity attempting to move (excluded from check).
   */
  isVehicleBlocked(x, z, caller = null) {
    if (!this._getMobileEntities) return false;
    const entities = this._getMobileEntities();
    const r2 = BLOCK_R * BLOCK_R;
    for (const e of entities) {
      if (e === caller)   continue;
      if (!e.isAlive)     continue;
      const dx = x - e.position.x;
      const dz = z - e.position.z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
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
   * @param {boolean} avoidDeep - AI movers pass true: deep ravine terrain is
   *   treated as impassable so enemies never drive into the water hazards
   *   (the player remains free to take the risk).
   */
  canMoveTo(fromX, fromZ, toX, toZ, avoidDeep = false, relaxSlope = false) {
    // The world is infinite — no bounds check.

    // Step 1 — AI ravine avoidance.
    // Never *enter* deep ground, but a unit that somehow ends up down there
    // (spawned, shoved, or terrain regenerated under it) must still be able
    // to climb out — otherwise every direction is blocked and it's trapped
    // for good. So while already deep, allow anything that isn't deeper.
    if (avoidDeep && this.terrain.isHazardAt(toX, toZ)) {
      const alreadyDeep = this.terrain.isHazardAt(fromX, fromZ);
      const toH   = this.terrain.getHeightAt(toX, toZ);
      const fromH = this.terrain.getHeightAt(fromX, fromZ);
      if (!alreadyDeep || toH < fromH - 0.01) {
        return { allowed: false, reason: 'ravine' };
      }
    }

    // Step 2 — Grid passability (cardinal direction).
    // Skipped while a unit is clawing its way out of a hazard: ravine walls
    // are steeper than the normal climb limit, so without this exemption an
    // AI that ends up in the water can never get out again.
    const dir = this.getMovementDirection(fromX, fromZ, toX, toZ);
    if (!relaxSlope && !this.terrain.isPassable(fromX, fromZ, dir)) {
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
    if (horizDist > 0 && !relaxSlope) {
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
    this.terrain            = null;
    this.obstacleManager    = null;
    this._getMobileEntities = null;
  }
}
