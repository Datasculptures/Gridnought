import * as THREE from 'three';
import { CELL_SIZE, CHUNK, COLORS, WATER, HAZARD } from '../utils/constants.js';
import Materials from '../rendering/Materials.js';
import WorldGenerator from './WorldGenerator.js';

/**
 * Streaming infinite terrain built from fixed-size chunks.
 *
 * Presents the same query API as the legacy bounded Terrain
 * (getHeightAt / getNormalAt / isPassable / seed / mapType / obstacleManager)
 * so tanks, AI, physics, and projectiles work unchanged.
 *
 * Chunks are generated deterministically from (seed, chunk coords) via
 * WorldGenerator, so driving away and back always recreates identical ground.
 *
 * setFocus(x, z) — call every frame with the player position; chunks build
 * in a small per-frame budget and unload beyond CHUNK.unloadRadius.
 */
export default class ChunkedTerrain {
  constructor(scene) {
    this.scene           = scene;
    this.seed            = null;
    this.mapType         = 'infinite';
    this.worldGen        = null;
    this.obstacleManager = null;   // convenience ref set by GameManager

    // "cx,cz" → { cx, cz, heights: Float32Array, solidMesh, gridMesh, lineMat }
    this.chunks       = new Map();
    // Flat list of chunk fill meshes — raycast targets for turret aiming
    this.solidMeshes  = [];
    this._buildQueue  = [];        // pending [cx, cz] sorted nearest-first
    this._queued      = new Set(); // keys already in the queue
    this._focus       = { cx: 0, cz: 0 };

    // Vertex-height cache for queries outside loaded chunks
    this._vhCache     = new Map();

    // Chunk lifecycle listeners (ObstacleManager, enemy spawner, ...)
    this._onChunkLoaded   = [];
    this._onChunkUnloaded = [];
  }

