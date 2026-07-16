import { seededRandom } from './noise.js';
import { OBSTACLES, WORLD_SIZE, SPAWN } from '../utils/constants.js';

/**
 * Generates obstacle placement descriptors for a given terrain and map type.
 * Stateless — no Three.js, no side effects.
 */
export default class ObstacleGenerator {
  /**
   * @param {object} terrain  - Terrain instance (getNormalAt, getHeightAt).
   * @param {number} seed     - Deterministic seed (use terrain.seed).
   * @param {string} mapType
   * @returns {Array} obstacle descriptors
   */
  generate(terrain, seed, mapType = 'hills') {
    const rng = seededRandom(seed);
    switch (mapType) {
      case 'city':          return this._generateCity(terrain, rng);
      case 'river':         return this._generateRiver(terrain, rng);
      case 'military_base': return this._generateMilitaryBase(terrain, rng);
      case 'crowded_city':  return this._generateCrowdedCity(terrain, rng);
      case 'valley':        return this._generateValley(terrain, rng);
      case 'desert':        return this._generateDesert(terrain, rng);
      case 'fortress':      return this._generateFortress(terrain, rng);
      default:              return this._generateHills(terrain, rng);
    }
  }

  // ---------------------------------------------------------------------------
  // Hills — scattered organic placement (pyramids on slopes)
  // ---------------------------------------------------------------------------

