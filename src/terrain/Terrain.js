import * as THREE from 'three';
import { GRID_SIZE, CELL_SIZE, WORLD_SIZE, COLORS } from '../utils/constants.js';
import Materials from '../rendering/Materials.js';
import TerrainGenerator from './TerrainGenerator.js';

export default class Terrain {
  constructor(scene) {
    this.scene           = scene;
    this.heightMap       = null;
    this.passable        = null;
    this.solidMesh       = null;
    this.gridMesh        = null;
    this._gridLineMat    = null;
    this.seed            = null;
    this.mapType         = 'hills';
    // Convenience reference set by GameManager after obstacle generation.
    this.obstacleManager = null;
  }

  /**
   * Generates terrain data and builds the Three.js mesh.
   * @param {number|undefined} seed    - Optional seed; random if omitted.
   * @param {string}           mapType - 'hills' | 'city' | 'river'
   * @returns {this} for chaining
   */
  build(seed, mapType = 'hills') {
    const generator = new TerrainGenerator();
    const result = generator.generate(seed, mapType);
    this.heightMap = result.heightMap;
    this.passable  = result.passable;
    this.seed      = result.seed;
    this.mapType   = result.mapType;

    this._buildMesh();
    this.scene.add(this.solidMesh);
    this.gridMesh = this._buildGridMesh();
    this.scene.add(this.gridMesh);
    return this;
  }

  _buildMesh() {
    const geometry = new THREE.PlaneGeometry(
      WORLD_SIZE,
      WORLD_SIZE,
      GRID_SIZE - 1,
      GRID_SIZE - 1,
    );

    // Rotate so the plane lies flat in the XZ plane
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const halfWorld = WORLD_SIZE / 2;

    for (let i = 0; i < positions.count; i++) {
      // Map vertex world position to grid indices
      let gridX = Math.round((positions.getX(i) + halfWorld) / CELL_SIZE);
      let gridZ = Math.round((positions.getZ(i) + halfWorld) / CELL_SIZE);

      // Clamp to valid range
      gridX = Math.max(0, Math.min(GRID_SIZE - 1, gridX));
      gridZ = Math.max(0, Math.min(GRID_SIZE - 1, gridZ));

      positions.setY(i, this.heightMap[gridX][gridZ]);
    }

    positions.needsUpdate = true;

    // Solid black fill (uses shared Materials.terrainSolid — do not dispose)
    this.solidMesh = new THREE.Mesh(geometry, Materials.terrainSolid);
  }

  /**
   * Builds a LineSegments mesh with only horizontal and vertical grid edges — no diagonals.
   * Each grid quad contributes 4 edges (shared with neighbours), giving a clean square grid.
   */
  _buildGridMesh() {
    const halfWorld = WORLD_SIZE / 2;
    // 2 directions × GRID_SIZE lines × (GRID_SIZE-1) segments each
    const segCount = 2 * GRID_SIZE * (GRID_SIZE - 1);
    const buf = new Float32Array(segCount * 2 * 3); // 2 endpoints × 3 floats
    let idx = 0;

    // Horizontal segments: for each Z row, walk along X
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      for (let gx = 0; gx < GRID_SIZE - 1; gx++) {
        buf[idx++] = -halfWorld + gx * CELL_SIZE;       buf[idx++] = this.heightMap[gx][gz];     buf[idx++] = -halfWorld + gz * CELL_SIZE;
        buf[idx++] = -halfWorld + (gx + 1) * CELL_SIZE; buf[idx++] = this.heightMap[gx + 1][gz]; buf[idx++] = -halfWorld + gz * CELL_SIZE;
      }
    }

