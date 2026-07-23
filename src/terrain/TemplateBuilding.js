import * as THREE from 'three';

/**
 * A template building placed in the world.
 *
 * Wraps a BuildingTemplates builder so it drops into ObstacleManager's chunk
 * lists and answers the same queries as an Obstacle. Collision is a set of
 * oriented boxes (OBBs) — one per solid part the template declared — so a
 * damaged building's blown-out gaps are genuinely open, while a footprint OBB
 * gives the minimap its rectangle and lets every query broad-phase reject the
 * building in one test before touching the parts.
 */
export default class TemplateBuilding {
  /**
   * @param {THREE.Scene} scene
   * @param {{ template, position:{x,z}, rotation:number, terrain }} cfg
   */
  constructor(scene, { template, position, rotation, terrain }) {
    this.scene       = scene;
    this.type        = 'building';
    this.templateKey = template.letter;

    const built = template.build();
    this.group  = built.group;
    this._mats  = built.mats;
    this._geos  = built.geos;

    const rot = rotation || 0;
    const { x, z } = position;
    const fw = template.w, fd = template.d, fh = template.h;

    // Bed into the terrain: sit on the lowest ground under the (rotated)
    // footprint, minus a small sink, exactly like Obstacle.
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const hw = fw / 2, hd = fd / 2;
    let minH = terrain.getHeightAt(x, z);
    for (const [lx, lz] of [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]]) {
      const wx = x + lx * cos + lz * sin;
      const wz = z - lx * sin + lz * cos;
      const hh = terrain.getHeightAt(wx, wz);
      if (hh < minH) minH = hh;
    }
    this.y = minH - 0.15;

    this.worldPosition = new THREE.Vector3(x, this.y, z);
    this.dimensions    = { width: fw, height: fh, depth: fd };
    this.group.position.set(x, this.y, z);
    this.group.rotation.y = rot;
    scene.add(this.group);

    // Footprint OBB — minimap + broad-phase
    this.obb = makeOBB(x, this.y + fh / 2, z, hw, fh / 2, hd, rot);

    // Per-part collision OBBs (local box → world, honouring the part's own yaw)
    this._parts = built.colliders.map((c) => {
      const wx = x + c.x * cos + c.z * sin;
      const wz = z - c.x * sin + c.z * cos;
      return makeOBB(wx, this.y + c.y, wz, c.w / 2, c.h / 2, c.d / 2, rot + (c.ry || 0));
    });
  }

  intersectsSphere(centre, radius, padding) {
    if (!obbSphere(this.obb, centre, radius, padding)) return false;
    for (const p of this._parts) if (obbSphere(p, centre, radius, padding)) return true;
    return false;
  }

  containsPoint(x, y, z, padding) {
    if (!obbPoint(this.obb, x, y, z, padding)) return false;
    for (const p of this._parts) if (obbPoint(p, x, y, z, padding)) return true;
    return false;
  }

  intersectsRay(origin, direction, maxDistance) {
    if (!obbRay(this.obb, origin, direction, maxDistance).hit) {
      return { hit: false, distance: Infinity };
    }
    let best = Infinity;
    for (const p of this._parts) {
      const r = obbRay(p, origin, direction, maxDistance);
      if (r.hit && r.distance < best) best = r.distance;
    }
    return best === Infinity ? { hit: false, distance: Infinity } : { hit: true, distance: best };
  }

  dispose() {
    if (this.group) { this.scene.remove(this.group); this.group = null; }
    for (const m of this._mats || []) m.dispose();
    for (const g of this._geos || []) g.dispose();
    this._mats = null; this._geos = null; this._parts = null;
    this.obb = null; this.worldPosition = null; this.scene = null;
  }
}

// ---------------------------------------------------------------------------
// OBB helpers (Y-axis rotation only, matching Obstacle's convention)
// ---------------------------------------------------------------------------

function makeOBB(cx, cy, cz, hw, hh, hd, rot) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return {
    center: new THREE.Vector3(cx, cy, cz),
    halfExtents: new THREE.Vector3(hw, hh, hd),
    axisX: new THREE.Vector3(cos, 0, -sin),
    axisZ: new THREE.Vector3(sin, 0,  cos),
    rotation: rot,
  };
}

function obbSphere(obb, c, r, pad) {
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) return false;
  const dx = c.x - obb.center.x, dy = c.y - obb.center.y, dz = c.z - obb.center.z;
  const lx = dx * obb.axisX.x + dz * obb.axisX.z;
  const lz = dx * obb.axisZ.x + dz * obb.axisZ.z;
  const ex = obb.halfExtents.x + pad, ey = obb.halfExtents.y + pad, ez = obb.halfExtents.z + pad;
  const qx = Math.max(-ex, Math.min(ex, lx));
  const qy = Math.max(-ey, Math.min(ey, dy));
  const qz = Math.max(-ez, Math.min(ez, lz));
  const ddx = lx - qx, ddy = dy - qy, ddz = lz - qz;
  return ddx * ddx + ddy * ddy + ddz * ddz <= r * r;
}

function obbPoint(obb, x, y, z, pad) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(pad)) return false;
  const dx = x - obb.center.x, dy = y - obb.center.y, dz = z - obb.center.z;
  const lx = dx * obb.axisX.x + dz * obb.axisX.z;
  const lz = dx * obb.axisZ.x + dz * obb.axisZ.z;
  return Math.abs(lx) <= obb.halfExtents.x + pad
      && Math.abs(dy) <= obb.halfExtents.y + pad
      && Math.abs(lz) <= obb.halfExtents.z + pad;
}

function obbRay(obb, origin, direction, maxDistance) {
  if (!Number.isFinite(origin.x) || !Number.isFinite(direction.x) || !Number.isFinite(maxDistance)) {
    return { hit: false, distance: Infinity };
  }
  const dx = origin.x - obb.center.x, dy = origin.y - obb.center.y, dz = origin.z - obb.center.z;
  const ox = dx * obb.axisX.x + dz * obb.axisX.z;
  const oy = dy;
  const oz = dx * obb.axisZ.x + dz * obb.axisZ.z;
  const rx = direction.x * obb.axisX.x + direction.z * obb.axisX.z;
  const ry = direction.y;
  const rz = direction.x * obb.axisZ.x + direction.z * obb.axisZ.z;

  let tmin = 0, tmax = maxDistance;
  const axes = [[ox, rx, obb.halfExtents.x], [oy, ry, obb.halfExtents.y], [oz, rz, obb.halfExtents.z]];
  for (const [lo, ld, h] of axes) {
    if (Math.abs(ld) < 1e-10) {
      if (Math.abs(lo) > h) return { hit: false, distance: Infinity };
    } else {
      const t1 = (-h - lo) / ld, t2 = (h - lo) / ld;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) return { hit: false, distance: Infinity };
    }
  }
  return (tmax >= 0 && tmin <= tmax) ? { hit: true, distance: Math.max(0, tmin) } : { hit: false, distance: Infinity };
}
