import { createNoise2D, seededRandom } from './noise.js';
import { BIOME, RIVER, TERRAIN, ROAD, CRATER } from '../utils/constants.js';

/**
 * Deterministic infinite-world generator.
 *
 * The world is tiled into large biome cells (BIOME.size world units). Each
 * cell gets a jittered centre point and a biome type drawn from a weighted
 * table. Terrain height at any point is the weighted blend of the biome
 * height functions of nearby cells, so borders transition smoothly. A global
 * river network is carved through everything afterwards.
 *
 * Everything is a pure function of (worldSeed, position) — the same seed
 * always produces the same world, chunk by chunk.
 */
export default class WorldGenerator {
  constructor(seed) {
    this.seed = seed;

    // Independent noise fields (offset seeds so they don't correlate)
    this._hNoise    = createNoise2D(seed);
    this._h2Noise   = createNoise2D(seed ^ 0x5bd1e995);
    this._riverNoise = createNoise2D(seed ^ 0x27d4eb2f);
    this._fordNoise  = createNoise2D(seed ^ 0x165667b1);

    // Cached biome cell info: key "cx,cz" → { type, centerX, centerZ, rng }
    this._biomeCells = new Map();
    // Cached crater cell info: key "cx,cz" → { exists, centerX, centerZ, radius, depth }
    this._craterCells = new Map();
  }

  // ---------------------------------------------------------------------------
  // Biome cells
  // ---------------------------------------------------------------------------

  /** Deterministic 32-bit hash of a biome cell coordinate + world seed. */
  _cellHash(cx, cz) {
    let h = this.seed | 0;
    h = Math.imul(h ^ cx, 0x9e3779b1);
    h = Math.imul(h ^ cz, 0x85ebca6b);
    h ^= h >>> 15;
    return h | 0;
  }

  /**
   * Returns cached info for the biome cell at integer cell coords (cx, cz):
   * { type, centerX, centerZ, hash }
   */
  getBiomeCell(cx, cz) {
    const key = cx + ',' + cz;
    let cell = this._biomeCells.get(key);
    if (cell) return cell;

    const hash = this._cellHash(cx, cz);
    const rand = seededRandom(hash);

    // Weighted biome pick
    let type = BIOME.weights[0][0];
    let roll = rand();
    for (const [name, w] of BIOME.weights) {
      if (roll < w) { type = name; break; }
      roll -= w;
    }

    // The 2×2 cells meeting at the origin are always plains — the world
    // origin sits at their shared corner, so this guarantees a safe,
    // fully-plains starting pocket regardless of centre jitter.
    if ((cx === 0 || cx === -1) && (cz === 0 || cz === -1)) type = 'plains';

    // Jittered centre (±30% of cell size around the cell midpoint)
    const centerX = (cx + 0.5 + (rand() - 0.5) * 0.6) * BIOME.size;
    const centerZ = (cz + 0.5 + (rand() - 0.5) * 0.6) * BIOME.size;

    cell = { type, centerX, centerZ, hash, cx, cz };
    this._biomeCells.set(key, cell);

    // Keep the cache bounded (rarely matters, but cheap insurance)
    if (this._biomeCells.size > 4096) this._biomeCells.clear();

    return cell;
  }

