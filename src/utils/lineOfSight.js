import { AI } from './constants.js';

/**
 * Shared "can this shot actually get there" test.
 *
 * Every gun in the game fires flat (gravity 0 for cannon, near-flat for MG),
 * so a shot is a straight segment from muzzle to hit-centre. If the ground
 * rises above that segment anywhere along the way, the round buries itself in
 * a hillside and the shooter should be looking for a different position
 * instead of emptying a magazine into dirt.
 *
 * @param {object} terrain  anything exposing getHeightAt(x, z)
 * @param {{x,y,z}} from    muzzle position
 * @param {{x,y,z}} to      the point the round has to reach
 * @returns {boolean} true when the ground gets in the way
 */
export function terrainBlocksShot(terrain, from, to) {
  if (!terrain?.getHeightAt) return false;

  const ddx   = to.x - from.x;
  const ddz   = to.z - from.z;
  const horiz = Math.sqrt(ddx * ddx + ddz * ddz);
  if (horiz < 0.001) return false;

  const steps = Math.min(48, Math.max(3, Math.ceil(horiz / AI.losSampleStep)));
  for (let i = 1; i < steps; i++) {
    const t       = i / steps;
    const shotY   = from.y + (to.y - from.y) * t;
    const groundY = terrain.getHeightAt(from.x + ddx * t, from.z + ddz * t);
    if (groundY > shotY + AI.losGroundClearance) return true;
  }
  return false;
}

/** Where a round has to land to count as a hit on `target`. */
export function hitPointOf(target) {
  if (typeof target.getHitCenter === 'function') return target.getHitCenter();
  return { x: target.position.x, y: target.position.y + 0.8, z: target.position.z };
}
