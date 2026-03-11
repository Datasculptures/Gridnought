import { GRID_SIZE, TERRAIN } from '../utils/constants.js';
import { createNoise2D, seededRandom } from './noise.js';

export default class TerrainGenerator {
  constructor() {}

  /**
   * Procedurally generates terrain data for the given map type.
   * @param {number|undefined|null} seed
   * @param {'hills'|'city'|'river'|'military_base'|'crowded_city'|'valley'} mapType
   * @returns {{ heightMap: number[][], passable: object[][], seed: number, mapType: string }}
   */
  generate(seed, mapType = 'hills') {
    if (seed === undefined || seed === null) {
      seed = Math.floor(Math.random() * 2147483647);
    }

    const noise = createNoise2D(seed);

    // Allocate heightMap[x][z]
    const heightMap = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      heightMap[x] = new Float32Array(GRID_SIZE);
    }

    switch (mapType) {
      case 'city':
      case 'military_base':
        this._fillCity(heightMap);
        break;
      case 'crowded_city':
        this._fillCity(heightMap);
        break;
      case 'river':
        this._fillRiver(heightMap, noise, seed);
        break;
      case 'valley':
        this._fillValley(heightMap, noise);
        break;
      default:
        this._fillHills(heightMap, noise);
        break;
    }

    // Build passability — compare each cell to its four neighbours
    const passable = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      passable[x] = [];
      for (let z = 0; z < GRID_SIZE; z++) {
        const h = heightMap[x][z];
        passable[x][z] = {
          north: z > 0             && Math.abs(h - heightMap[x][z - 1]) <= TERRAIN.slopeThreshold,
          south: z < GRID_SIZE - 1 && Math.abs(h - heightMap[x][z + 1]) <= TERRAIN.slopeThreshold,
          east:  x < GRID_SIZE - 1 && Math.abs(h - heightMap[x + 1][z]) <= TERRAIN.slopeThreshold,
          west:  x > 0             && Math.abs(h - heightMap[x - 1][z]) <= TERRAIN.slopeThreshold,
        };
      }
    }

    return { heightMap, passable, seed, mapType };
  }

  // ---------------------------------------------------------------------------
  // Height-fill strategies
  // ---------------------------------------------------------------------------

  /** Hilly terrain using summed noise octaves. */
  _fillHills(heightMap, noise) {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        let h = 0;
        for (const octave of TERRAIN.noiseOctaves) {
          h += noise(x * octave.frequency, z * octave.frequency) * octave.amplitude;
        }
        // Linear ramp from 0 at edge to full height at edgeMargin cells inward
        const edgeDist = Math.min(x, GRID_SIZE - 1 - x, z, GRID_SIZE - 1 - z);
        if (edgeDist < TERRAIN.edgeMargin) {
          h *= edgeDist / TERRAIN.edgeMargin;
        }
        heightMap[x][z] = h;
      }
    }
  }

  /** Completely flat — used for city and military-base maps. */
  _fillCity(heightMap) {
    // All heights remain at 0 (Float32Array default).
  }

  /**
   * Valley: slopes from high edges down to a lower centre.
   * The spawn corners are elevated; the middle is open low ground.
   * Trees cluster in the flat floor — placed by ObstacleGenerator.
   */
  _fillValley(heightMap, noise) {
    const half = (GRID_SIZE - 1) / 2;
    const maxRimHeight = 14;   // height at the outer rim
    const noiseScale   = 0.2;  // subtle surface texture

    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        // Normalised distance from grid centre (0 = centre, 1 = corner)
        const nx = (x - half) / half;
        const nz = (z - half) / half;
        const r  = Math.min(1.0, Math.sqrt(nx * nx + nz * nz) / 0.85);

        // Smooth bowl: flat in the centre, steep at the rim (r^2 curve)
        let h = maxRimHeight * r * r;

        // Add light noise for surface texture
        h += noise(x * 0.06, z * 0.06) * 1.5 * noiseScale * h;

        // Edge taper so the map border is flat
        const edgeDist = Math.min(x, GRID_SIZE - 1 - x, z, GRID_SIZE - 1 - z);
        if (edgeDist < TERRAIN.edgeMargin) {
          h *= edgeDist / TERRAIN.edgeMargin;
        }

        heightMap[x][z] = h;
      }
    }
  }

  /**
   * Mostly flat terrain with a river depression running east-west.
   * Creates impassable walls at the river banks with 2-3 fordable crossings.
   */
  _fillRiver(heightMap, noise, seed) {
    const rng = seededRandom(seed);

    const halfWidthCells = 5;
    const maxDepth       = 11;
    const fordDepth      = 2.8;
    const fordSigma      = 3.5;

    const sineAmp   = 2 + rng() * 3;
    const sineFreq  = 0.05 + rng() * 0.04;
    const sinePhase = rng() * Math.PI * 2;
    const centreGZ  = GRID_SIZE / 2;

    const fordCount = 2 + Math.floor(rng() * 2);
    const fordGXs   = [];
    for (let f = 0; f < fordCount; f++) {
      const baseGX = Math.floor(GRID_SIZE * (f + 1) / (fordCount + 1));
      fordGXs.push(Math.max(4, Math.min(GRID_SIZE - 5, baseGX + Math.floor(rng() * 5) - 2)));
    }

    for (let gx = 0; gx < GRID_SIZE; gx++) {
      const riverGZ = centreGZ + sineAmp * Math.sin(gx * sineFreq + sinePhase);

      let fordT = 0;
      for (const fx of fordGXs) {
        const d = Math.abs(gx - fx);
        fordT = Math.max(fordT, Math.exp(-(d * d) / (2 * fordSigma * fordSigma)));
      }

      for (let gz = 0; gz < GRID_SIZE; gz++) {
        let h = noise(gx * 0.04, gz * 0.04) * 1.2;

        const edgeDist = Math.min(gx, GRID_SIZE - 1 - gx, gz, GRID_SIZE - 1 - gz);
        if (edgeDist < TERRAIN.edgeMargin) {
          h *= edgeDist / TERRAIN.edgeMargin;
        }

        const distCells = Math.abs(gz - riverGZ);
        if (distCells < halfWidthCells) {
          const t = 1 - distCells / halfWidthCells;
          const riverH = -maxDepth * (t * t * t * t);
          const fordH  = -fordDepth * (t * t);
          h += riverH * (1 - fordT) + fordH * fordT;
        }

        heightMap[gx][gz] = h;
      }
    }
  }

  update(_delta) {}
  dispose() {}
}
