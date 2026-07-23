import * as THREE from 'three';
import { OBSTACLES } from '../utils/constants.js';

/**
 * BUILDING TEMPLATE LIBRARY
 *
 * A gallery of hand-modelled, simplified-but-recognisable buildings used both
 * as evaluation exhibits in Area X and as real structures in the world. Each
 * renders in the standard battlefield style — black solid fill under a
 * bright-green edge wireframe.
 *
 * build() returns { group, mats, geos, colliders }:
 *   group     THREE.Group of the visible meshes (local frame, front = +Z)
 *   mats/geos disposables
 *   colliders array of local-space solid boxes { x, y, z, w, h, d, ry } — the
 *             blocking massing (walls, columns, roof). Thin panes, flat slabs,
 *             and decorative trim are excluded, so damaged buildings have real
 *             gaps you can drive and walk into. TemplateBuilding turns these
 *             into world-space OBBs.
 *
 * A collider is emitted only for parts that are both wide enough to matter and
 * tall enough to stop a hull — that is what keeps floor slabs, awnings, and
 * window frames from walling off an interior that should be open.
 */

const WIRE = OBSTACLES.color;   // 0x00ff00 — matches in-world obstacle edges
const COLLIDE_MIN_XZ = 0.35;    // a collider must be at least this wide/deep …
const COLLIDE_MIN_H  = 0.6;     // … and this tall (excludes flat slabs)

// ---------------------------------------------------------------------------
// Construction kit
// ---------------------------------------------------------------------------

function makeKit() {
  const S = new THREE.MeshBasicMaterial({
    color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const W = new THREE.LineBasicMaterial({ color: WIRE });
  const group = new THREE.Group();
  const geos = [];
  const colliders = [];

  const place = (geo, x, y, z, ry) => {
    geos.push(geo);
    const solid = new THREE.Mesh(geo, S);
    const edges = new THREE.EdgesGeometry(geo);
    geos.push(edges);
    const line = new THREE.LineSegments(edges, W);
    for (const m of [solid, line]) {
      m.position.set(x, y, z);
      if (ry) m.rotation.y = ry;
      group.add(m);
    }
  };

  const addCollider = (w, h, d, x, y, z, ry) => {
    if (Math.min(w, d) >= COLLIDE_MIN_XZ && h >= COLLIDE_MIN_H) {
      colliders.push({ x, y, z, w, h, d, ry: ry || 0 });
    }
  };

  const box = (w, h, d, x, y, z, ry = 0, collide = true) => {
    place(new THREE.BoxGeometry(w, h, d), x, y, z, ry);
    if (collide) addCollider(w, h, d, x, y, z, ry);
  };
  const cyl = (rt, rb, h, x, y, z, seg = 8, ry = 0, collide = true) => {
    place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, ry);
    if (collide) { const s = Math.max(rt, rb) * 2; addCollider(s, h, s, x, y, z, ry); }
  };
  const cone = (r, h, x, y, z, seg = 4, ry = 0) =>
    place(new THREE.ConeGeometry(r, h, seg), x, y, z, ry);   // spires/domes: visual only
  const gable = (w, h, d, x, y, z, ry = 0, collide = true) => {
    place(gableGeo(w, h, d), x, y, z, ry);
    if (collide) addCollider(w, h, d, x, y + h / 2, z, ry);
  };
  const collider = (w, h, d, x, y, z, ry = 0) => addCollider(w, h, d, x, y, z, ry);

  /** A tilted, non-colliding member (water-tower legs, ramps, conveyors). */
  const strut = (w, h, d, x, y, z, rx, rz) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const solid = new THREE.Mesh(geo, S);
    const edges = new THREE.EdgesGeometry(geo); geos.push(edges);
    const line = new THREE.LineSegments(edges, W);
    for (const m of [solid, line]) { m.position.set(x, y, z); m.rotation.x = rx || 0; m.rotation.z = rz || 0; group.add(m); }
  };

  /** Window-pane grid on a flat facade (never collides). */
  const windows = (axis, faceCoord, a0, a1, y0, y1, cols, rows, ww = 1.0, wh = 1.3) => {
    const t = 0.05;
    for (let c = 0; c < cols; c++) {
      const a = cols === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * (c / (cols - 1));
      for (let r = 0; r < rows; r++) {
        const y = rows === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * (r / (rows - 1));
        // 'z' facade: panes range along X (a) at fixed Z (faceCoord).
        // 'x' facade: panes range along Z (a) at fixed X (faceCoord).
        if (axis === 'z') box(ww, wh, t, a, y, faceCoord, 0, false);
        else box(t, wh, ww, faceCoord, y, a, 0, false);
      }
    }
  };

  return { S, W, group, geos, colliders, box, cyl, cone, gable, collider, strut, windows };
}