  _generateHills(terrain, rng) {
    const count = OBSTACLES.count.min
      + Math.floor(rng() * (OBSTACLES.count.max - OBSTACLES.count.min + 1));

    const placed    = [];
    const halfWorld = WORLD_SIZE / 2;
    const margin    = 5;
    const typeDef   = OBSTACLES.types.pyramid;
    const dimensions = { width: typeDef.width, height: typeDef.height, depth: typeDef.depth };

    for (let i = 0; i < count; i++) {
      let descriptor = null;

      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * (halfWorld - margin);
        const z = (rng() * 2 - 1) * (halfWorld - margin);

        if (!this._passesSpawnCheck(x, z))           continue;
        if (!this._passesClusterCheck(x, z, placed)) continue;

        const normal        = terrain.getNormalAt(x, z);
        const normalY       = Math.min(1, Math.max(-1, normal.y));
        const slopeAngleDeg = Math.acos(normalY) * (180 / Math.PI);
        if (slopeAngleDeg > OBSTACLES.maxSlopeForPlacement) continue;

        descriptor = { type: 'pyramid', position: { x, z }, rotation: rng() * Math.PI * 2, dimensions };
        break;
      }

      if (descriptor) placed.push(descriptor);
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // City — proper city grid: 5×5 blocks separated by wide streets and alleys
  // ---------------------------------------------------------------------------
  //
  //  Block spacing: 40 units centre-to-centre  (28-unit block + 12-unit street)
  //  Block centres: -80, -40, 0, 40, 80  (5 columns × 5 rows, within ±108)
  //  Each block inner area: ≈22×22  (3-unit setback from the street edge)
  //
  //  Four layout patterns per block:
  //    A – single large building (fills most of the block)
  //    B – two buildings with a N-S alley between them
  //    C – two buildings with an E-W alley between them
  //    D – four corner buildings with an open courtyard in the centre
  //  Buildings on main avenues (bx=0 or bz=0) are taller.
  //  The block at (0,0) always gets a landmark tower.

  _generateCity(_terrain, rng) {
    const placed   = [];
    const grid     = [-80, -40, 0, 40, 80];
    const MAX_BLDG = 20; // clamp width/depth to stay within the block

    for (const bx of grid) {
      for (const bz of grid) {
        if (!this._passesSpawnCheck(bx, bz)) continue;

        // Landmark tower at the city centre
        if (bx === 0 && bz === 0) {
          const s = 8 + Math.floor(rng() * 4);
          placed.push({ type: 'cityBlock', position: { x: 0, z: 0 }, rotation: 0,
            dimensions: { width: s, height: 12 + Math.floor(rng() * 8), depth: s } });
          continue;
        }

        if (rng() < 0.14) continue; // empty block — open plaza or park

        const onMainAve = (bx === 0 || bz === 0);
        const hBonus    = onMainAve ? 3 : 0;
        const roll      = rng();

        if (roll < 0.30) {
          // Pattern A — single large building filling most of the block
          const w = Math.min(12 + Math.floor(rng() * 8), MAX_BLDG);
          const d = Math.min(12 + Math.floor(rng() * 8), MAX_BLDG);
          const h =  3 + Math.floor(rng() * 6) + hBonus;
          placed.push({ type: 'cityBlock', position: { x: bx, z: bz }, rotation: 0,
            dimensions: { width: w, height: h, depth: d } });

        } else if (roll < 0.55) {
          // Pattern B — two buildings with a N-S (left/right) alley
          const bW = 8, alley = 5, ox = bW / 2 + alley / 2;
          const bD = Math.min(14 + Math.floor(rng() * 5), MAX_BLDG);
          const h  =  3 + Math.floor(rng() * 5) + hBonus;
          placed.push({ type: 'cityBlock', position: { x: bx - ox, z: bz }, rotation: 0,
            dimensions: { width: bW, height: h,                        depth: bD } });
          placed.push({ type: 'cityBlock', position: { x: bx + ox, z: bz }, rotation: 0,
            dimensions: { width: bW, height: h + Math.floor(rng() * 4), depth: bD } });

        } else if (roll < 0.78) {
          // Pattern C — two buildings with an E-W (front/back) alley
          const bD = 8, alley = 5, oz = bD / 2 + alley / 2;
          const bW = Math.min(14 + Math.floor(rng() * 5), MAX_BLDG);
          const h  =  3 + Math.floor(rng() * 5) + hBonus;
          placed.push({ type: 'cityBlock', position: { x: bx, z: bz - oz }, rotation: 0,
            dimensions: { width: bW, height: h,                        depth: bD } });
          placed.push({ type: 'cityBlock', position: { x: bx, z: bz + oz }, rotation: 0,
            dimensions: { width: bW, height: h + Math.floor(rng() * 4), depth: bD } });

        } else {
          // Pattern D — four corner buildings with an open courtyard
          const s   = 7 + Math.floor(rng() * 2);
          const off = s / 2 + 2;
          const h   =  2 + Math.floor(rng() * 4) + hBonus;
          for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            placed.push({ type: 'cityBlock',
              position: { x: bx + sx * off, z: bz + sz * off }, rotation: 0,
              dimensions: { width: s, height: h + Math.floor(rng() * 3), depth: s } });
          }
        }
      }
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // River — sparse boulders on navigable ground only
  // ---------------------------------------------------------------------------

  _generateRiver(terrain, rng) {
    const placed    = [];
    const halfWorld = WORLD_SIZE / 2;
    const margin    = 5;
    const count     = 10 + Math.floor(rng() * 7);
    const typeDef   = OBSTACLES.types.pyramid;
    const dims      = { width: typeDef.width, height: typeDef.height, depth: typeDef.depth };

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * (halfWorld - margin);
        const z = (rng() * 2 - 1) * (halfWorld - margin);

        if (!this._passesSpawnCheck(x, z))           continue;
        if (!this._passesClusterCheck(x, z, placed)) continue;

        const h = terrain.getHeightAt(x, z);
        if (h < -0.5) continue; // skip river bed

        const normal        = terrain.getNormalAt(x, z);
        const normalY       = Math.min(1, Math.max(-1, normal.y));
        const slopeAngleDeg = Math.acos(normalY) * (180 / Math.PI);
        if (slopeAngleDeg > OBSTACLES.maxSlopeForPlacement) continue;

        placed.push({ type: 'pyramid', position: { x, z }, rotation: rng() * Math.PI * 2, dimensions: dims });
        break;
      }
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // Military Base — bunkers + water cylinders + missile silos
  // ---------------------------------------------------------------------------

  _generateMilitaryBase(_terrain, rng) {
    const placed    = [];
    const halfWorld = WORLD_SIZE / 2 * 0.55; // keep obstacles inward

    // 6-9 low bunkers scattered around
    const bunkerCount = 6 + Math.floor(rng() * 4);
    const bd = OBSTACLES.types.bunker;
    for (let i = 0; i < bunkerCount; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * halfWorld;
        const z = (rng() * 2 - 1) * halfWorld;
        if (!this._passesSpawnCheck(x, z))           continue;
        if (!this._passesClusterCheck(x, z, placed)) continue;
        placed.push({
          type: 'bunker', position: { x, z },
          rotation:   Math.floor(rng() * 2) * (Math.PI / 2),
          dimensions: { width: bd.width, height: bd.height, depth: bd.depth },
        });
        break;
      }
    }

    // 3-5 large water cylinders
    const cylCount = 3 + Math.floor(rng() * 3);
    const cd = OBSTACLES.types.cylinder;
    for (let i = 0; i < cylCount; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * halfWorld;
        const z = (rng() * 2 - 1) * halfWorld;
        if (!this._passesSpawnCheck(x, z))            continue;
        if (!this._passesClusterCheck(x, z, placed))  continue;
        placed.push({
          type: 'cylinder', position: { x, z }, rotation: 0,
          dimensions: { width: cd.width, height: cd.height, depth: cd.depth },
        });
        break;
      }
    }

    // 4-8 missiles — can cluster more closely (a launch pad)
    const missileCount = 4 + Math.floor(rng() * 5);
    const md = OBSTACLES.types.missile;
    for (let i = 0; i < missileCount; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * halfWorld;
        const z = (rng() * 2 - 1) * halfWorld;
        if (!this._passesSpawnCheck(x, z))                   continue;
        if (!this._passesClusterCheck(x, z, placed, 3))      continue; // 3-unit min separation
        placed.push({
          type: 'missile', position: { x, z }, rotation: 0,
          dimensions: { width: md.width, height: md.height, depth: md.depth },
        });
        break;
      }
    }

