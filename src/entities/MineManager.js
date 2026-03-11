import * as THREE from 'three';
import { MINES, WORLD_SIZE, SPAWN } from '../utils/constants.js';
import { seededRandom } from '../terrain/noise.js';

/**
 * Manages land mines — small red spheres embedded at ground level.
 *
 * - 0-2 random clusters of 5-6 mines per round.
 * - AI units avoid them via isMineNearby().
 * - Player tank triggers them on contact; triggering deals 1 HP to every armor zone.
 */
export default class MineManager {
  constructor(scene) {
    this.scene = scene;

    // Shared geometry + materials (reused across all mines)
    this._geo      = new THREE.SphereGeometry(MINES.radius, 6, 4);
    this._wireMat  = new THREE.MeshBasicMaterial({ color: MINES.color, wireframe: true });
    this._solidMat = new THREE.MeshBasicMaterial({
      color: MINES.solidColor,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    // Array of { position: THREE.Vector3, solid: Mesh, wire: Mesh, triggered: boolean }
    this.mines = [];
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  /**
   * Clears existing mines and places 0–maxClusters new clusters on the terrain.
   * @param {object} terrain
   * @param {number} seed  - Use terrain.seed for determinism.
   */
  generate(terrain, seed) {
    this.clear();
    const rng = seededRandom(seed + 17); // offset so mines don't match obstacle seed

    const clusterCount = Math.floor(rng() * (MINES.maxClusters + 1)); // 0, 1, or 2

    for (let c = 0; c < clusterCount; c++) {
      // Find a cluster centre away from both spawns, in the inner portion of the map
      let cx, cz, att = 0;
      do {
        cx = (rng() * 2 - 1) * (WORLD_SIZE / 2 * 0.55);
        cz = (rng() * 2 - 1) * (WORLD_SIZE / 2 * 0.55);
        att++;
      } while (this._nearSpawn(cx, cz) && att < 30);
      if (this._nearSpawn(cx, cz)) continue; // give up if no safe spot

      const count = MINES.minPerCluster
        + Math.floor(rng() * (MINES.maxPerCluster - MINES.minPerCluster + 1));

      for (let m = 0; m < count; m++) {
        const mx = cx + (rng() - 0.5) * MINES.clusterSpread * 2;
        const mz = cz + (rng() - 0.5) * MINES.clusterSpread * 2;
        if (this._nearSpawn(mx, mz)) continue;
        if (Math.abs(mx) > WORLD_SIZE / 2 - 3 || Math.abs(mz) > WORLD_SIZE / 2 - 3) continue;

        const y   = terrain.getHeightAt(mx, mz);
        const pos = new THREE.Vector3(mx, y, mz);

        const solid = new THREE.Mesh(this._geo, this._solidMat);
        solid.position.copy(pos);
        const wire = new THREE.Mesh(this._geo, this._wireMat);
        wire.position.copy(pos);

        this.scene.add(solid);
        this.scene.add(wire);
        this.mines.push({ position: pos.clone(), solid, wire, triggered: false });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true if (x, z) is within MINES.avoidRadius of any live mine.
   * Used by AI to avoid entering mine zones.
   */
  isMineNearby(x, z) {
    const r2 = MINES.avoidRadius * MINES.avoidRadius;
    for (const mine of this.mines) {
      if (mine.triggered) continue;
      const dx = x - mine.position.x;
      const dz = z - mine.position.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  /**
   * Checks whether a projectile at `pos` with `radius` hits any live mine.
   * If so, destroys the mine (hides it) and returns true.
   * @param {THREE.Vector3} pos
   * @param {number} projRadius
   */
  checkProjectileHit(pos, projRadius) {
    const hitR2 = (MINES.radius + projRadius) * (MINES.radius + projRadius);
    for (const mine of this.mines) {
      if (mine.triggered) continue;
      const dx = pos.x - mine.position.x;
      const dz = pos.z - mine.position.z;
      if (dx * dx + dz * dz <= hitR2) {
        mine.triggered    = true;
        mine.solid.visible = false;
        mine.wire.visible  = false;
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether the given world-XZ position has triggered a mine.
   * If yes, marks it triggered, hides it, and returns the mine's world position.
   * Returns null if no mine was triggered.
   * Call once per frame for the player tank.
   * @returns {THREE.Vector3|null}
   */
  checkTrigger(x, z) {
    const r2 = MINES.triggerRadius * MINES.triggerRadius;
    for (const mine of this.mines) {
      if (mine.triggered) continue;
      const dx = x - mine.position.x;
      const dz = z - mine.position.z;
      if (dx * dx + dz * dz <= r2) {
        mine.triggered     = true;
        mine.solid.visible = false;
        mine.wire.visible  = false;
        return mine.position.clone();
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  clear() {
    for (const mine of this.mines) {
      this.scene.remove(mine.solid);
      this.scene.remove(mine.wire);
      // geometry is shared — don't dispose here
    }
    this.mines = [];
  }

  dispose() {
    this.clear();
    if (this._geo)      { this._geo.dispose();      this._geo      = null; }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat  = null; }
    if (this._solidMat) { this._solidMat.dispose();  this._solidMat = null; }
    this.scene = null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _nearSpawn(x, z) {
    const d = MINES.minDistanceFromSpawn;
    const dx1 = x - SPAWN.player.x, dz1 = z - SPAWN.player.z;
    const dx2 = x - SPAWN.enemy.x,  dz2 = z - SPAWN.enemy.z;
    return (dx1 * dx1 + dz1 * dz1) < d * d
        || (dx2 * dx2 + dz2 * dz2) < d * d;
  }
}