/** Triangular-prism gable roof: eaves at local y=0, ridge along Z at y=h. */
function gableGeo(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
  const E = [0, h, -hd], F = [0, h, hd];
  const tri = (p, q, r) => [...p, ...q, ...r];
  const verts = new Float32Array([
    ...tri(A, B, E), ...tri(C, D, F),
    ...tri(A, E, F), ...tri(A, F, D),
    ...tri(B, C, F), ...tri(B, F, E),
    ...tri(A, D, C), ...tri(A, C, B),
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

function built(kit) {
  return { group: kit.group, mats: [kit.S, kit.W], geos: kit.geos, colliders: kit.colliders };
}

// ---------------------------------------------------------------------------
// A — TOWNHOUSE ROW
// ---------------------------------------------------------------------------
function buildTownhouseRow() {
  const K = makeKit();
  const unitW = 3, depth = 6, wallH = 6.4;
  K.box(unitW * 3, wallH, depth, 0, wallH / 2, 0);
  for (let i = -1; i <= 1; i++) {
    const ux = i * unitW;
    K.gable(unitW, 1.7, depth, ux, wallH, 0);
    if (i !== 0) K.box(0.5, 1.3, 0.5, ux + 0.9, wallH + 1.5, -1.4);
    K.box(0.9, 2.0, 0.06, ux, 1.0, depth / 2 + 0.03, 0, false);
    K.windows('z', depth / 2 + 0.03, ux - 0.7, ux + 0.7, 2.2, 2.2, 1, 1, 0.9, 1.0);
    K.windows('z', depth / 2 + 0.03, ux, ux, 4.6, 4.6, 1, 1, 0.9, 1.1);
  }
  return built(K);
}

// ---------------------------------------------------------------------------
// B — SUBURBAN HOUSE
// ---------------------------------------------------------------------------
function buildSuburbanHouse() {
  const K = makeKit();
  K.box(6, 3.4, 6, 0, 1.7, 0);
  K.gable(6, 2.2, 6, 0, 3.4, 0);
  K.box(0.5, 1.1, 0.5, 1.6, 4.5, -1.4);
  K.box(3.6, 2.8, 4.2, 4.6, 1.4, -0.9);
  K.gable(3.6, 1.1, 4.2, 4.6, 2.8, -0.9);
  K.box(2.7, 2.0, 0.06, 4.6, 1.0, 1.24, 0, false);
  K.box(0.9, 1.9, 0.06, -1.6, 0.95, 3.03, 0, false);
  K.windows('z', 3.03, 0.4, 1.8, 1.6, 1.6, 2, 1, 1.0, 1.1);
  K.windows('x', -3.03, -1.5, 1.5, 1.7, 1.7, 2, 1, 1.1, 1.1);
  return built(K);
}

// ---------------------------------------------------------------------------
// C — CORNER STORE
// ---------------------------------------------------------------------------
function buildStore() {
  const K = makeKit();
  K.box(10, 4, 6, 0, 2, 0);
  K.box(9.4, 1.0, 0.3, 0, 4.6, 2.6);
  K.box(2.4, 1.6, 2.4, -3, 4.8, -1);
  K.box(9.2, 0.15, 1.3, 0, 2.6, 3.35);
  K.windows('z', 3.03, -4, -1.4, 1.5, 1.5, 3, 1, 1.1, 2.0);
  K.box(1.1, 2.4, 0.06, 0, 1.2, 3.03, 0, false);
  K.windows('z', 3.03, 1.4, 4, 1.5, 1.5, 3, 1, 1.1, 2.0);
  return built(K);
}

// ---------------------------------------------------------------------------
// D — APARTMENT BLOCK
// ---------------------------------------------------------------------------
function buildApartment() {
  const K = makeKit();
  const W = 9, D = 8, H = 16;
  K.box(W, H, D, 0, H / 2, 0);
  K.box(2.6, 2.0, 2.6, -2, H + 1, -1.5);
  K.cyl(1.1, 1.1, 1.6, 2.4, H + 0.8, 1.6, 8);
  K.box(4, 0.2, 1.4, 0, 3, D / 2 + 0.6);
  const y0 = 2.2, y1 = H - 1.4, rows = 5;
  K.windows('z',  D / 2 + 0.03, -3.2, 3.2, y0, y1, 4, rows, 1.0, 1.3);
  K.windows('z', -D / 2 - 0.03, -3.2, 3.2, y0, y1, 4, rows, 1.0, 1.3);
  K.windows('x',  W / 2 + 0.03, -2.6, 2.6, y0, y1, 3, rows, 1.0, 1.3);
  K.windows('x', -W / 2 - 0.03, -2.6, 2.6, y0, y1, 3, rows, 1.0, 1.3);
  return built(K);
}

// ---------------------------------------------------------------------------
// E — OFFICE TOWER
// ---------------------------------------------------------------------------
function buildTower() {
  const K = makeKit();
  K.box(10, 5, 10, 0, 2.5, 0);
  K.box(6.4, 20, 6.4, 0, 15, 0);
  K.box(4.2, 2.2, 4.2, 0, 26.1, 0);
  K.cyl(0.08, 0.08, 4, 0, 29.2, 0, 4);
  K.windows('z', 5.03, -3.5, 3.5, 2.5, 2.5, 4, 1, 1.4, 3.4);
  const ty0 = 6.5, ty1 = 24, rows = 7;
  for (const [ax, fc] of [['z', 3.23], ['z', -3.23], ['x', 3.23], ['x', -3.23]]) {
    K.windows(ax, fc, -2.4, 2.4, ty0, ty1, 4, rows, 0.9, 1.4);
  }
  return built(K);
}

// ---------------------------------------------------------------------------
// F — CHURCH
// ---------------------------------------------------------------------------
function buildChurch() {
  const K = makeKit();
  K.box(7, 5, 12, 0, 2.5, 0);
  K.gable(7, 3, 12, 0, 5, 0);
  K.box(3.6, 11, 3.6, 0, 5.5, 7.2);
  K.cone(2.7, 4, 0, 13, 7.2, 4);
  K.box(0.2, 1.4, 0.2, 0, 15.4, 7.2, 0, false);
  K.box(0.9, 0.2, 0.2, 0, 15.0, 7.2, 0, false);
  K.windows('x',  3.53, -4, 4, 3.0, 3.0, 4, 1, 0.7, 3.0);
  K.windows('x', -3.53, -4, 4, 3.0, 3.0, 4, 1, 0.7, 3.0);
  K.box(1.4, 2.6, 0.06, 0, 1.3, 9.03, 0, false);
  K.windows('z', 9.03, 0, 0, 8.5, 8.5, 1, 1, 1.4, 1.4);
  return built(K);
}

// ---------------------------------------------------------------------------
// G — WAREHOUSE (DAMAGED: collapsed roof bay + open loading door)
// ---------------------------------------------------------------------------
function buildWarehouse() {
  const K = makeKit();
  const W = 14, D = 9, H = 6, T = 0.4;
  const hw = W / 2, hd = D / 2;
  K.box(W, T, D, 0, T / 2, 0);
  K.box(W, H, T, 0, H / 2, -hd);
  K.box(T, H, D, -hw, H / 2, 0);
  K.box(T, H, D,  hw, H / 2, 0);
  K.box(4.5, H, T, -4.75, H / 2, hd);
  K.box(3.0, H, T,  5.0, H / 2, hd);
  K.box(3.0, 1.4, T, 0.2, H - 0.7, hd);
  K.gable(4.4, 1.6, D, -4.6, H, 0);
  K.gable(4.4, 1.6, D,  4.6, H, 0);
  K.box(1.4, 1.4, 1.4, -0.6, 0.7, -1.0);
  K.box(1.2, 1.0, 1.2,  1.0, 0.5,  0.6);
  K.box(T, 3.2, 3.0, 1.6, 1.6, -1.5);
  K.box(2.6, 0.7, 1.6, 0.2, 0.35, hd + 0.6);
  K.cyl(0.9, 1.0, 12, -5.5, 6, -2.5, 8);
  return built(K);
}

// ---------------------------------------------------------------------------
// H — WATER TOWER
// ---------------------------------------------------------------------------
function buildWaterTower() {
  const K = makeKit();
  const legR = 2.4, legH = 8, tilt = 0.14;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    K.strut(0.35, legH, 0.35, sx * legR, legH / 2, sz * legR, -sz * tilt, sx * tilt);
  }
  K.box(6.6, 0.2, 0.2, 0, 4, 2.4, 0, false);
  K.box(6.6, 0.2, 0.2, 0, 4, -2.4, 0, false);
  K.box(0.2, 0.2, 6.6, 2.4, 4, 0, 0, false);
  K.box(0.2, 0.2, 6.6, -2.4, 4, 0, 0, false);
  K.cyl(3, 3, 4, 0, 10, 0, 12);
  K.cone(3, 1.8, 0, 12.9, 0, 12);
  K.cone(3, 1.4, 0, 7.3, 0, 12);
  K.collider(5.0, 8, 5.0, 0, 4, 0);   // legs footprint blocks the ground
  return built(K);
}

// ---------------------------------------------------------------------------
// I — PARKING GARAGE
// ---------------------------------------------------------------------------
function buildGarage() {
  const K = makeKit();
  const W = 11, D = 9, decks = 3, deckH = 3.0;
  for (let d = 0; d <= decks; d++) {
    const y = d * deckH;
    K.box(W, 0.35, D, 0, y + 0.17, 0);
    if (d < decks) {
      K.box(W, 0.7, 0.15, 0, y + 1.0, D / 2);
      K.box(W, 0.7, 0.15, 0, y + 1.0, -D / 2);
      K.box(0.15, 0.7, D, W / 2, y + 1.0, 0);
      K.box(0.15, 0.7, D, -W / 2, y + 1.0, 0);
    }
  }
  for (const cx of [-4.5, 0, 4.5]) {
    for (const cz of [-3.5, 0, 3.5]) {
      for (let d = 0; d < decks; d++) K.box(0.5, deckH, 0.5, cx, d * deckH + deckH / 2, cz);
    }
  }
  K.strut(2.4, 0.3, 6, 4.3, deckH / 2, 0, 0.45, 0);
  return built(K);
}

// ---------------------------------------------------------------------------
// J — GRAIN SILOS
// ---------------------------------------------------------------------------
function buildSilos() {
  const K = makeKit();
  const silo = (x, h, r) => {
    K.cyl(r, r, h, x, h / 2, 0, 10);
    K.cone(r, r * 0.8, x, h + r * 0.4 - 0.1, 0, 10);
  };
  silo(-3.4, 12, 1.8);
  silo(0, 13, 1.8);
  silo(3.4, 10.5, 1.8);
  K.box(4.5, 3.4, 3.6, 6.4, 1.7, 0);
  K.gable(4.5, 1.2, 3.6, 6.4, 3.4, 0);
  K.strut(6.8, 0.5, 0.5, 3.3, 11, 1.6, 0, 0.35);
  return built(K);
}

// ---------------------------------------------------------------------------
// K — CIVIC HALL
// ---------------------------------------------------------------------------
function buildCivic() {
  const K = makeKit();
  K.box(11, 6, 8, 0, 3, 0);
  K.box(11.6, 0.4, 8.6, 0, 6.2, 0);
  for (let s = 0; s < 3; s++) K.box(9 - s * 0.8, 0.4, 1.0 - s * 0.2, 0, 0.2 + s * 0.4, 4.6 + s * 0.5);
  for (let i = -2.5; i <= 2.5; i++) K.cyl(0.4, 0.4, 4.6, i * 1.7, 2.3, 4.4, 8);
  K.box(9.6, 0.9, 1.3, 0, 5.05, 4.4);
  K.gable(9.6, 1.8, 1.3, 0, 5.5, 4.4);
  K.box(1.6, 3.4, 0.06, 0, 1.7, 3.03, 0, false);
  K.windows('x',  5.53, -2.4, 2.4, 3.4, 3.4, 3, 1, 0.9, 2.6);
  K.windows('x', -5.53, -2.4, 2.4, 3.4, 3.4, 3, 1, 0.9, 2.6);
  return built(K);
}

// ---------------------------------------------------------------------------
// L — BOMBED APARTMENT (DAMAGED: corner blown off, floors exposed)
// ---------------------------------------------------------------------------
function buildBombedApartment() {
  const K = makeKit();
  const W = 9, D = 8, storeys = 4, sh = 3.2, T = 0.4;
  const hw = W / 2, hd = D / 2, H = storeys * sh;
  K.box(W, T, D, 0, T / 2, 0);
  const corners = [[-hw, -hd], [hw, -hd], [-hw, hd]];
  for (const [cx, cz] of corners) K.box(0.5, H, 0.5, cx, H / 2, cz);
  K.box(W, H, T, 0, H / 2, -hd);
  K.box(T, H, D, -hw, H / 2, 0);
  K.windows('z', -hd - 0.03, -3, 3, 2.2, H - 1.2, 4, storeys, 1.0, 1.3);
  K.windows('x', -hw - 0.03, -2.6, 2.6, 2.2, H - 1.2, 3, storeys, 1.0, 1.3);
  K.box(4.0, sh * 2, T, -hw + 2.0, sh, hd);
  K.box(T, sh * 2, 4.0, hw, sh, -hd + 2.0);
  for (let s = 1; s <= storeys; s++) {
    const fy = s * sh;
    const frac = 1 - s * 0.15;
    const fw = W * frac, fd = D * frac;
    K.box(fw, 0.25, fd, -hw + fw / 2, fy, -hd + fd / 2);
    if (s % 2 === 1) K.box(T, sh * 0.7, 2.4, -1.5, fy + sh * 0.35, -1.0);
  }
  K.box(3.0, 1.0, 3.0, hw - 1.2, 0.5, hd - 1.2);
  K.box(1.6, 0.6, 1.4, hw + 0.6, 0.3, hd + 0.4);
  K.cone(1.2, 1.4, hw - 2.2, 0.7, hd - 0.4, 5);
  return built(K);
}

// ---------------------------------------------------------------------------
// M — GAS STATION  (canopy on posts over pump islands + kiosk)
// ---------------------------------------------------------------------------
function buildGasStation() {
  const K = makeKit();
  K.box(3.4, 3.0, 3.2, -3.4, 1.5, 0);              // kiosk
  K.gable(3.4, 0.8, 3.2, -3.4, 3.0, 0);            // kiosk roof
  K.windows('z', -3.4 + 1.63, -3.4, -3.4, 1.6, 1.6, 1, 1, 1.6, 1.4); // shop window
  // Forecourt canopy on four slim posts
  for (const [px, pz] of [[0.5, 1.8], [4.5, 1.8], [0.5, -1.8], [4.5, -1.8]]) {
    K.cyl(0.22, 0.22, 3.4, px, 1.7, pz, 6);
  }
  K.box(6.0, 0.5, 5.0, 2.5, 3.6, 0, 0, false);     // canopy slab (drive under)
  K.box(6.0, 0.4, 0.5, 2.5, 4.1, 2.5, 0, false);   // canopy fascia
  // Pump islands
  K.box(0.7, 1.2, 2.0, 1.6, 0.6, 0);
  K.box(0.7, 1.2, 2.0, 3.4, 0.6, 0);
  return built(K);
}

// ---------------------------------------------------------------------------
// N — STRIP MALL  (long low retail terrace with parapet + storefronts)
// ---------------------------------------------------------------------------
function buildStripMall() {
  const K = makeKit();
  const W = 16, D = 7, H = 4.5;
  K.box(W, H, D, 0, H / 2, 0);
  K.box(W, 0.8, 0.4, 0, H + 0.4, D / 2 - 0.2);     // parapet sign band
  // Four storefront bays: pilaster, glazing, door
  for (let b = -1.5; b <= 1.5; b++) {
    const bx = b * 3.7;
    K.box(0.4, H, 0.4, bx - 1.85, H / 2, D / 2);   // pilaster divider
    K.windows('z', D / 2 + 0.03, bx - 1.1, bx + 1.1, 1.6, 1.6, 2, 1, 1.0, 2.2);
    K.box(1.0, 2.2, 0.06, bx, 1.1, D / 2 + 0.03, 0, false);
  }
  K.box(0.4, H, 0.4, 7.85, H / 2, D / 2);
  K.box(2.2, 1.4, 2.0, -4, H + 0.7, -1);           // rooftop unit
  K.box(1.8, 1.2, 1.8,  4, H + 0.6, -1);
  return built(K);
}

// ---------------------------------------------------------------------------
// O — RESIDENTIAL HIGH-RISE  (point block with balcony bands)
// ---------------------------------------------------------------------------
function buildHighRise() {
  const K = makeKit();
  const W = 9, D = 9, H = 24;
  K.box(W, H, D, 0, H / 2, 0);
  K.box(W, 3, D * 0.5, 0, 1.5, D / 4);             // entrance podium wing
  K.box(3, 2.5, 3, 1.5, H + 1.25, -1.5);           // rooftop mechanical
  // Balcony bands every two storeys, front and back (thin — no collision)
  for (let y = 5; y < H - 1; y += 3.2) {
    K.box(W + 0.6, 0.25, 0.5, 0, y, D / 2 + 0.2, 0, false);
    K.box(W + 0.6, 0.25, 0.5, 0, y, -D / 2 - 0.2, 0, false);
  }
  const y0 = 2.5, y1 = H - 1.6, rows = 7;
  K.windows('z',  D / 2 + 0.04, -3.2, 3.2, y0, y1, 4, rows, 0.9, 1.2);
  K.windows('z', -D / 2 - 0.04, -3.2, 3.2, y0, y1, 4, rows, 0.9, 1.2);
  K.windows('x',  W / 2 + 0.04, -3.2, 3.2, y0, y1, 4, rows, 0.9, 1.2);
  K.windows('x', -W / 2 - 0.04, -3.2, 3.2, y0, y1, 4, rows, 0.9, 1.2);
  return built(K);
}

// ---------------------------------------------------------------------------
// P — FACTORY  (sawtooth-roofed shed + smokestack)
// ---------------------------------------------------------------------------
function buildFactory() {
  const K = makeKit();
  const W = 14, D = 10, H = 5;
  K.box(W, H, D, 0, H / 2, 0);
  // Sawtooth monitor roof — a row of small gables the length of the shed
  for (const rx of [-5.1, -1.7, 1.7, 5.1]) K.gable(3.4, 1.4, D, rx, H, 0);
  K.cyl(0.9, 1.0, 13, -5.6, 6.5, -3.2, 8);         // smokestack
  K.box(3.0, 3.4, 0.06, 3.5, 1.7, D / 2 + 0.03, 0, false); // roller door
  K.box(3.0, 3.4, 0.06, -3.5, 1.7, D / 2 + 0.03, 0, false);
  K.windows('z', D / 2 + 0.03, -1, 1, 3.2, 3.2, 2, 1, 1.2, 1.2);
  K.windows('x', W / 2 + 0.03, -3, 3, 3.2, 3.2, 3, 1, 1.0, 1.2);
  return built(K);
}

// ---------------------------------------------------------------------------
// Q — COOLING TOWER  (hyperboloid industrial landmark)
// ---------------------------------------------------------------------------
function buildCoolingTower() {
  const K = makeKit();
  // Stacked frusta narrowing to a waist then flaring — reads as a hyperboloid
  K.cyl(4.4, 4.6, 4.0, 0, 2.0, 0, 14);
  K.cyl(3.4, 4.4, 6.0, 0, 7.0, 0, 14);
  K.cyl(3.5, 3.4, 4.5, 0, 12.2, 0, 14);
  K.cyl(4.3, 3.5, 4.0, 0, 16.4, 0, 14);
  K.cyl(4.4, 4.3, 0.5, 0, 18.6, 0, 14);            // rim lip
  return built(K);
}

// ---------------------------------------------------------------------------
// R — SCHOOL  (two-storey teaching block + taller gym wing)
// ---------------------------------------------------------------------------
function buildSchool() {
  const K = makeKit();
  K.box(12, 6.4, 8, -2, 3.2, 0);                   // classroom block
  K.box(5, 8, 8, 6.5, 4, 0);                        // gym wing
  K.gable(5, 1.4, 8, 6.5, 8, 0);
  K.box(3.4, 0.2, 1.6, -2, 3.4, 4.6);              // entrance canopy
  K.box(1.4, 2.6, 0.06, -2, 1.3, 4.03, 0, false);  // doors
  // Banks of classroom windows, two floors
  K.windows('z', 4.03, -7.2, 3.2, 1.8, 1.8, 5, 1, 1.1, 1.4);
  K.windows('z', 4.03, -7.2, 3.2, 4.8, 4.8, 5, 1, 1.1, 1.4);
  K.windows('z', -4.03, -7.2, 3.2, 1.8, 4.8, 5, 2, 1.1, 1.3);
  K.box(0.12, 6, 0.12, -7.5, 3, 4.5, 0, false);    // flagpole
  return built(K);
}

// ---------------------------------------------------------------------------
// Registry — A … R (footprint w×d, height h, city zones, rural/damaged tags)
// ---------------------------------------------------------------------------

export const BUILDING_TEMPLATES = [
  { letter: 'A', name: 'TOWNHOUSE ROW',  build: buildTownhouseRow,   labelY: 9,  w: 9,    d: 6,  h: 8.6, zones: ['low'],         rural: false, damaged: false },
  { letter: 'B', name: 'SUBURBAN HOUSE', build: buildSuburbanHouse,  labelY: 7,  w: 9.5,  d: 6,  h: 5.6, zones: ['low'],         rural: true,  damaged: false },
  { letter: 'C', name: 'CORNER STORE',   build: buildStore,          labelY: 7,  w: 10,   d: 8,  h: 5.6, zones: ['low', 'mid'],  rural: false, damaged: false },
  { letter: 'D', name: 'APARTMENT BLOCK',build: buildApartment,      labelY: 20, w: 9,    d: 9,  h: 18,  zones: ['mid', 'core'], rural: false, damaged: false },
  { letter: 'E', name: 'OFFICE TOWER',   build: buildTower,          labelY: 34, w: 11,   d: 10, h: 31,  zones: ['core'],        rural: false, damaged: false },
  { letter: 'F', name: 'CHURCH',         build: buildChurch,         labelY: 18, w: 13,   d: 16, h: 16,  zones: ['low', 'mid'],  rural: true,  damaged: false },
  { letter: 'G', name: 'WAREHOUSE ✷ DAMAGED', build: buildWarehouse, labelY: 15, w: 14,   d: 11, h: 12,  zones: ['ind', 'low'],  rural: true,  damaged: true  },
  { letter: 'H', name: 'WATER TOWER',    build: buildWaterTower,     labelY: 16, w: 7,    d: 7,  h: 14,  zones: ['ind'],         rural: true,  damaged: false },
  { letter: 'I', name: 'PARKING GARAGE', build: buildGarage,         labelY: 11, w: 11,   d: 9,  h: 9,   zones: ['mid', 'ind'],  rural: false, damaged: false },
  { letter: 'J', name: 'GRAIN SILOS',    build: buildSilos,          labelY: 16, w: 14,   d: 4,  h: 14,  zones: ['ind'],         rural: true,  damaged: false },
  { letter: 'K', name: 'CIVIC HALL',     build: buildCivic,          labelY: 9,  w: 12,   d: 10, h: 7,   zones: ['mid', 'core'], rural: false, damaged: false },
  { letter: 'L', name: 'BOMBED APARTMENT ✷ DAMAGED', build: buildBombedApartment, labelY: 15, w: 11, d: 9, h: 13, zones: ['mid'], rural: false, damaged: true },
  { letter: 'M', name: 'GAS STATION',    build: buildGasStation,     labelY: 6,  w: 10,   d: 5,  h: 4.5, zones: ['low'],         rural: true,  damaged: false },
  { letter: 'N', name: 'STRIP MALL',     build: buildStripMall,      labelY: 7,  w: 16,   d: 7,  h: 5.5, zones: ['low', 'mid'],  rural: false, damaged: false },
  { letter: 'O', name: 'RESIDENTIAL HIGH-RISE', build: buildHighRise,labelY: 30, w: 9,    d: 9,  h: 27,  zones: ['core'],        rural: false, damaged: false },
  { letter: 'P', name: 'FACTORY',        build: buildFactory,        labelY: 16, w: 14,   d: 10, h: 13,  zones: ['ind'],         rural: true,  damaged: false },
  { letter: 'Q', name: 'COOLING TOWER',  build: buildCoolingTower,   labelY: 22, w: 9.2,  d: 9.2,h: 19,  zones: ['ind'],         rural: false, damaged: false },
  { letter: 'R', name: 'SCHOOL',         build: buildSchool,         labelY: 11, w: 16,   d: 8,  h: 9.4, zones: ['mid', 'low'],  rural: false, damaged: false },
];

/** Templates keyed by their letter, for O(1) lookup during world generation. */
export const BUILDING_BY_LETTER = Object.fromEntries(BUILDING_TEMPLATES.map(t => [t.letter, t]));
