import * as THREE from 'three';
import { OBSTACLES } from '../utils/constants.js';

/**
 * A single static obstacle on the battlefield.
 * Holds its mesh and an oriented bounding box (OBB) for collision queries.
 * Uses a per-instance solid material (disposed in dispose()) and the
 * Per-instance wireframe and solid materials are both disposed in dispose().
 */
export default class Obstacle {
  /**
   * @param {THREE.Scene} scene
   * @param {{type, position, rotation, dimensions}} descriptor
   * @param {object} terrain
   */
  constructor(scene, descriptor, terrain) {
    this.scene      = scene;
    this.type       = descriptor.type;
    this.rotation   = descriptor.rotation;
    this.dimensions = descriptor.dimensions;

    const { x, z }     = descriptor.position;
    const { width: w, height: h, depth: d } = descriptor.dimensions;

    // Base Y: explicit override (bridge decks sit level above the ravine),
    // otherwise the lowest terrain height under the footprint (centre +
    // rotated corners) minus a small sink, so obstacles on slopes never
    // float with a gap under one edge — they bed into the high side.
    if (descriptor.baseY !== undefined) {
      this.y = descriptor.baseY;
    } else {
      const cosR = Math.cos(descriptor.rotation);
      const sinR = Math.sin(descriptor.rotation);
      const hw = w / 2, hd = d / 2;
      let minH = terrain.getHeightAt(x, z);
      for (const [lx, lz] of [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]]) {
        const wx = x + lx * cosR + lz * sinR;
        const wz = -lx * sinR + lz * cosR + z;
        const hh = terrain.getHeightAt(wx, wz);
        if (hh < minH) minH = hh;
      }
      this.y = minH - 0.15;
    }

    // World-space position of the obstacle's base centre
    this.worldPosition = new THREE.Vector3(x, this.y, z);

    // --- Build geometry (shared between solid fill and wireframe meshes) ---
    this._geometry = descriptor.type === 'wedge'
      ? this._buildWedgeGeometry(w, h, d)
      : descriptor.type === 'pyramid' || descriptor.type === 'missile'
        ? new THREE.ConeGeometry(w / 2, h, 4)
      : descriptor.type === 'tree'
        ? new THREE.ConeGeometry(w / 2, h, 7)
      : descriptor.type === 'cylinder'
        ? new THREE.CylinderGeometry(w / 2, w / 2, h, 8)
      : descriptor.type === 'bollard'
        ? this._buildCaltropGeometry(w, h)
      : new THREE.BoxGeometry(w, h, d);

    const meshY = this.y + h / 2;

    // Per-instance solid fill: black
    this._solidMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.solidMesh = new THREE.Mesh(this._geometry, this._solidMaterial);
    this.solidMesh.position.set(x, meshY, z);
    this.solidMesh.rotation.y = descriptor.rotation;
    scene.add(this.solidMesh);

    // Per-instance edges — bright green (Battlezone arcade style); EdgesGeometry
    // avoids the wireframe diagonal cross-lines on each face.
    this._edgesGeometry = new THREE.EdgesGeometry(this._geometry);
    this._wireMaterial  = new THREE.LineBasicMaterial({ color: OBSTACLES.color });
    this.mesh = new THREE.LineSegments(this._edgesGeometry, this._wireMaterial);
    this.mesh.position.set(x, meshY, z);
    this.mesh.rotation.y = descriptor.rotation;
    scene.add(this.mesh);

