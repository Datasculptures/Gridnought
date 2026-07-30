import Obstacle from './Obstacle.js';
import TemplateBuilding from './TemplateBuilding.js';
import { BUILDING_TEMPLATES, BUILDING_BY_LETTER } from './BuildingTemplates.js';
import { seededRandom } from './noise.js';
import { COLLISION, OBSTACLES, SPAWN, CHUNK, CELL_SIZE, CITY, BOLLARD, RUIN } from '../utils/constants.js';

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
    // Ruin footprints produced by the most recent chunk generation, drained
    // by GameManager so it can garrison them
    this.ruins = [];
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
    this.ruins = []; // fresh list for this chunk

    const rng    = seededRandom(this._chunkHash(chunk.cx, chunk.cz));
    const origin = { x: chunk.cx * CHUNK.size, z: chunk.cz * CHUNK.size };
    const center = { x: origin.x + CHUNK.size / 2, z: origin.z + CHUNK.size / 2 };
    const biome  = this.terrain.biomeAt(center.x, center.z);

    const descriptors = [];
    switch (biome) {
      case 'forest':    this._genScatter(descriptors, rng, origin, 'tree',   10 + Math.floor(rng() * 5)); break;
      case 'hills':     this._genScatter(descriptors, rng, origin, 'blocks',  2 + Math.floor(rng() * 3)); break;
      case 'desert':    this._genScatter(descriptors, rng, origin, 'blocks',  1 + Math.floor(rng() * 3)); break;
      case 'mountains': this._genScatter(descriptors, rng, origin, 'blocks',  Math.floor(rng() * 2));     break;
      case 'plains':    this._genScatter(descriptors, rng, origin, 'mixed',   1 + Math.floor(rng() * 3)); break;
      case 'city':      this._genCityBlocks(descriptors, origin);                                         break;
      case 'fortress':  this._genFortress(descriptors, rng, chunk, origin);                               break;
      default: break;
    }

    // Lone buildings dotted through open country (rural landmarks)
    if (biome !== 'city' && biome !== 'fortress') {
      this._genLoneBuilding(descriptors, rng, origin, biome);
    }

    // Anti-tank bollard clusters — dragon's teeth guarding open approaches
    this._genBollards(descriptors, rng, origin, center);

    const obstacles = [];
    for (const desc of descriptors) {
      if (!desc.skipFilter && !this._placementOk(desc.position.x, desc.position.z)) continue;
      if (desc.kind === 'template') {
        const template = BUILDING_BY_LETTER[desc.templateKey];
        if (!template) continue;
        obstacles.push(new TemplateBuilding(this.scene, {
          template, position: desc.position, rotation: desc.rotation, terrain: this.terrain,
        }));
        // Damaged buildings are held by defenders — GameManager garrisons
        // anything recorded here on chunk load.
        if (template.damaged) {
          this.ruins.push({ x: desc.position.x, z: desc.position.z, floors: [] });
        }
      } else {
        obstacles.push(new Obstacle(this.scene, desc, this.terrain));
      }
    }
    this._byChunk.set(key, obstacles);
  }

  /**
   * Picks a template for the given city zone whose footprint fits inside the
   * block, and a rotation (cardinal) that fits. Returns null when nothing in
   * the pool is small enough — the block is then left as open ground.
   */
  _pickTemplate(rng, zone, maxW, maxD) {
    return this._pickFrom(rng, BUILDING_TEMPLATES.filter(t => t.zones.includes(zone)), maxW, maxD);
  }

  /** Picks a damaged (ruin) template that fits — replaces the old procedural ruins. */
  _pickDamaged(rng, maxW, maxD) {
    return this._pickFrom(rng, BUILDING_TEMPLATES.filter(t => t.damaged), maxW, maxD);
  }

  /** Picks a template from `pool` and a cardinal rotation whose footprint fits. */
  _pickFrom(rng, pool, maxW, maxD) {
    if (pool.length === 0) return null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const t = pool[Math.floor(rng() * pool.length)];
      const rots = rng() < 0.5 ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
      for (const rot of rots) {
        const swap = Math.abs(Math.sin(rot)) > 0.5;
        const rw = swap ? t.d : t.w;
        const rd = swap ? t.w : t.d;
        if (rw <= maxW && rd <= maxD) return { template: t, rotation: rot };
      }
    }
    return null;
  }

  /**
   * Occasionally drops a single rural template into open country — a farmhouse,
   * church, silo cluster, or water tower standing alone on the landscape.
   */
  _genLoneBuilding(out, rng, origin, biome) {
    const chance = biome === 'plains' ? 0.18
      : (biome === 'hills' || biome === 'desert') ? 0.10
      : biome === 'forest' ? 0.05 : 0.03;
    if (rng() >= chance) return;
    const pool = BUILDING_TEMPLATES.filter(t => t.rural);
    const t    = pool[Math.floor(rng() * pool.length)];
    out.push({
      kind: 'template', templateKey: t.letter,
      position: { x: origin.x + 10 + rng() * (CHUNK.size - 20), z: origin.z + 10 + rng() * (CHUNK.size - 20) },
      rotation: Math.floor(rng() * 4) * (Math.PI / 2),
    });
  }


  /**
   * Anti-tank bollards: short lines of caltrops laid across open ground,
   * angled so they read as a deliberate barrier rather than scatter.
   */
  _genBollards(out, rng, origin, center) {
    if (Math.hypot(center.x, center.z) < BOLLARD.minOriginDist) return;
    if (rng() >= BOLLARD.cellChance) return;

    const count = BOLLARD.clusterMin
      + Math.floor(rng() * (BOLLARD.clusterMax - BOLLARD.clusterMin + 1));
    const lineAng = rng() * Math.PI * 2;
    const sx = origin.x + 8 + rng() * (CHUNK.size - 16);
    const sz = origin.z + 8 + rng() * (CHUNK.size - 16);
    const t = OBSTACLES.types.bollard;

    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * BOLLARD.spacing;
      out.push({
        type: 'bollard',
        position: { x: sx + Math.cos(lineAng) * off, z: sz + Math.sin(lineAng) * off },
        rotation: rng() * Math.PI * 2,
        dimensions: { width: t.width, height: t.height, depth: t.depth },
      });
    }
  }

  /** Common placement filter: spawn clearance, slope, rivers, roads. */
  _placementOk(x, z) {
    for (const sp of [SPAWN.player, SPAWN.enemy]) {
      const dx = x - sp.x, dz = z - sp.z;
      if (dx * dx + dz * dz < 15 * 15) return false;
    }
    if (this.terrain.getHeightAt(x, z) < -1.2) return false;        // river channel
    if (this.terrain.worldGen.roadFactorAt(x, z) > 0.1) return false; // keep roads clear

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
      } else if (family === 'blocks') {
        // Building-like shapes only: cubes and cylinders
        type = rng() < 0.65 ? 'cube' : 'cylinder';
        const t = OBSTACLES.types[type];
        dims = { width: t.width, height: t.height * (0.6 + rng() * 0.6), depth: t.depth };
      } else {
        // mixed cover for plains: blocks, slabs, cylinders
        const pool  = ['cube', 'tallCube', 'wall', 'cylinder'];
        type = pool[Math.floor(rng() * pool.length)];
        const t = OBSTACLES.types[type];
        dims = { width: t.width, height: t.height, depth: t.depth };
      }

      out.push({ type, position: { x, z }, rotation: rng() * Math.PI * 2, dimensions: dims });
    }
  }

  /**
   * City districts on a global street lattice, so streets run straight
   * across chunk borders. Every CITY.avenueEvery-th grid line is a wide
   * avenue; buildings set back accordingly. Each block places one template
   * building chosen by its distance from the downtown core (biome cell
   * centre): towers and high-rises downtown, mid-rise civic/residential in
   * the ring, houses and shops on the outskirts, with the odd industrial
   * parcel and shelled-out ruin mixed through.
   */
  _genCityBlocks(out, origin) {
    const BLOCK = CITY.blockSize;
    const b0x = Math.floor(origin.x / BLOCK);
    const b0z = Math.floor(origin.z / BLOCK);
    const blocksPerChunk = CHUNK.size / BLOCK; // 2

    for (let bx = b0x; bx < b0x + blocksPerChunk; bx++) {
      for (let bz = b0z; bz < b0z + blocksPerChunk; bz++) {
        const cxw = bx * BLOCK + BLOCK / 2;
        const czw = bz * BLOCK + BLOCK / 2;

        // Only city-dominant blocks build — erodes districts at borders
        if (this.terrain.biomeAt(cxw, czw) !== 'city') continue;
        // Intercity roads become main streets — keep their blocks open
        if (this.terrain.worldGen.roadFactorAt(cxw, czw) > 0.1) continue;

        let h = (this.terrain.seed | 0) ^ 0x1b873593;
        h = Math.imul(h ^ bx, 0x9e3779b1);
        h = Math.imul(h ^ bz, 0x85ebca6b);
        h ^= h >>> 15;
        const rng = seededRandom(h | 0);

        // Distance from the downtown core sets the height tier
        const weights = this.terrain.worldGen.getBiomeWeights(cxw, czw);
        let best = weights[0];
        for (const e of weights) if (e.weight > best.weight) best = e;
        const dist = Math.hypot(cxw - best.cell.centerX, czw - best.cell.centerZ);
        const tier = Math.max(0, 1 - dist / (240 * CITY.coreRadius)); // 1 = core

        // Street hierarchy: setback per side (avenue vs minor street)
        const insetW = (bx     % CITY.avenueEvery === 0) ? CITY.avenueInset : CITY.streetInset;
        const insetE = ((bx + 1) % CITY.avenueEvery === 0) ? CITY.avenueInset : CITY.streetInset;
        const insetN = (bz     % CITY.avenueEvery === 0) ? CITY.avenueInset : CITY.streetInset;
        const insetS = ((bz + 1) % CITY.avenueEvery === 0) ? CITY.avenueInset : CITY.streetInset;
        const areaW = BLOCK - insetW - insetE;   // buildable width
        const areaD = BLOCK - insetN - insetS;   // buildable depth
        const midX  = bx * BLOCK + insetW + areaW / 2;
        const midZ  = bz * BLOCK + insetN + areaD / 2;

        // Empty blocks (plazas/parks) get rarer downtown
        if (rng() < 0.20 - tier * 0.12) continue;

        // Some blocks are ruins — a shelled-out building model from the set
        if (rng() < RUIN.chance) {
          const ruin = this._pickDamaged(rng, areaW + 3, areaD + 3);
          if (ruin) {
            out.push({
              kind: 'template', templateKey: ruin.template.letter,
              position: { x: midX, z: midZ }, rotation: ruin.rotation,
            });
          }
          continue;
        }

        // Choose a district zone from the tier, with the odd industrial parcel
        let zone;
        if (rng() < 0.14)        zone = 'ind';
        else if (tier > 0.6)     zone = rng() < 0.75 ? 'core' : 'mid';
        else if (tier > 0.3)     zone = rng() < 0.7  ? 'mid'  : 'low';
        else                     zone = 'low';

        const pick = this._pickTemplate(rng, zone, areaW + 3, areaD + 3)
          || this._pickTemplate(rng, 'low', areaW + 3, areaD + 3);
        if (!pick) continue; // nothing fits — leave the block open

        out.push({
          kind: 'template', templateKey: pick.template.letter,
          position: { x: midX, z: midZ }, rotation: pick.rotation,
        });
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
      this._genScatter(out, rng, origin, 'blocks', 1);
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