  /**
   * Initialises the world. The 3×3 chunks around the origin build
   * synchronously so spawning is safe; the rest stream in via update().
   */
  build(seed, _mapType = 'infinite') {
    if (seed === undefined || seed === null) {
      seed = Math.floor(Math.random() * 2147483647);
    }
    this.seed     = seed;
    this.worldGen = new WorldGenerator(seed);

    this.setFocus(0, 0);
    // Force-build the immediate neighbourhood synchronously
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this._ensureChunk(dx, dz, true);
      }
    }
    return this;
  }

  onChunkLoaded(cb)   { this._onChunkLoaded.push(cb); }
  onChunkUnloaded(cb) { this._onChunkUnloaded.push(cb); }

  /** World position → containing chunk coords. */
  chunkCoordsAt(wx, wz) {
    return {
      cx: Math.floor(wx / CHUNK.size),
      cz: Math.floor(wz / CHUNK.size),
    };
  }

  // ---------------------------------------------------------------------------
  // Streaming
  // ---------------------------------------------------------------------------

  /**
   * Updates the streaming focus (player position). Queues missing chunks in
   * the load ring and unloads chunks beyond the unload ring.
   */
  setFocus(wx, wz) {
    const { cx, cz } = this.chunkCoordsAt(wx, wz);
    if (cx === this._focus.cx && cz === this._focus.cz && this.chunks.size > 0) return;
    this._focus = { cx, cz };

    // Queue missing chunks within loadRadius
    for (let dx = -CHUNK.loadRadius; dx <= CHUNK.loadRadius; dx++) {
      for (let dz = -CHUNK.loadRadius; dz <= CHUNK.loadRadius; dz++) {
        const kx = cx + dx, kz = cz + dz;
        const key = kx + ',' + kz;
        if (!this.chunks.has(key) && !this._queued.has(key)) {
          this._buildQueue.push([kx, kz]);
          this._queued.add(key);
        }
      }
    }

    // Nearest chunks build first
    this._buildQueue.sort((a, b) => {
      const da = (a[0] - cx) ** 2 + (a[1] - cz) ** 2;
      const db = (b[0] - cx) ** 2 + (b[1] - cz) ** 2;
      return da - db;
    });

    // Unload chunks beyond unloadRadius
    for (const [key, chunk] of this.chunks) {
      const ddx = chunk.cx - cx;
      const ddz = chunk.cz - cz;
      if (Math.max(Math.abs(ddx), Math.abs(ddz)) > CHUNK.unloadRadius) {
        this._disposeChunk(chunk);
        this.chunks.delete(key);
      }
    }
  }

  /** Builds queued chunks within the per-frame budget. */
  update(_delta) {
    let built = 0;
    while (this._buildQueue.length > 0 && built < CHUNK.buildsPerFrame) {
      const [cx, cz] = this._buildQueue.shift();
      const key = cx + ',' + cz;
      this._queued.delete(key);
      // Skip if it drifted out of range while queued
      if (Math.max(Math.abs(cx - this._focus.cx), Math.abs(cz - this._focus.cz)) > CHUNK.loadRadius) {
        continue;
      }
      this._ensureChunk(cx, cz, true);
      built++;
    }
  }

  _ensureChunk(cx, cz, buildNow) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return this.chunks.get(key);
    if (!buildNow) return null;

    const chunk = this._buildChunk(cx, cz);
    this.chunks.set(key, chunk);
    for (const cb of this._onChunkLoaded) cb(chunk);
    return chunk;
  }

  // ---------------------------------------------------------------------------
  // Chunk construction
  // ---------------------------------------------------------------------------

  _buildChunk(cx, cz) {
    const N      = CHUNK.cells;           // cells per side
    const verts  = N + 1;                 // vertices per side
    const origin = { x: cx * CHUNK.size, z: cz * CHUNK.size };

    // Sample vertex heights from the world function; note whether a river
    // channel actually runs deep here (water is river-only, not valleys)
    const heights = new Float32Array(verts * verts);
    const hazard  = new Uint8Array(verts * verts); // 1 = inside a river channel
    let hasDeepRiver = false;
    for (let vz = 0; vz < verts; vz++) {
      for (let vx = 0; vx < verts; vx++) {
        const wx = origin.x + vx * CELL_SIZE;
        const wz = origin.z + vz * CELL_SIZE;
        const h  = this.worldGen.heightAt(wx, wz);
        heights[vz * verts + vx] = h;
        // Flag ravine ground so its grid lines can be drawn in hazard blue —
        // narrow channels are otherwise nearly invisible at a shallow angle.
        if (h < WATER.level && this.worldGen.riverInfoAt(wx, wz).inChannel) {
          hazard[vz * verts + vx] = 1;
          hasDeepRiver = true;
        }
      }
    }

    // Solid black fill mesh (hides wireframe behind ridgelines)
    const geo = new THREE.PlaneGeometry(CHUNK.size, CHUNK.size, N, N);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = Math.round((pos.getX(i) + CHUNK.size / 2) / CELL_SIZE);
      const vz = Math.round((pos.getZ(i) + CHUNK.size / 2) / CELL_SIZE);
      pos.setY(i, heights[vz * verts + vx]);
    }
    pos.needsUpdate = true;
    const solidMesh = new THREE.Mesh(geo, Materials.terrainSolid);
    solidMesh.position.set(origin.x + CHUNK.size / 2, 0, origin.z + CHUNK.size / 2);

    // Grid wireframe (horizontal + vertical edges only, no diagonals).
    // Segments touching a river channel go into a separate bright-blue mesh
    // so ravines are unmistakable from any angle or distance.
    const land = [];
    const river = [];
    const seg = (ax, az, bx, bz) => {
      const ai = az * verts + ax, bi = bz * verts + bx;
      const target = (hazard[ai] || hazard[bi]) ? river : land;
      target.push(
        origin.x + ax * CELL_SIZE, heights[ai], origin.z + az * CELL_SIZE,
        origin.x + bx * CELL_SIZE, heights[bi], origin.z + bz * CELL_SIZE,
      );
    };
    for (let vz = 0; vz < verts; vz++) {
      for (let vx = 0; vx < N; vx++) seg(vx, vz, vx + 1, vz);
    }
    for (let vx = 0; vx < verts; vx++) {
      for (let vz = 0; vz < N; vz++) seg(vx, vz, vx, vz + 1);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(land), 3));
    const lineMat  = new THREE.LineBasicMaterial({ color: COLORS.terrain, transparent: true, opacity: 0.35 });
    const gridMesh = new THREE.LineSegments(lineGeo, lineMat);

    let riverMesh = null, riverMat = null;
    if (river.length > 0) {
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(river), 3));
      riverMat  = new THREE.LineBasicMaterial({ color: WATER.rimColor, transparent: true, opacity: 0.95 });
      riverMesh = new THREE.LineSegments(rGeo, riverMat);
      this.scene.add(riverMesh);
    }

    this.scene.add(solidMesh);
    this.scene.add(gridMesh);
    this.solidMeshes.push(solidMesh);

    // Water surface — covers exactly the cells the cyan rim outlines, so
    // every highlighted patch of ground is visibly flooded
    let water = null;
    if (WATER.enabled && hasDeepRiver) {
      water = this._buildWater(origin, hazard, verts, N);
    }

    return { cx, cz, heights, solidMesh, gridMesh, lineMat, riverMesh, riverMat, water };
  }

  /**
   * Water surface built from the submerged channel cells themselves, so the
   * flooded area lines up exactly with the cyan rim outline — no cyan ground
   * without water, and no water spilling across dry land or crater floors.
   */
  _buildWater(origin, hazard, verts, N) {
    const tri = [];   // surface quads
    const edge = [];  // outline segments along the shore
    const y = WATER.level;

    for (let vz = 0; vz < N; vz++) {
      for (let vx = 0; vx < N; vx++) {
        // Flood a cell only when ALL of its corners are submerged. Flooding
        // on any single corner let the flat surface cut through ground that
        // stands above the waterline; requiring all four keeps the shoreline
        // tight to the actual water's edge.
        const c00 = hazard[vz * verts + vx];
        const c10 = hazard[vz * verts + vx + 1];
        const c01 = hazard[(vz + 1) * verts + vx];
        const c11 = hazard[(vz + 1) * verts + vx + 1];
        if (!(c00 && c10 && c01 && c11)) continue;

        const x0 = origin.x + vx * CELL_SIZE, x1 = x0 + CELL_SIZE;
        const z0 = origin.z + vz * CELL_SIZE, z1 = z0 + CELL_SIZE;
        tri.push(
          x0, y, z0,  x1, y, z0,  x1, y, z1,
          x0, y, z0,  x1, y, z1,  x0, y, z1,
        );
        // Cell border lines give the surface its wireframe read
        edge.push(x0, y, z0, x1, y, z0,  x0, y, z0, x0, y, z1);
      }
    }
    if (tri.length === 0) return null;

    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri), 3));
    const fillMat = new THREE.MeshBasicMaterial({
      color: WATER.fillColor,
      transparent: true,
      opacity: WATER.fillOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edge), 3));
    const gridMat = new THREE.LineBasicMaterial({
      color: WATER.gridColor,
      transparent: true,
      opacity: WATER.gridOpacity,
    });
    const grid = new THREE.LineSegments(gridGeo, gridMat);

    this.scene.add(fill);
    this.scene.add(grid);
    return { fill, fillMat, grid, gridMat };
  }

  _disposeChunk(chunk) {
    for (const cb of this._onChunkUnloaded) cb(chunk);
    const mi = this.solidMeshes.indexOf(chunk.solidMesh);
    if (mi !== -1) this.solidMeshes.splice(mi, 1);
    this.scene.remove(chunk.solidMesh);
    chunk.solidMesh.geometry.dispose(); // shared terrainSolid material — keep
    this.scene.remove(chunk.gridMesh);
    chunk.gridMesh.geometry.dispose();
    chunk.lineMat.dispose();
    if (chunk.riverMesh) {
      this.scene.remove(chunk.riverMesh);
      chunk.riverMesh.geometry.dispose();
      chunk.riverMat.dispose();
    }
    if (chunk.water) {
      this.scene.remove(chunk.water.fill);
      this.scene.remove(chunk.water.grid);
      chunk.water.fill.geometry.dispose();
      chunk.water.fillMat.dispose();
      chunk.water.grid.geometry.dispose();
      chunk.water.gridMat.dispose();
    }
  }

  // ---------------------------------------------------------------------------
  // Height / normal / passability queries
  // ---------------------------------------------------------------------------

  /**
   * Height of the terrain vertex at integer global grid coords.
   * Reads chunk data when loaded, else computes analytically (cached) —
   * both paths sample the identical world function.
   */
  _vertexHeight(gx, gz) {
    const N   = CHUNK.cells;
    const cx  = Math.floor(gx / N);
    const cz  = Math.floor(gz / N);
    const chunk = this.chunks.get(cx + ',' + cz);
    if (chunk) {
      const lx = gx - cx * N;
      const lz = gz - cz * N;
      return chunk.heights[lz * (N + 1) + lx];
    }

    const key = gx + ',' + gz;
    let h = this._vhCache.get(key);
    if (h === undefined) {
      h = this.worldGen.heightAt(gx * CELL_SIZE, gz * CELL_SIZE);
      if (this._vhCache.size > 30000) this._vhCache.clear();
      this._vhCache.set(key, h);
    }
    return h;
  }

  /**
   * Bilinearly interpolated terrain height at any world position.
   * Defined everywhere — no world bounds.
   */
  getHeightAt(worldX, worldZ) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return 0;

    const gx = worldX / CELL_SIZE;
    const gz = worldZ / CELL_SIZE;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;

    const h00 = this._vertexHeight(x0,     z0);
    const h10 = this._vertexHeight(x0 + 1, z0);
    const h01 = this._vertexHeight(x0,     z0 + 1);
    const h11 = this._vertexHeight(x0 + 1, z0 + 1);

    return h00 * (1 - fx) * (1 - fz)
         + h10 * fx       * (1 - fz)
         + h01 * (1 - fx) * fz
         + h11 * fx       * fz;
  }

  /** Surface normal by finite differences (same contract as legacy Terrain). */
  getNormalAt(worldX, worldZ) {
    const step = CELL_SIZE * 0.5;
    const hL = this.getHeightAt(worldX - step, worldZ);
    const hR = this.getHeightAt(worldX + step, worldZ);
    const hD = this.getHeightAt(worldX, worldZ - step);
    const hU = this.getHeightAt(worldX, worldZ + step);
    const tx = new THREE.Vector3(2 * step, hR - hL, 0);
    const tz = new THREE.Vector3(0, hU - hD, 2 * step);
    return new THREE.Vector3().crossVectors(tz, tx).normalize();
  }

  /**
   * Cell passability in a cardinal direction, computed from vertex heights
   * against the slope threshold. Defined for the entire infinite world.
   */
  isPassable(worldX, worldZ, direction) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;

    const gx = Math.floor(worldX / CELL_SIZE);
    const gz = Math.floor(worldZ / CELL_SIZE);
    const h  = this._vertexHeight(gx, gz);

    let hN;
    switch (direction) {
      case 'north': hN = this._vertexHeight(gx, gz - 1); break;
      case 'south': hN = this._vertexHeight(gx, gz + 1); break;
      case 'east':  hN = this._vertexHeight(gx + 1, gz); break;
      case 'west':  hN = this._vertexHeight(gx - 1, gz); break;
      default: return false;
    }
    return this.worldGen.isSlopePassable(h, hN);
  }

  /** Dominant biome type at a world position (for spawning / obstacles / HUD). */
  biomeAt(worldX, worldZ) {
    return this.worldGen.biomeAt(worldX, worldZ);
  }

  /**
   * True where AI-controlled movers must not go: deep ground inside a river
   * channel. Craters and ordinary low terrain are explicitly NOT hazards —
   * only the water-cut ravines are.
   */
  isHazardAt(worldX, worldZ) {
    if (this.getHeightAt(worldX, worldZ) >= HAZARD.maxAIDepth) return false;
    return this.worldGen.riverInfoAt(worldX, worldZ).inChannel;
  }

  getLoadedChunks() {
    return this.chunks;
  }

  dispose() {
    for (const chunk of this.chunks.values()) this._disposeChunk(chunk);
    this.chunks.clear();
    this._buildQueue = [];
    this._queued.clear();
    this._vhCache.clear();
    if (this.worldGen) this.worldGen.dispose();
    this.worldGen = null;
    this.scene    = null;
  }
}