    // --- Oriented bounding box (OBB) ---
    // Y axis is always world-up — obstacles don't tilt with terrain.
    // Precompute local-space axes in world space for fast collision checks.
    const cos = Math.cos(descriptor.rotation);
    const sin = Math.sin(descriptor.rotation);
    this.obb = {
      center: new THREE.Vector3(x, this.y + h / 2, z),
      halfExtents: new THREE.Vector3(w / 2, h / 2, d / 2),
      rotation: descriptor.rotation,
      // World-space direction of local +X axis after Y rotation
      axisX: new THREE.Vector3(cos, 0, -sin),
      // World-space direction of local +Z axis after Y rotation
      axisZ: new THREE.Vector3(sin, 0,  cos),
    };
  }

  // ---------------------------------------------------------------------------
  // Solid-colour helpers
  // ---------------------------------------------------------------------------

  /** Returns the solid-fill hex colour for this obstacle type. */
  _solidColor(type, height) {
    if (type === 'pyramid' || type === 'tree') return 0x003300; // dark green
    if (type === 'cylinder') {
      // Darker grey than buildings
      const t    = Math.max(0, Math.min(1, (height - 2.5) / 2.5));
      const grey = Math.round(44 + t * 28); // [44, 72]
      return (grey << 16) | (grey << 8) | grey;
    }
    if (type === 'missile') return 0x555555; // medium-dark grey
    // Rectangular buildings (cube, tallCube, wall, wedge, bunker, cityBlock):
    // grey scaled by height (taller = lighter)
    const t    = Math.max(0, Math.min(1, (height - 2.5) / 2.5)); // normalise [2.5, 5.0]
    const grey = Math.round(64 + t * 48);                         // [64, 112]
    return (grey << 16) | (grey << 8) | grey;
  }

  /** Returns a brightened (×2, clamped) version of a solid hex for the wireframe. */
  _wireColor(solidHex) {
    const r = Math.min(255, ((solidHex >> 16) & 0xff) * 2);
    const g = Math.min(255, ((solidHex >>  8) & 0xff) * 2);
    const b = Math.min(255, ((solidHex       ) & 0xff) * 2);
    return (r << 16) | (g << 8) | b;
  }

  // ---------------------------------------------------------------------------
  // Wedge geometry (triangular prism — ramps from height h at back to 0 at front)
  // ---------------------------------------------------------------------------

  /**
   * Anti-tank caltrop: four heavy spikes radiating from a central hub in a
   * tetrahedral arrangement — three splayed down to the ground, one straight
   * up. Built by merging transformed cones into one buffer geometry.
   */
  _buildCaltropGeometry(w, h) {
    // Three legs splayed down to the ground plus one spike straight up.
    // Built so the leg tips land exactly on y=0, then re-centred on the
    // bounding box because the caller positions meshes at (base + h/2).
    const L    = w / 2;                 // leg length
    const tilt = 0.87;                  // ~50° from vertical
    const hubY = L * Math.cos(tilt);    // hub height that puts tips on the ground
    const r    = L * 0.15;              // limb thickness
    const geos = [];

    const limb = (rotX, rotY) => {
      const g = new THREE.ConeGeometry(r, L, 4);
      g.translate(0, L / 2, 0);   // base at origin, apex at +L
      g.rotateX(rotX);
      g.rotateY(rotY);
      g.translate(0, hubY, 0);    // lift onto the hub
      geos.push(g);
    };

    limb(0, 0);                                    // vertical spike
    for (let i = 0; i < 3; i++) {                  // splayed legs
      limb(Math.PI - tilt, (i / 3) * Math.PI * 2);
    }
    const hub = new THREE.BoxGeometry(r * 2.4, r * 2.4, r * 2.4);
    hub.translate(0, hubY, 0);
    geos.push(hub);

    // Merge manually — avoids a BufferGeometryUtils dependency
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    let off = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, off);
      off += g.attributes.position.array.length;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // Geometry currently spans y = 0 .. hubY + L; centre it on that span
    merged.translate(0, -(hubY + L) / 2, 0);
    merged.computeBoundingSphere();
    return merged;
  }

  _buildWedgeGeometry(w, h, d) {
    const geo = new THREE.BufferGeometry();

    // 8 triangles, non-indexed (24 vertices)
    // Vertices: v0=(-w/2,0,-d/2), v1=(w/2,0,-d/2), v2=(w/2,0,d/2), v3=(-w/2,0,d/2)
    //           v4=(-w/2,h,-d/2), v5=(w/2,h,-d/2)
    /* eslint-disable no-multi-spaces */
    const verts = new Float32Array([
      // Bottom face (2 tris)
      -w/2, 0, -d/2,   w/2, 0, -d/2,   w/2, 0,  d/2,
      -w/2, 0, -d/2,   w/2, 0,  d/2,  -w/2, 0,  d/2,
      // Back face — vertical (2 tris)
       w/2, 0, -d/2,  -w/2, 0, -d/2,  -w/2, h, -d/2,
       w/2, 0, -d/2,  -w/2, h, -d/2,   w/2, h, -d/2,
      // Sloped top face (2 tris)
      -w/2, h, -d/2,   w/2, h, -d/2,   w/2, 0,  d/2,
      -w/2, h, -d/2,   w/2, 0,  d/2,  -w/2, 0,  d/2,
      // Left triangular end (1 tri)
      -w/2, 0, -d/2,  -w/2, 0,  d/2,  -w/2, h, -d/2,
      // Right triangular end (1 tri)
       w/2, 0, -d/2,   w/2, h, -d/2,   w/2, 0,  d/2,
    ]);
    /* eslint-enable no-multi-spaces */

    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------------------
  // Collision queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the world-space point is inside this OBB expanded by `padding`.
   * Input NaN/Infinity → false (no collision).
   */
  containsPoint(worldX, worldY, worldZ, padding) {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)
        || !Number.isFinite(padding)) {
      return false;
    }

    const dx = worldX - this.obb.center.x;
    const dy = worldY - this.obb.center.y;
    const dz = worldZ - this.obb.center.z;

    // Project onto local OBB axes
    const localX = dx * this.obb.axisX.x + dz * this.obb.axisX.z;
    const localZ = dx * this.obb.axisZ.x + dz * this.obb.axisZ.z;

    return Math.abs(localX) <= this.obb.halfExtents.x + padding
        && Math.abs(dy)     <= this.obb.halfExtents.y + padding
        && Math.abs(localZ) <= this.obb.halfExtents.z + padding;
  }

  /**
   * Returns true if the sphere (centre, radius) overlaps the OBB expanded by padding.
   * Uses the standard OBB-sphere closest-point test.
   * NaN in sphereCentre → false.
   */
  intersectsSphere(sphereCentre, sphereRadius, padding) {
    if (!Number.isFinite(sphereCentre.x) || !Number.isFinite(sphereCentre.y)
        || !Number.isFinite(sphereCentre.z)) {
      return false;
    }

    const dx = sphereCentre.x - this.obb.center.x;
    const dy = sphereCentre.y - this.obb.center.y;
    const dz = sphereCentre.z - this.obb.center.z;

    // Project sphere centre onto local OBB axes
    const lx = dx * this.obb.axisX.x + dz * this.obb.axisX.z;
    const ly = dy;
    const lz = dx * this.obb.axisZ.x + dz * this.obb.axisZ.z;

    // Expanded half-extents
    const ex = this.obb.halfExtents.x + padding;
    const ey = this.obb.halfExtents.y + padding;
    const ez = this.obb.halfExtents.z + padding;

    // Closest point on OBB surface (in local space)
    const cx = Math.max(-ex, Math.min(ex, lx));
    const cy = Math.max(-ey, Math.min(ey, ly));
    const cz = Math.max(-ez, Math.min(ez, lz));

    const distSq = (lx - cx) * (lx - cx)
                 + (ly - cy) * (ly - cy)
                 + (lz - cz) * (lz - cz);

    return distSq <= sphereRadius * sphereRadius;
  }

  /**
   * Ray-OBB intersection. Returns { hit: boolean, distance: number }.
   * Transforms the ray into OBB local space, then performs slab intersection.
   * NaN in origin or direction → { hit: false, distance: Infinity }.
   *
   * @param {{ x, y, z }} origin    - Ray start (world space).
   * @param {{ x, y, z }} direction - Ray direction (should be normalised).
   * @param {number}      maxDistance
   */
  intersectsRay(origin, direction, maxDistance) {
    if (!Number.isFinite(origin.x) || !Number.isFinite(direction.x)
        || !Number.isFinite(maxDistance)) {
      return { hit: false, distance: Infinity };
    }

    // Transform ray origin into OBB local space
    const dx = origin.x - this.obb.center.x;
    const dy = origin.y - this.obb.center.y;
    const dz = origin.z - this.obb.center.z;

    const ox = dx * this.obb.axisX.x + dz * this.obb.axisX.z;
    const oy = dy;
    const oz = dx * this.obb.axisZ.x + dz * this.obb.axisZ.z;

    // Transform ray direction into OBB local space
    const rx = direction.x * this.obb.axisX.x + direction.z * this.obb.axisX.z;
    const ry = direction.y;
    const rz = direction.x * this.obb.axisZ.x + direction.z * this.obb.axisZ.z;

    const hx = this.obb.halfExtents.x;
    const hy = this.obb.halfExtents.y;
    const hz = this.obb.halfExtents.z;

    // Slab intersection
    let tmin = 0;
    let tmax = maxDistance;

    const axes = [
      [ox, rx, hx],
      [oy, ry, hy],
      [oz, rz, hz],
    ];

    for (const [lo, ld, h] of axes) {
      if (Math.abs(ld) < 1e-10) {
        // Ray is parallel to this slab — if outside, no hit
        if (Math.abs(lo) > h) return { hit: false, distance: Infinity };
      } else {
        const t1 = (-h - lo) / ld;
        const t2 = ( h - lo) / ld;
        const tEntry = Math.min(t1, t2);
        const tExit  = Math.max(t1, t2);
        tmin = Math.max(tmin, tEntry);
        tmax = Math.min(tmax, tExit);
        if (tmin > tmax) return { hit: false, distance: Infinity };
      }
    }

    if (tmax >= 0 && tmin <= tmax) {
      return { hit: true, distance: Math.max(0, tmin) };
    }
    return { hit: false, distance: Infinity };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose() {
    if (this.solidMesh) {
      this.scene.remove(this.solidMesh);
      this.solidMesh = null;
    }
    if (this._solidMaterial) {
      this._solidMaterial.dispose(); // per-instance — safe to dispose
      this._solidMaterial = null;
    }
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this._wireMaterial) {
      this._wireMaterial.dispose();
      this._wireMaterial = null;
    }
    if (this._edgesGeometry) {
      this._edgesGeometry.dispose();
      this._edgesGeometry = null;
    }
    if (this._geometry) {
      this._geometry.dispose();
      this._geometry = null;
    }
    this.obb           = null;
    this.worldPosition = null;
    this.scene         = null;
  }
}