    // Tree clusters around the perimeter — concealment and visual variety
    const treeClusters = 3 + Math.floor(rng() * 4);
    const td = OBSTACLES.types.tree;
    const treeDims = { width: td.width, height: td.height, depth: td.depth };
    const treeHalf = WORLD_SIZE / 2;

    for (let c = 0; c < treeClusters; c++) {
      let cx, cz, cAtt = 0;
      do {
        const angle = rng() * Math.PI * 2;
        const r     = treeHalf * (0.35 + rng() * 0.3);
        cx = Math.cos(angle) * r;
        cz = Math.sin(angle) * r;
        cAtt++;
      } while (this._nearSpawn(cx, cz, 22) && cAtt < 15);
      if (this._nearSpawn(cx, cz, 22)) continue;

      const treeCount = 3 + Math.floor(rng() * 4);
      for (let t = 0; t < treeCount; t++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const x = cx + (rng() - 0.5) * 14;
          const z = cz + (rng() - 0.5) * 14;
          if (Math.abs(x) > treeHalf - 4 || Math.abs(z) > treeHalf - 4) continue;
          if (!this._passesSpawnCheck(x, z))              continue;
          if (!this._passesClusterCheck(x, z, placed, 3)) continue;
          placed.push({ type: 'tree', position: { x, z }, rotation: rng() * Math.PI * 2, dimensions: treeDims });
          break;
        }
      }
    }

    // Outer edge scatter — additional bunkers and walls near the map boundary
    const edgeHalf   = WORLD_SIZE / 2;
    const edgeInner  = 45;
    const edgeOuter  = edgeHalf - 2;
    const wallDef    = OBSTACLES.types.wall;
    const wallDims   = { width: wallDef.width, height: wallDef.height, depth: wallDef.depth };
    const edgeCount  = 15 + Math.floor(rng() * 8);

    for (let i = 0; i < edgeCount; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        let x, z;
        if (rng() < 0.5) {
          x = (rng() < 0.5 ? -1 : 1) * (edgeInner + rng() * (edgeOuter - edgeInner));
          z = (rng() * 2 - 1) * edgeOuter;
        } else {
          x = (rng() * 2 - 1) * edgeOuter;
          z = (rng() < 0.5 ? -1 : 1) * (edgeInner + rng() * (edgeOuter - edgeInner));
        }
        if (!this._passesSpawnCheck(x, z))           continue;
        if (!this._passesClusterCheck(x, z, placed)) continue;

        const roll = rng();
        if (roll < 0.35) {
          placed.push({ type: 'bunker',   position: { x, z }, rotation: Math.floor(rng() * 2) * (Math.PI / 2), dimensions: { width: bd.width, height: bd.height, depth: bd.depth } });
        } else if (roll < 0.65) {
          placed.push({ type: 'wall',     position: { x, z }, rotation: Math.floor(rng() * 2) * (Math.PI / 2), dimensions: wallDims });
        } else {
          placed.push({ type: 'tree',     position: { x, z }, rotation: rng() * Math.PI * 2, dimensions: treeDims });
        }
        break;
      }
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // Crowded City — denser, taller, thinner buildings on flat terrain
  // ---------------------------------------------------------------------------

  static CROWDED_CITY_BUILDINGS = [
    { w: 2,  h: 14, d: 2  },
    { w: 3,  h: 10, d: 3  },
    { w: 2,  h: 18, d: 2  },
    { w: 4,  h: 8,  d: 3  },
    { w: 3,  h: 12, d: 4  },
    { w: 2,  h: 16, d: 3  },
    { w: 3,  h: 9,  d: 2  },
  ];

  _generateCrowdedCity(_terrain, rng) {
    const placed = [];
    // 9×9 grid at 18-unit spacing — scaled for 216-unit world
    const gridPositions = [-72, -54, -36, -18, 0, 18, 36, 54, 72];

    for (const cx of gridPositions) {
      for (const cz of gridPositions) {
        if (!this._passesSpawnCheck(cx, cz)) continue;
        if (rng() > 0.85) continue; // ~15% stay open — denser than regular city

        const b   = ObstacleGenerator.CROWDED_CITY_BUILDINGS[
          Math.floor(rng() * ObstacleGenerator.CROWDED_CITY_BUILDINGS.length)
        ];
        const rot = Math.floor(rng() * 2) * (Math.PI / 2);

        placed.push({
          type:       'cityBlock',
          position:   { x: cx, z: cz },
          rotation:   rot,
          dimensions: { width: b.w, height: b.h, depth: b.d },
        });
      }
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // Valley — clusters of trees in the low ground
  // ---------------------------------------------------------------------------

  _generateValley(terrain, rng) {
    const placed    = [];
    const halfWorld = WORLD_SIZE / 2;
    const td        = OBSTACLES.types.tree;

    // 4-7 clusters of 4-7 trees placed in the valley floor (low terrain)
    const clusterCount = 4 + Math.floor(rng() * 4);

    for (let c = 0; c < clusterCount; c++) {
      // Cluster centre in the inner half of the map (valley floor)
      let cx, cz, att = 0;
      do {
        cx = (rng() * 2 - 1) * (halfWorld * 0.4);
        cz = (rng() * 2 - 1) * (halfWorld * 0.4);
        att++;
      } while (this._nearSpawn(cx, cz, 30) && att < 20);

      if (this._nearSpawn(cx, cz, 30)) continue; // skip if no safe spot found

      const treeCount = 4 + Math.floor(rng() * 4);
      for (let t = 0; t < treeCount; t++) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const x = cx + (rng() - 0.5) * 14;
          const z = cz + (rng() - 0.5) * 14;
          if (Math.abs(x) > halfWorld - 4 || Math.abs(z) > halfWorld - 4) continue;
          if (!this._passesSpawnCheck(x, z))              continue;
          if (!this._passesClusterCheck(x, z, placed, 3)) continue; // trees 3 units apart

          const slopeAngleDeg = (() => {
            const n = terrain.getNormalAt(x, z);
            return Math.acos(Math.min(1, Math.max(-1, n.y))) * (180 / Math.PI);
          })();
          if (slopeAngleDeg > OBSTACLES.maxSlopeForPlacement) continue;

          placed.push({
            type:       'tree',
            position:   { x, z },
            rotation:   rng() * Math.PI * 2,
            dimensions: { width: td.width, height: td.height, depth: td.depth },
          });
          break;
        }
      }
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // Desert — sparse rock outcrops; wide open sightlines for long-range duels
  // ---------------------------------------------------------------------------

  _generateDesert(terrain, rng) {
    const placed    = [];
    const halfWorld = WORLD_SIZE / 2;
    const margin    = 5;
    const count     = 6 + Math.floor(rng() * 5); // 6-10 formations

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * (halfWorld - margin);
        const z = (rng() * 2 - 1) * (halfWorld - margin);
        if (!this._passesSpawnCheck(x, z))              continue;
        if (!this._passesClusterCheck(x, z, placed, 9)) continue; // wide spacing

        const normal        = terrain.getNormalAt(x, z);
        const normalY       = Math.min(1, Math.max(-1, normal.y));
        const slopeAngleDeg = Math.acos(normalY) * (180 / Math.PI);
        if (slopeAngleDeg > OBSTACLES.maxSlopeForPlacement) continue;

        const roll     = rng();
        const typeName = roll < 0.55 ? 'pyramid' : roll < 0.85 ? 'wedge' : 'cube';
        const td       = OBSTACLES.types[typeName];
        placed.push({
          type: typeName, position: { x, z },
          rotation:   rng() * Math.PI * 2,
          dimensions: { width: td.width, height: td.height, depth: td.depth },
        });
        break;
      }
    }
    return placed;
  }

  // ---------------------------------------------------------------------------
  // Fortress — walled compound + missile silos + perimeter cover walls
  // ---------------------------------------------------------------------------

  _generateFortress(_terrain, rng) {
    const placed      = [];
    const wallDef     = OBSTACLES.types.wall;
    const bunkerDef   = OBSTACLES.types.bunker;
    const missileDef  = OBSTACLES.types.missile;
    const wallDims    = { width: wallDef.width,    height: wallDef.height,    depth: wallDef.depth    };
    const bunkerDims  = { width: bunkerDef.width,  height: bunkerDef.height,  depth: bunkerDef.depth  };
    const missileDims = { width: missileDef.width, height: missileDef.height, depth: missileDef.depth };

    const R = 22; // compound radius

    // 4 sides × 2 wall segments each (gap in centre of each side allows entry)
    const sides = [
      { axis: 'z', sign: -1, rot: 0               },  // north
      { axis: 'z', sign:  1, rot: 0               },  // south
      { axis: 'x', sign:  1, rot: Math.PI / 2     },  // east
      { axis: 'x', sign: -1, rot: Math.PI / 2     },  // west
    ];
    for (const s of sides) {
      for (const off of [-5, 5]) {
        const wx = s.axis === 'z' ? off         : s.sign * R;
        const wz = s.axis === 'z' ? s.sign * R  : off;
        if (!this._passesSpawnCheck(wx, wz)) continue;
        placed.push({ type: 'wall', position: { x: wx, z: wz }, rotation: s.rot, dimensions: wallDims });
      }
    }

    // Corner bunkers
    for (const c of [{ x: -R, z: -R }, { x: R, z: -R }, { x: -R, z: R }, { x: R, z: R }]) {
      if (!this._passesSpawnCheck(c.x, c.z)) continue;
      placed.push({ type: 'bunker', position: c, rotation: Math.floor(rng() * 2) * (Math.PI / 2), dimensions: bunkerDims });
    }

    // Interior missile silos
    const siloCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < siloCount; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = (rng() - 0.5) * R * 1.2;
        const z = (rng() - 0.5) * R * 1.2;
        if (!this._passesSpawnCheck(x, z))              continue;
        if (!this._passesClusterCheck(x, z, placed, 5)) continue;
        placed.push({ type: 'missile', position: { x, z }, rotation: 0, dimensions: missileDims });
        break;
      }
    }

    // Outer perimeter cover walls
    const coverCount = 4 + Math.floor(rng() * 4);
    const hw         = WORLD_SIZE / 2 * 0.72;
    for (let i = 0; i < coverCount; i++) {
      for (let attempt = 0; attempt < OBSTACLES.maxPlacementAttempts; attempt++) {
        const x = (rng() * 2 - 1) * hw;
        const z = (rng() * 2 - 1) * hw;
        if (Math.abs(x) < R - 6 && Math.abs(z) < R - 6) continue; // exclude interior
        if (!this._passesSpawnCheck(x, z))              continue;
        if (!this._passesClusterCheck(x, z, placed))    continue;
        placed.push({ type: 'wall', position: { x, z }, rotation: Math.floor(rng() * 2) * (Math.PI / 2), dimensions: wallDims });
        break;
      }
    }

    return placed;
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  _passesSpawnCheck(x, z) {
    return !this._nearSpawn(x, z, OBSTACLES.minDistanceFromSpawn);
  }

  _nearSpawn(x, z, dist) {
    const dpx = x - SPAWN.player.x;
    const dpz = z - SPAWN.player.z;
    const dex = x - SPAWN.enemy.x;
    const dez = z - SPAWN.enemy.z;
    return Math.sqrt(dpx * dpx + dpz * dpz) < dist
        || Math.sqrt(dex * dex + dez * dez) < dist;
  }

  /** @param {number} [minDist] — override OBSTACLES.minDistanceBetween */
  _passesClusterCheck(x, z, placed, minDist = OBSTACLES.minDistanceBetween) {
    for (const p of placed) {
      const cx = x - p.position.x;
      const cz = z - p.position.z;
      if (Math.sqrt(cx * cx + cz * cz) < minDist) return false;
    }
    return true;
  }
}