    // Vertical segments: for each X column, walk along Z
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      for (let gz = 0; gz < GRID_SIZE - 1; gz++) {
        buf[idx++] = -halfWorld + gx * CELL_SIZE; buf[idx++] = this.heightMap[gx][gz];     buf[idx++] = -halfWorld + gz * CELL_SIZE;
        buf[idx++] = -halfWorld + gx * CELL_SIZE; buf[idx++] = this.heightMap[gx][gz + 1]; buf[idx++] = -halfWorld + (gz + 1) * CELL_SIZE;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(buf, 3));
    this._gridLineMat = new THREE.LineBasicMaterial({ color: COLORS.terrain, transparent: true, opacity: 0.35 });
    return new THREE.LineSegments(geo, this._gridLineMat);
  }

  /**
   * Returns the bilinearly interpolated terrain height at world position (worldX, worldZ).
   * Returns 0 for out-of-bounds or NaN inputs.
   */
  getHeightAt(worldX, worldZ) {
    // NaN guard
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return 0;

    const halfWorld = WORLD_SIZE / 2;
    const gx = (worldX + halfWorld) / CELL_SIZE;
    const gz = (worldZ + halfWorld) / CELL_SIZE;

    // Bounds check
    if (gx < 0 || gx > GRID_SIZE - 1 || gz < 0 || gz > GRID_SIZE - 1) return 0;

    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(x0 + 1, GRID_SIZE - 1);
    const z1 = Math.min(z0 + 1, GRID_SIZE - 1);
    const fx = gx - x0;
    const fz = gz - z0;

    const h00 = this.heightMap[x0][z0];
    const h10 = this.heightMap[x1][z0];
    const h01 = this.heightMap[x0][z1];
    const h11 = this.heightMap[x1][z1];

    return h00 * (1 - fx) * (1 - fz)
         + h10 * fx       * (1 - fz)
         + h01 * (1 - fx) * fz
         + h11 * fx       * fz;
  }

  /**
   * Returns the surface normal at world position (worldX, worldZ) as a THREE.Vector3.
   * Uses finite differences. Points generally upward (positive Y) on flat terrain.
   */
  getNormalAt(worldX, worldZ) {
    const step = CELL_SIZE * 0.5;
    const hL = this.getHeightAt(worldX - step, worldZ);
    const hR = this.getHeightAt(worldX + step, worldZ);
    const hD = this.getHeightAt(worldX, worldZ - step);
    const hU = this.getHeightAt(worldX, worldZ + step);

    // Tangent vectors along X and Z, then cross product
    const tx = new THREE.Vector3(2 * step, hR - hL, 0);
    const tz = new THREE.Vector3(0, hU - hD, 2 * step);
    const normal = new THREE.Vector3().crossVectors(tz, tx).normalize();
    return normal;
  }

  /**
   * Returns whether the given world cell is passable in the given direction.
   * @param {number} worldX
   * @param {number} worldZ
   * @param {'north'|'south'|'east'|'west'} direction
   * @returns {boolean}
   */
  isPassable(worldX, worldZ, direction) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return false;

    const x = Math.floor((worldX + WORLD_SIZE / 2) / CELL_SIZE);
    const z = Math.floor((worldZ + WORLD_SIZE / 2) / CELL_SIZE);

    if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return false;

    return this.passable[x][z][direction] === true;
  }

  /**
   * Converts world coordinates to integer grid indices.
   * Returns { x, z } clamped to valid range, or null if input is NaN.
   */
  getGridPosition(worldX, worldZ) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;

    const x = Math.max(0, Math.min(GRID_SIZE - 1,
      Math.floor((worldX + WORLD_SIZE / 2) / CELL_SIZE)
    ));
    const z = Math.max(0, Math.min(GRID_SIZE - 1,
      Math.floor((worldZ + WORLD_SIZE / 2) / CELL_SIZE)
    ));

    return { x, z };
  }

  update(_delta) {
    // Terrain is static; no-op satisfies the system interface
  }

  dispose() {
    if (this.solidMesh) {
      this.scene.remove(this.solidMesh);
      this.solidMesh.geometry.dispose(); // Do NOT dispose Materials.terrainSolid — shared
      this.solidMesh = null;
    }
    if (this.gridMesh) {
      this.scene.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
      this._gridLineMat.dispose();
      this.gridMesh     = null;
      this._gridLineMat = null;
    }
    this.heightMap = null;
    this.passable  = null;
    this.scene     = null;
  }
}