  /**
   * Returns [{ cell, weight }] for the 3×3 biome cells around a world point,
   * with smooth normalised weights (sum = 1).
   */
  getBiomeWeights(wx, wz) {
    const ccx = Math.floor(wx / BIOME.size);
    const ccz = Math.floor(wz / BIOME.size);
    const R   = BIOME.size * BIOME.blendRadius;

    const out = [];
    let total = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = this.getBiomeCell(ccx + dx, ccz + dz);
        const ddx  = wx - cell.centerX;
        const ddz  = wz - cell.centerZ;
        const d    = Math.sqrt(ddx * ddx + ddz * ddz);
        let w = Math.max(0, 1 - d / R);
        w = w * w * (3 - 2 * w); // smoothstep for softer borders
        if (w > 0.0001) {
          out.push({ cell, weight: w });
          total += w;
        }
      }
    }

    // Degenerate fallback: nearest cell wins outright
    if (total <= 0) {
      const cell = this.getBiomeCell(ccx, ccz);
      return [{ cell, weight: 1 }];
    }

    for (const e of out) e.weight /= total;
    return out;
  }

  /** Dominant biome type at a world point. */
  biomeAt(wx, wz) {
    const weights = this.getBiomeWeights(wx, wz);
    let best = weights[0];
    for (const e of weights) if (e.weight > best.weight) best = e;
    return best.cell.type;
  }

  // ---------------------------------------------------------------------------
  // Height
  // ---------------------------------------------------------------------------

  /** Height contribution of one biome type at a world point. */
  _biomeHeight(type, wx, wz) {
    const n  = this._hNoise;
    const n2 = this._h2Noise;
    switch (type) {
      case 'plains':
        return n(wx * 0.010, wz * 0.010) * 2.2
             + n2(wx * 0.035, wz * 0.035) * 0.7;
      case 'hills':
        return n(wx * 0.015, wz * 0.015) * 8.0
             + n(wx * 0.040, wz * 0.040) * 3.0
             + n2(wx * 0.075, wz * 0.075) * 1.0;
      case 'forest':
        return n(wx * 0.015, wz * 0.015) * 3.5
             + n2(wx * 0.050, wz * 0.050) * 1.2;
      case 'desert': {
        // Dunes: banded ridges from warped noise
        const warp = n2(wx * 0.008, wz * 0.008) * 18;
        return Math.abs(n(0.5 + (wx + warp) * 0.022, wz * 0.006)) * 3.2
             + n2(wx * 0.05, wz * 0.05) * 0.4;
      }
      case 'mountains': {
        // Ridged noise — sharp crests, mostly impassable walls
        const r = 1 - Math.abs(n(wx * 0.012, wz * 0.012));
        return r * r * 26
             + n(wx * 0.045, wz * 0.045) * 3.0;
      }
      case 'city':
        return n2(wx * 0.02, wz * 0.02) * 0.3;
      case 'fortress':
        return 0.5 + n2(wx * 0.02, wz * 0.02) * 0.2;
      default:
        return 0;
    }
  }

  /**
   * Terrain height at any world point — biome blend minus river carve.
   * Pure and deterministic; safe to call for unloaded regions.
   */
  heightAt(wx, wz) {
    const weights = this.getBiomeWeights(wx, wz);

    // Group by type so each height function runs at most once
    let h = 0;
    const done = {};
    for (const { cell, weight } of weights) {
      if (done[cell.type] !== undefined) {
        h += done[cell.type] * weight;
      } else {
        const bh = this._biomeHeight(cell.type, wx, wz);
        done[cell.type] = bh;
        h += bh * weight;
      }
    }

    // Shell craters pockmarking the battlefield
    h += this.craterOffsetAt(wx, wz);

    // River carve — global network through all biomes. Fades out near the
    // world origin so the spawn pocket is never flooded.
    const r = this._riverNoise(wx * RIVER.fieldScale, wz * RIVER.fieldScale);
    const ar = Math.abs(r);
    if (ar < RIVER.channelWidth) {
      const originDist = Math.sqrt(wx * wx + wz * wz);
      let fade = (originDist - 90) / 120;              // 0 inside 90u, 1 beyond 210u
      fade = Math.max(0, Math.min(1, fade));
      fade = fade * fade * (3 - 2 * fade);
      if (fade > 0) {
        const t     = 1 - ar / RIVER.channelWidth;     // 1 at centre, 0 at bank
        const ford  = this._fordNoise(wx * RIVER.fordScale, wz * RIVER.fordScale);
        const depth = ford > RIVER.fordThreshold ? RIVER.fordDepth : RIVER.maxDepth;
        h -= depth * t * t * fade;
      }
    }

    // Road flatten — applied after the river carve so intercity roads run
    // as causeways over water rather than being cut by every channel
    const rf = this.roadFactorAt(wx, wz);
    if (rf > 0) {
      h = h * (1 - rf) + ROAD.height * rf;
    }

    return h;
  }

  // ---------------------------------------------------------------------------
  // Craters
  // ---------------------------------------------------------------------------

  /**
   * Deterministic crater for a crater-grid cell.
   * @returns {{exists:boolean, centerX:number, centerZ:number, radius:number, depth:number}}
   */
  getCraterCell(cx, cz) {
    const key = cx + ',' + cz;
    let c = this._craterCells.get(key);
    if (c) return c;

    const rand = seededRandom(this._cellHash(cx ^ 0x51ed270b, cz ^ 0x2f3b1d47));
    const exists = rand() < CRATER.chance;
    const centerX = (cx + 0.2 + rand() * 0.6) * CRATER.cellSize;
    const centerZ = (cz + 0.2 + rand() * 0.6) * CRATER.cellSize;
    // Small craters are common, big ones rare (squared roll)
    const t = rand() * rand();
    const radius = CRATER.minRadius + t * (CRATER.maxRadius - CRATER.minRadius);
    const depth  = CRATER.minDepth + t * (CRATER.maxDepth - CRATER.minDepth);

    c = { exists, centerX, centerZ, radius, depth };
    this._craterCells.set(key, c);
    if (this._craterCells.size > 4096) this._craterCells.clear();
    return c;
  }

  /**
   * Net height change from craters at a world point: a smooth bowl with a
   * slightly raised ejecta rim. Shallow enough to drive through from any
   * angle, so craters are cover and character rather than a trap.
   */
  craterOffsetAt(wx, wz) {
    const ccx = Math.floor(wx / CRATER.cellSize);
    const ccz = Math.floor(wz / CRATER.cellSize);
    let off = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.getCraterCell(ccx + dx, ccz + dz);
        if (!c.exists) continue;
        const d = Math.hypot(wx - c.centerX, wz - c.centerZ);
        const rim = c.radius * 1.18;
        if (d >= rim) continue;
        if (d <= c.radius) {
          // Bowl: deepest at the centre, easing to zero at the lip
          const u = d / c.radius;
          off -= c.depth * (1 - u * u) * (1 - u * u);
        } else {
          // Raised ejecta ring just outside the bowl
          const u = (d - c.radius) / (rim - c.radius); // 0..1
          off += CRATER.rimHeight * Math.sin(Math.PI * (1 - u)) * (c.radius / CRATER.maxRadius);
        }
      }
    }
    return off;
  }

  /**
   * Road proximity factor at a world point: 1 on the road surface, easing
   * to 0 at the shoulder. Roads run between the centres of adjacent city
   * biome cells, cutting through whatever terrain lies between.
   */
  roadFactorAt(wx, wz) {
    const ccx = Math.floor(wx / BIOME.size);
    const ccz = Math.floor(wz / BIOME.size);
    let best = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.getBiomeCell(ccx + dx, ccz + dz);
        if (c.type !== 'city') continue;
        // Each city cell owns segments to its east and south city neighbours
        for (const [nx, nz] of [[c.cx + 1, c.cz], [c.cx, c.cz + 1]]) {
          const n = this.getBiomeCell(nx, nz);
          if (n.type !== 'city') continue;
          const f = this._segmentFactor(wx, wz, c.centerX, c.centerZ, n.centerX, n.centerZ);
          if (f > best) best = f;
        }
      }
    }
    return best;
  }

  _segmentFactor(px, pz, ax, az, bx, bz) {
    const abx = bx - ax, abz = bz - az;
    const t = Math.max(0, Math.min(1,
      ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)));
    const dx = px - (ax + abx * t);
    const dz = pz - (az + abz * t);
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d >= ROAD.shoulder)  return 0;
    if (d <= ROAD.halfWidth) return 1;
    let u = 1 - (d - ROAD.halfWidth) / (ROAD.shoulder - ROAD.halfWidth);
    return u * u * (3 - 2 * u);
  }

  /**
   * River-field info at a world point — used for bridge placement.
   * @returns {{ r: number, inChannel: boolean, isFord: boolean }}
   */
  riverInfoAt(wx, wz) {
    const r = this._riverNoise(wx * RIVER.fieldScale, wz * RIVER.fieldScale);
    const inChannel = Math.abs(r) < RIVER.channelWidth;
    const isFord = inChannel
      && this._fordNoise(wx * RIVER.fordScale, wz * RIVER.fordScale) > RIVER.fordThreshold;
    return { r, inChannel, isFord };
  }

  /**
   * Unit direction crossing the river at a point (along the gradient of the
   * river field — perpendicular to the channel).
   */
  riverCrossingDir(wx, wz) {
    const e = 2.0;
    const gx = this._riverNoise((wx + e) * RIVER.fieldScale, wz * RIVER.fieldScale)
             - this._riverNoise((wx - e) * RIVER.fieldScale, wz * RIVER.fieldScale);
    const gz = this._riverNoise(wx * RIVER.fieldScale, (wz + e) * RIVER.fieldScale)
             - this._riverNoise(wx * RIVER.fieldScale, (wz - e) * RIVER.fieldScale);
    const len = Math.sqrt(gx * gx + gz * gz);
    if (len < 1e-6) return { x: 1, z: 0 };
    return { x: gx / len, z: gz / len };
  }

  /**
   * Cell-to-cell passability by slope threshold (matches the legacy grid
   * behaviour). Heights are vertex samples at integer grid coords.
   */
  isSlopePassable(h0, h1) {
    return Math.abs(h0 - h1) <= TERRAIN.slopeThreshold;
  }

  dispose() {
    this._biomeCells.clear();
  }
}
