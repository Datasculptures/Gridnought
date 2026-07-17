import * as THREE from 'three';
import { CELL_SIZE, CHUNK, COLORS } from '../utils/constants.js';
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

    // Chunk lifecycle callbacks (used by ObstacleManager)
    this._onChunkLoaded   = null;
    this._onChunkUnloaded = null;
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

  onChunkLoaded(cb)   { this._onChunkLoaded = cb; }
  onChunkUnloaded(cb) { this._onChunkUnloaded = cb; }

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
    if (this._onChunkLoaded) this._onChunkLoaded(chunk);
    return chunk;
  }

  // ---------------------------------------------------------------------------
  // Chunk construction
  // ---------------------------------------------------------------------------

  _buildChunk(cx, cz) {
    const N      = CHUNK.cells;           // cells per side
    const verts  = N + 1;                 // vertices per side
    const origin = { x: cx * CHUNK.size, z: cz * CHUNK.size };

    // Sample vertex heights from the world function
    const heights = new Float32Array(verts * verts);
    for (let vz = 0; vz < verts; vz++) {
      for (let vx = 0; vx < verts; vx++) {
        heights[vz * verts + vx] = this.worldGen.heightAt(
          origin.x + vx * CELL_SIZE,
          origin.z + vz * CELL_SIZE,
        );
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

    // Grid wireframe (horizontal + vertical edges only, no diagonals)
    const segCount = 2 * verts * N;
    const buf = new Float32Array(segCount * 2 * 3);
    let idx = 0;
    for (let vz = 0; vz < verts; vz++) {
      for (let vx = 0; vx < N; vx++) {
        buf[idx++] = origin.x + vx * CELL_SIZE;       buf[idx++] = heights[vz * verts + vx];       buf[idx++] = origin.z + vz * CELL_SIZE;
        buf[idx++] = origin.x + (vx + 1) * CELL_SIZE; buf[idx++] = heights[vz * verts + vx + 1];   buf[idx++] = origin.z + vz * CELL_SIZE;
      }
    }
    for (let vx = 0; vx < verts; vx++) {
      for (let vz = 0; vz < N; vz++) {
        buf[idx++] = origin.x + vx * CELL_SIZE; buf[idx++] = heights[vz * verts + vx];         buf[idx++] = origin.z + vz * CELL_SIZE;
        buf[idx++] = origin.x + vx * CELL_SIZE; buf[idx++] = heights[(vz + 1) * verts + vx];   buf[idx++] = origin.z + (vz + 1) * CELL_SIZE;
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(buf, 3));
    const lineMat  = new THREE.LineBasicMaterial({ color: COLORS.terrain, transparent: true, opacity: 0.35 });
    const gridMesh = new THREE.LineSegments(lineGeo, lineMat);

    this.scene.add(solidMesh);
    this.scene.add(gridMesh);
    this.solidMeshes.push(solidMesh);

    return { cx, cz, heights, solidMesh, gridMesh, lineMat };
  }

  _disposeChunk(chunk) {
    if (this._onChunkUnloaded) this._onChunkUnloaded(chunk);
    const mi = this.solidMeshes.indexOf(chunk.solidMesh);
    if (mi !== -1) this.solidMeshes.splice(mi, 1);
    this.scene.remove(chunk.solidMesh);
    chunk.solidMesh.geometry.dispose(); // shared terrainSolid material — keep
    this.scene.remove(chunk.gridMesh);
    chunk.gridMesh.geometry.dispose();
    chunk.lineMat.dispose();
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
