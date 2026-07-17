import Obstacle from './Obstacle.js';
import { seededRandom } from './noise.js';
import { COLLISION, OBSTACLES, SPAWN, CHUNK, CELL_SIZE } from '../utils/constants.js';

/**
 * Chunk-based obstacle system for the infinite world.
 *
 * Obstacles generate deterministically per chunk from (worldSeed, chunk
 * coords), with density and type driven by the chunk's dominant biome:
 *   plains    — sparse mixed cover (cubes, walls, wedges)
 *   hills     — scattered pyramids
 *   forest    — dense trees
 *   desert    — occasional rock outcrops
 *   mountains — rare boulders (the terrain itself is the obstacle)
 *   city      — buildings on a coherent global block grid spanning chunks
 *   fortress  — walled compound with bunker and missile silos at the
 *               biome centre, sparse cylinders elsewhere
 *
 * Collision queries only test obstacles from the 3×3 chunks around the
 * query point, so cost stays flat no matter how much world is loaded.
 */
export default class ObstacleManager {
  constructor(scene, terrain) {
    this.scene   = scene;
    this.terrain = terrain;
    // "cx,cz" → Obstacle[]
    this._byChunk = new Map();
  }

  /**
   * Wires chunk lifecycle callbacks and populates already-loaded chunks.
   * (Signature kept close to the legacy generate(seed, mapType).)
   */
  generate(_seed, _mapType) {
    this.terrain.onChunkLoaded((chunk) => this._populateChunk(chunk));
    this.terrain.onChunkUnloaded((chunk) => this._disposeChunk(chunk.cx, chunk.cz));
    for (const chunk of this.terrain.getLoadedChunks().values()) {
      this._populateChunk(chunk);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-chunk generation
  // ---------------------------------------------------------------------------

  _chunkHash(cx, cz) {
    let h = (this.terrain.seed | 0) ^ 0x2545f491;
    h = Math.imul(h ^ cx, 0x9e3779b1);
    h = Math.imul(h ^ cz, 0x85ebca6b);
    h ^= h >>> 15;
    return h | 0;
  }

  _populateChunk(chunk) {
    const key = chunk.cx + ',' + chunk.cz;
    if (this._byChunk.has(key)) return;

    const rng    = seededRandom(this._chunkHash(chunk.cx, chunk.cz));
    const origin = { x: chunk.cx * CHUNK.size, z: chunk.cz * CHUNK.size };
    const center = { x: origin.x + CHUNK.size / 2, z: origin.z + CHUNK.size / 2 };
    const biome  = this.terrain.biomeAt(center.x, center.z);

    const descriptors = [];
    switch (biome) {
      case 'forest':    this._genScatter(descriptors, rng, origin, 'tree',    10 + Math.floor(rng() * 5)); break;
      case 'hills':     this._genScatter(descriptors, rng, origin, 'pyramid',  2 + Math.floor(rng() * 3)); break;
      case 'desert':    this._genScatter(descriptors, rng, origin, 'rock',     1 + Math.floor(rng() * 3)); break;
      case 'mountains': this._genScatter(descriptors, rng, origin, 'rock',     Math.floor(rng() * 2));     break;
      case 'plains':    this._genScatter(descriptors, rng, origin, 'mixed',    1 + Math.floor(rng() * 3)); break;
      case 'city':      this._genCityBlocks(descriptors, origin);                                          break;
      case 'fortress':  this._genFortress(descriptors, rng, chunk, origin);                                break;
      default: break;
    }

    const obstacles = [];
    for (const desc of descriptors) {
      if (!this._placementOk(desc.position.x, desc.position.z)) continue;
      obstacles.push(new Obstacle(this.scene, desc, this.terrain));
    }
    this._byChunk.set(key, obstacles);
  }

  /** Common placement filter: spawn clearance, slope, river channels. */
  _placementOk(x, z) {
    for (const sp of [SPAWN.player, SPAWN.enemy]) {
      const dx = x - sp.x, dz = z - sp.z;
      if (dx * dx + dz * dz < 15 * 15) return false;
    }
    if (this.terrain.getHeightAt(x, z) < -1.2) return false; // river channel

    const normal        = this.terrain.getNormalAt(x, z);
    const normalY       = Math.min(1, Math.max(-1, normal.y));
    const slopeAngleDeg = Math.acos(normalY) * (180 / Math.PI);
    return slopeAngleDeg <= OBSTACLES.maxSlopeForPlacement;
  }

  /** Random scatter of one family of obstacle types within the chunk. */
  _genScatter(out, rng, origin, family, count) {
    for (let i = 0; i < count; i++) {
      const x = origin.x + 3 + rng() * (CHUNK.size - 6);
      const z = origin.z + 3 + rng() * (CHUNK.size - 6);

      let type, dims;
      if (family === 'tree') {
        const t = OBSTACLES.types.tree;
        const s = 0.7 + rng() * 0.7;
        type = 'tree';
        dims = { width: t.width * s, height: t.height * s, depth: t.depth * s };
      } else if (family === 'pyramid') {
        const t = OBSTACLES.types.pyramid;
        type = 'pyramid';
        dims = { width: t.width, height: t.height, depth: t.depth };
      } else if (family === 'rock') {
        const t = rng() < 0.5 ? OBSTACLES.types.cube : OBSTACLES.types.wedge;
        type = rng() < 0.5 ? 'cube' : 'wedge';
        dims = { width: t.width, height: t.height * (0.6 + rng() * 0.6), depth: t.depth };
      } else {
        // mixed cover for plains
        const pool  = ['cube', 'tallCube', 'wall', 'wedge'];
        type = pool[Math.floor(rng() * pool.length)];
        const t = OBSTACLES.types[type];
        dims = { width: t.width, height: t.height, depth: t.depth };
      }

      out.push({ type, position: { x, z }, rotation: rng() * Math.PI * 2, dimensions: dims });
    }
  }

  /**
   * City buildings on a global 32-unit block grid, so streets run straight
   * across chunk borders. Each block is deterministic from its own grid
   * coords — neighbouring chunks agree on shared districts.
   */
  _genCityBlocks(out, origin) {
    const BLOCK = 32;
    const b0x = Math.floor(origin.x / BLOCK);
    const b0z = Math.floor(origin.z / BLOCK);
    const blocksPerChunk = CHUNK.size / BLOCK; // 2

    for (let bx = b0x; bx < b0x + blocksPerChunk; bx++) {
      for (let bz = b0z; bz < b0z + blocksPerChunk; bz++) {
        const cxw = bx * BLOCK + BLOCK / 2;
        const czw = bz * BLOCK + BLOCK / 2;

        // Only blocks whose centre is city-dominant get buildings — this
        // erodes the district naturally at biome borders.
        if (this.terrain.biomeAt(cxw, czw) !== 'city') continue;

        let h = (this.terrain.seed | 0) ^ 0x1b873593;
        h = Math.imul(h ^ bx, 0x9e3779b1);
        h = Math.imul(h ^ bz, 0x85ebca6b);
        h ^= h >>> 15;
        const rng = seededRandom(h | 0);

        const roll = rng();
        if (roll < 0.15) continue; // plaza / park

        if (roll < 0.70) {
          // Single building
          const w = 10 + Math.floor(rng() * 9);
          const d = 10 + Math.floor(rng() * 9);
          const ht = 4 + Math.floor(rng() * 9);
          out.push({ type: 'cityBlock', position: { x: cxw, z: czw }, rotation: 0,
            dimensions: { width: w, height: ht, depth: d } });
        } else {
          // Two buildings with an alley
          const vertical = rng() < 0.5;
          const bW = 8, alley = 5, off = bW / 2 + alley / 2;
          const long = 14 + Math.floor(rng() * 5);
          const ht   = 4 + Math.floor(rng() * 7);
          for (const s of [-1, 1]) {
            out.push({
              type: 'cityBlock',
              position: {
                x: cxw + (vertical ? s * off : 0),
                z: czw + (vertical ? 0 : s * off),
              },
              rotation: 0,
              dimensions: {
                width:  vertical ? bW : long,
                height: ht,
                depth:  vertical ? long : bW,
              },
            });
          }
        }
      }
    }
  }

  /**
   * Fortress biome: a walled ring compound at the biome cell centre with a
   * central bunker and missile silos. Ring features are computed from the
   * biome cell (not the chunk), and each chunk only instantiates the
   * features that land inside it — the compound assembles seamlessly.
   */
  _genFortress(out, rng, chunk, origin) {
    const center = { x: origin.x + CHUNK.size / 2, z: origin.z + CHUNK.size / 2 };
    const weights = this.terrain.worldGen.getBiomeWeights(center.x, center.z);
    let best = weights[0];
    for (const e of weights) if (e.weight > best.weight) best = e;
    const cell = best.cell;
    if (cell.type !== 'fortress') {
      // Chunk is fortress-dominant but nearest cell resolution disagrees —
      // sparse cylinders as fallback cover
      this._genScatter(out, rng, origin, 'rock', 1);
      return;
    }

    const inChunk = (x, z) =>
      x >= origin.x && x < origin.x + CHUNK.size &&
      z >= origin.z && z < origin.z + CHUNK.size;

    const cellRng  = seededRandom(cell.hash ^ 0x68e31da4);
    const radius   = 26 + cellRng() * 8;
    const segments = 12;
    const gapA     = Math.floor(cellRng() * segments);
    const gapB     = (gapA + segments / 2) | 0;

    // Perimeter walls
    for (let k = 0; k < segments; k++) {
      if (k === gapA || k === gapB) continue; // gates
      const ang = (k / segments) * Math.PI * 2;
      const x = cell.centerX + Math.cos(ang) * radius;
      const z = cell.centerZ + Math.sin(ang) * radius;
      if (!inChunk(x, z)) continue;
      const t = OBSTACLES.types.wall;
      out.push({ type: 'wall', position: { x, z }, rotation: -ang,
        dimensions: { width: t.width * 1.6, height: t.height, depth: t.depth } });
    }

    // Central bunker
    if (inChunk(cell.centerX, cell.centerZ)) {
      const b = OBSTACLES.types.bunker;
      out.push({ type: 'bunker', position: { x: cell.centerX, z: cell.centerZ },
        rotation: cellRng() * Math.PI,
        dimensions: { width: b.width, height: b.height, depth: b.depth } });
    }

    // Missile silos around the bunker
    for (let m = 0; m < 3; m++) {
      const ang = cellRng() * Math.PI * 2;
      const r   = 9 + cellRng() * 7;
      const x = cell.centerX + Math.cos(ang) * r;
      const z = cell.centerZ + Math.sin(ang) * r;
      if (!inChunk(x, z)) continue;
      const t = OBSTACLES.types.missile;
      out.push({ type: 'missile', position: { x, z }, rotation: 0,
        dimensions: { width: t.width, height: t.height, depth: t.depth } });
    }
  }

  _disposeChunk(cx, cz) {
    const key = cx + ',' + cz;
    const list = this._byChunk.get(key);
    if (!list) return;
    for (const obs of list) obs.dispose();
    this._byChunk.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Spatial queries — only the 3×3 chunks around the point are tested
  // ---------------------------------------------------------------------------

  _nearby(x, z) {
    const cx = Math.floor(x / CHUNK.size);
    const cz = Math.floor(z / CHUNK.size);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this._byChunk.get((cx + dx) + ',' + (cz + dz));
        if (list) out.push(...list);
      }
    }
    return out;
  }

  /** Flat array of every loaded obstacle (minimap, AI scans, spawn checks). */
  get obstacles() {
    const out = [];
    for (const list of this._byChunk.values()) out.push(...list);
    return out;
  }

  getObstacles() {
    return this.obstacles;
  }

  checkTankCollision(tankPosition, tankRadius) {
    for (const obs of this._nearby(tankPosition.x, tankPosition.z)) {
      if (obs.intersectsSphere(tankPosition, tankRadius, OBSTACLES.collisionPadding)) {
        return { blocked: true, obstacle: obs };
      }
    }
    return { blocked: false, obstacle: null };
  }

  checkProjectileHit(position, direction, speed, delta) {
    for (const obs of this._nearby(position.x, position.z)) {
      if (obs.containsPoint(position.x, position.y, position.z, OBSTACLES.projectileCollisionPadding)) {
        return { hit: true, obstacle: obs };
      }
      const negDir = { x: -direction.x, y: -direction.y, z: -direction.z };
      const result = obs.intersectsRay(position, negDir, speed * delta);
      if (result.hit) {
        return { hit: true, obstacle: obs };
      }
    }
    return { hit: false, obstacle: null };
  }

  /**
   * True when the segment (x1,y1,z1)→(x2,y2,z2) is not blocked.
   * Tests obstacles from every chunk the segment's bounding box overlaps.
   */
  hasLineOfSight(x1, y1, z1, x2, y2, z2) {
    const dx  = x2 - x1;
    const dy  = y2 - y1;
    const dz  = z2 - z1;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return true;
    const dir  = { x: dx / len, y: dy / len, z: dz / len };
    const from = { x: x1, y: y1, z: z1 };

    const cx0 = Math.floor(Math.min(x1, x2) / CHUNK.size) - 1;
    const cx1 = Math.floor(Math.max(x1, x2) / CHUNK.size) + 1;
    const cz0 = Math.floor(Math.min(z1, z2) / CHUNK.size) - 1;
    const cz1 = Math.floor(Math.max(z1, z2) / CHUNK.size) + 1;

    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this._byChunk.get(cx + ',' + cz);
        if (!list) continue;
        for (const obs of list) {
          if (obs.intersectsRay(from, dir, len).hit) return false;
        }
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  clear() {
    for (const list of this._byChunk.values()) {
      for (const obs of list) obs.dispose();
    }
    this._byChunk.clear();
  }

  update(_delta) {}

  dispose() {
    this.clear();
    this.scene   = null;
    this.terrain = null;
  }
}
