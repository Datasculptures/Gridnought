import * as THREE from 'three';
import { OBSTACLES } from '../utils/constants.js';

/**
 * BUILDING TEMPLATE LIBRARY
 *
 * A gallery of hand-modelled, simplified-but-recognisable buildings for
 * evaluation in Area X. Each entry renders in the standard battlefield style
 * — black solid fill under a bright-green edge wireframe — so a template that
 * gets chosen drops straight into the world with the right look.
 *
 * Every builder returns { group, mats, geos } (the same shape as the Area X
 * concept models) so HowToPage can place and dispose them uniformly.
 *
 * Templates are deliberately independent of the chunk/Obstacle generator: the
 * point is to look at them first and pick winners, then wire the good ones in.
 */

const WIRE = OBSTACLES.color; // 0x00ff00 — matches in-world obstacle edges

// ---------------------------------------------------------------------------
// Construction kit
// ---------------------------------------------------------------------------

/**
 * A per-building kit sharing one black fill material and one green line
 * material. Each primitive adds a solid mesh plus an EdgesGeometry outline,
 * tracking every geometry so the whole building tears down cleanly.
 */
function makeKit() {
  const S = new THREE.MeshBasicMaterial({
    color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const W = new THREE.LineBasicMaterial({ color: WIRE });
  const group = new THREE.Group();
  const geos = [];

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

  const box  = (w, h, d, x, y, z, ry = 0) => place(new THREE.BoxGeometry(w, h, d), x, y, z, ry);
  const cyl  = (rt, rb, h, x, y, z, seg = 8, ry = 0) =>
    place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, ry);
  const cone = (r, h, x, y, z, seg = 4, ry = 0) =>
    place(new THREE.ConeGeometry(r, h, seg), x, y, z, ry);
  const gable = (w, h, d, x, y, z, ry = 0) => place(gableGeo(w, h, d), x, y, z, ry);

  /**
   * A grid of window panes on one flat facade. Each pane is a wafer-thin box
   * standing just proud of the wall, so its outline reads as a green window.
   *   axis 'z' → facade faces ±Z, panes span X (a) and Y
   *   axis 'x' → facade faces ±X, panes span Z (a) and Y
   */
  const windows = (axis, faceCoord, a0, a1, y0, y1, cols, rows, ww = 1.0, wh = 1.3) => {
    const t = 0.05;
    for (let c = 0; c < cols; c++) {
      const a = cols === 1 ? (a0 + a1) / 2 : a0 + (a1 - a0) * (c / (cols - 1));
      for (let r = 0; r < rows; r++) {
        const y = rows === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * (r / (rows - 1));
        if (axis === 'z') box(ww, wh, t, faceCoord === 0 ? 0 : faceCoord, y, a);
        else box(t, wh, ww, faceCoord, y, a);
      }
    }
  };

  return { S, W, group, geos, box, cyl, cone, gable, windows };
}

/** Triangular-prism gable roof: eaves at local y=0, ridge along Z at y=h. */
function gableGeo(w, h, d) {
  const hw = w / 2, hd = d / 2;
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
  const E = [0, h, -hd], F = [0, h, hd];
  const tri = (p, q, r) => [...p, ...q, ...r];
  const verts = new Float32Array([
    ...tri(A, B, E),                    // front gable
    ...tri(C, D, F),                    // back gable
    ...tri(A, E, F), ...tri(A, F, D),   // left slope
    ...tri(B, C, F), ...tri(B, F, E),   // right slope
    ...tri(A, D, C), ...tri(A, C, B),   // underside
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

function built(kit) {
  return { group: kit.group, mats: [kit.S, kit.W], geos: kit.geos };
}

// ---------------------------------------------------------------------------
// A — TOWNHOUSE ROW  (three attached units, two storeys, gabled)
// ---------------------------------------------------------------------------
function buildTownhouseRow() {
  const K = makeKit();
  const unitW = 3, depth = 6, wallH = 6.4;
  K.box(unitW * 3, wallH, depth, 0, wallH / 2, 0);           // terrace block
  for (let i = -1; i <= 1; i++) {
    const ux = i * unitW;
    K.gable(unitW, 1.7, depth, ux, wallH, 0);                // per-unit roof
    if (i !== 0) K.box(0.5, 1.3, 0.5, ux + 0.9, wallH + 1.5, -1.4); // chimney
    // Front door + windows for each unit (front = +Z)
    K.box(0.9, 2.0, 0.06, ux, 1.0, depth / 2 + 0.03);        // door
    K.windows('z', depth / 2 + 0.03, ux - 0.7, ux + 0.7, 2.2, 2.2, 1, 1, 0.9, 1.0); // over door
    K.windows('z', depth / 2 + 0.03, ux, ux, 4.6, 4.6, 1, 1, 0.9, 1.1);             // upper
  }
  return built(K);
}

// ---------------------------------------------------------------------------
// B — SUBURBAN HOUSE  (single storey, gable roof, attached garage — L-plan)
// ---------------------------------------------------------------------------
function buildSuburbanHouse() {
  const K = makeKit();
  K.box(6, 3.4, 6, 0, 1.7, 0);            // house body
  K.gable(6, 2.2, 6, 0, 3.4, 0);          // roof
  K.box(0.5, 1.1, 0.5, 1.6, 4.5, -1.4);   // chimney
  // Garage wing
  K.box(3.6, 2.8, 4.2, 4.6, 1.4, -0.9);
  K.gable(3.6, 1.1, 4.2, 4.6, 2.8, -0.9);
  K.box(2.7, 2.0, 0.06, 4.6, 1.0, 1.24);  // garage door (front)
  // House door + windows (front = +Z)
  K.box(0.9, 1.9, 0.06, -1.6, 0.95, 3.03);
  K.windows('z', 3.03, 0.4, 1.8, 1.6, 1.6, 2, 1, 1.0, 1.1);
  K.windows('x', -3.03, -1.5, 1.5, 1.7, 1.7, 2, 1, 1.1, 1.1); // side windows
  return built(K);
}

// ---------------------------------------------------------------------------
// C — CORNER STORE  (wide, low, flat roof, display windows, awning, signband)
// ---------------------------------------------------------------------------
function buildStore() {
  const K = makeKit();
  K.box(10, 4, 6, 0, 2, 0);                       // shell
  K.box(9.4, 1.0, 0.3, 0, 4.6, 2.6);              // roof sign band (front)
  K.box(2.4, 1.6, 2.4, -3, 4.8, -1);              // rooftop plant
  K.box(9.2, 0.15, 1.3, 0, 2.6, 3.35);            // awning
  // Big display windows + door across the front (front = +Z)
  K.windows('z', 3.03, -4, -1.4, 1.5, 1.5, 3, 1, 1.1, 2.0);
  K.box(1.1, 2.4, 0.06, 0, 1.2, 3.03);            // entrance
  K.windows('z', 3.03, 1.4, 4, 1.5, 1.5, 3, 1, 1.1, 2.0);
  return built(K);
}

// ---------------------------------------------------------------------------
// D — APARTMENT BLOCK  (five-storey slab, window grid, rooftop plant)
// ---------------------------------------------------------------------------
function buildApartment() {
  const K = makeKit();
  const W = 9, D = 8, H = 16;
  K.box(W, H, D, 0, H / 2, 0);
  K.box(2.6, 2.0, 2.6, -2, H + 1, -1.5);          // stair bulkhead
  K.cyl(1.1, 1.1, 1.6, 2.4, H + 0.8, 1.6, 8);     // water tank
  K.box(4, 0.2, 1.4, 0, 3, D / 2 + 0.6);          // entrance canopy
  // Window grids: five floors, spaced up the facade
  const y0 = 2.2, y1 = H - 1.4, rows = 5;
  K.windows('z',  D / 2 + 0.03, -3.2, 3.2, y0, y1, 4, rows, 1.0, 1.3); // front
  K.windows('z', -D / 2 - 0.03, -3.2, 3.2, y0, y1, 4, rows, 1.0, 1.3); // back
  K.windows('x',  W / 2 + 0.03, -2.6, 2.6, y0, y1, 3, rows, 1.0, 1.3); // right
  K.windows('x', -W / 2 - 0.03, -2.6, 2.6, y0, y1, 3, rows, 1.0, 1.3); // left
  return built(K);
}

// ---------------------------------------------------------------------------
// E — OFFICE TOWER  (podium + setback tower + crown + antenna)
// ---------------------------------------------------------------------------
function buildTower() {
  const K = makeKit();
  K.box(10, 5, 10, 0, 2.5, 0);                     // podium
  K.box(6.4, 20, 6.4, 0, 15, 0);                   // tower
  K.box(4.2, 2.2, 4.2, 0, 26.1, 0);                // crown / plant
  K.cyl(0.08, 0.08, 4, 0, 29.2, 0, 4);             // antenna mast
  // Podium storefront glazing + tower window bands (all four faces)
  K.windows('z', 5.03, -3.5, 3.5, 2.5, 2.5, 4, 1, 1.4, 3.4);
  const ty0 = 6.5, ty1 = 24, rows = 7;
  for (const [ax, fc] of [['z', 3.23], ['z', -3.23], ['x', 3.23], ['x', -3.23]]) {
    K.windows(ax, fc, -2.4, 2.4, ty0, ty1, 4, rows, 0.9, 1.4);
  }
  return built(K);
}

// ---------------------------------------------------------------------------
// F — CHURCH  (nave with gabled roof, bell tower, spire, cross)
// ---------------------------------------------------------------------------
function buildChurch() {
  const K = makeKit();
  K.box(7, 5, 12, 0, 2.5, 0);                      // nave
  K.gable(7, 3, 12, 0, 5, 0);                      // roof
  // Bell tower at the front (front = +Z)
  K.box(3.6, 11, 3.6, 0, 5.5, 7.2);
  K.cone(2.7, 4, 0, 13, 7.2, 4);                   // spire
  K.box(0.2, 1.4, 0.2, 0, 15.4, 7.2);              // cross (vertical)
  K.box(0.9, 0.2, 0.2, 0, 15.0, 7.2);              // cross (arms)
  // Tall arched-style windows down the nave sides
  K.windows('x',  3.53, -4, 4, 3.0, 3.0, 4, 1, 0.7, 3.0);
  K.windows('x', -3.53, -4, 4, 3.0, 3.0, 4, 1, 0.7, 3.0);
  K.box(1.4, 2.6, 0.06, 0, 1.3, 9.03);             // tower doors
  K.windows('z', 9.03, 0, 0, 8.5, 8.5, 1, 1, 1.4, 1.4); // belfry opening
  return built(K);
}

// ---------------------------------------------------------------------------
// G — WAREHOUSE  (long shed, DAMAGED: collapsed roof bay + open loading door)
// ---------------------------------------------------------------------------
function buildWarehouse() {
  const K = makeKit();
  const W = 14, D = 9, H = 6, T = 0.4;
  const hw = W / 2, hd = D / 2;
  K.box(W, T, D, 0, T / 2, 0);                     // floor slab
  K.box(W, H, T, 0, H / 2, -hd);                   // back wall (intact)
  K.box(T, H, D, -hw, H / 2, 0);                   // left wall
  K.box(T, H, D,  hw, H / 2, 0);                   // right wall
  // Front wall in segments with a blown-open loading bay in the middle
  K.box(4.5, H, T, -4.75, H / 2, hd);              // left front pier
  K.box(3.0, H, T,  5.0, H / 2, hd);               // right front pier
  K.box(3.0, 1.4, T, 0.2, H - 0.7, hd);            // lintel over the open bay
  // Sawtooth monitor roof — two ribs, with the middle rib collapsed (gap)
  K.gable(4.4, 1.6, D, -4.6, H, 0);
  K.gable(4.4, 1.6, D,  4.6, H, 0);                // middle 4.4-wide bay left open
  // Interior visible through the bay: crates + a leaning partition
  K.box(1.4, 1.4, 1.4, -0.6, 0.7, -1.0);
  K.box(1.2, 1.0, 1.2,  1.0, 0.5,  0.6);
  K.box(T, 3.2, 3.0, 1.6, 1.6, -1.5);              // interior partition stub
  // Rubble spilling from the doorway
  K.box(2.6, 0.7, 1.6, 0.2, 0.35, hd + 0.6);
  K.cyl(0.9, 1.0, 12, -5.5, 6, -2.5, 8);           // smokestack
  return built(K);
}

// ---------------------------------------------------------------------------
// H — WATER TOWER  (raised tank on splayed legs — a landmark)
// ---------------------------------------------------------------------------
function buildWaterTower() {
  const K = makeKit();
  const legR = 2.4, legH = 8, tilt = 0.14;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const g = new THREE.BoxGeometry(0.35, legH, 0.35);
    K.geos.push(g);
    const solid = new THREE.Mesh(g, K.S);
    const edges = new THREE.EdgesGeometry(g); K.geos.push(edges);
    const line = new THREE.LineSegments(edges, K.W);
    for (const m of [solid, line]) {
      m.position.set(sx * legR, legH / 2, sz * legR);
      m.rotation.x = -sz * tilt;
      m.rotation.z =  sx * tilt;
      K.group.add(m);
    }
  }
  // Cross bracing
  K.box(6.6, 0.2, 0.2, 0, 4, 2.4);
  K.box(6.6, 0.2, 0.2, 0, 4, -2.4);
  K.box(0.2, 0.2, 6.6, 2.4, 4, 0);
  K.box(0.2, 0.2, 6.6, -2.4, 4, 0);
  // Tank + domed top and bottom
  K.cyl(3, 3, 4, 0, 10, 0, 12);
  K.cone(3, 1.8, 0, 12.9, 0, 12);
  K.cone(3, 1.4, 0, 7.3, 0, 12);                   // (points up; reads as a taper)
  return built(K);
}

// ---------------------------------------------------------------------------
// I — PARKING GARAGE  (open multi-deck: slabs, columns, spandrels, ramp)
// ---------------------------------------------------------------------------
function buildGarage() {
  const K = makeKit();
  const W = 11, D = 9, decks = 3, deckH = 3.0;
  for (let d = 0; d <= decks; d++) {
    const y = d * deckH;
    K.box(W, 0.35, D, 0, y + 0.17, 0);             // deck slab
    if (d < decks) {
      // Perimeter spandrel rail on each open floor
      K.box(W, 0.7, 0.15, 0, y + 1.0, D / 2);
      K.box(W, 0.7, 0.15, 0, y + 1.0, -D / 2);
      K.box(0.15, 0.7, D, W / 2, y + 1.0, 0);
      K.box(0.15, 0.7, D, -W / 2, y + 1.0, 0);
    }
  }
  // Columns on a 3×3 grid
  for (const cx of [-4.5, 0, 4.5]) {
    for (const cz of [-3.5, 0, 3.5]) {
      for (let d = 0; d < decks; d++) K.box(0.5, deckH, 0.5, cx, d * deckH + deckH / 2, cz);
    }
  }
  // Up-ramp on one side
  const ramp = new THREE.BoxGeometry(2.4, 0.3, 6);
  K.geos.push(ramp);
  const rs = new THREE.Mesh(ramp, K.S);
  const re = new THREE.EdgesGeometry(ramp); K.geos.push(re);
  const rl = new THREE.LineSegments(re, K.W);
  for (const m of [rs, rl]) { m.position.set(4.3, deckH / 2, 0); m.rotation.x = 0.45; K.group.add(m); }
  return built(K);
}

// ---------------------------------------------------------------------------
// J — GRAIN SILOS  (cylinder cluster with domed caps + machine shed)
// ---------------------------------------------------------------------------
function buildSilos() {
  const K = makeKit();
  const silo = (x, h, r) => {
    K.cyl(r, r, h, x, h / 2, 0, 10);
    K.cone(r, r * 0.8, x, h + r * 0.4 - 0.1, 0, 10);   // domed cap
  };
  silo(-3.4, 12, 1.8);
  silo(0, 13, 1.8);
  silo(3.4, 10.5, 1.8);
  // Machine shed alongside
  K.box(4.5, 3.4, 3.6, 6.4, 1.7, 0);
  K.gable(4.5, 1.2, 3.6, 6.4, 3.4, 0);
  // Elevated conveyor from shed to the tall silo
  const conv = new THREE.BoxGeometry(6.8, 0.5, 0.5);
  K.geos.push(conv);
  const cs = new THREE.Mesh(conv, K.S);
  const ce = new THREE.EdgesGeometry(conv); K.geos.push(ce);
  const cl = new THREE.LineSegments(ce, K.W);
  for (const m of [cs, cl]) { m.position.set(3.3, 11, 1.6); m.rotation.z = 0.35; K.group.add(m); }
  return built(K);
}

// ---------------------------------------------------------------------------
// K — CIVIC HALL  (columned portico + pediment + steps — bank / courthouse)
// ---------------------------------------------------------------------------
function buildCivic() {
  const K = makeKit();
  K.box(11, 6, 8, 0, 3, 0);                        // main mass
  K.box(11.6, 0.4, 8.6, 0, 6.2, 0);               // cornice cap
  // Steps up to the portico (front = +Z)
  for (let s = 0; s < 3; s++) K.box(9 - s * 0.8, 0.4, 1.0 - s * 0.2, 0, 0.2 + s * 0.4, 4.6 + s * 0.5);
  // Portico: six columns + entablature + pediment
  for (let i = -2.5; i <= 2.5; i++) K.cyl(0.4, 0.4, 4.6, i * 1.7, 2.3, 4.4, 8);
  K.box(9.6, 0.9, 1.3, 0, 5.05, 4.4);              // entablature
  K.gable(9.6, 1.8, 1.3, 0, 5.5, 4.4);            // pediment (faces front)
  K.box(1.6, 3.4, 0.06, 0, 1.7, 3.03);            // grand door
  K.windows('x',  5.53, -2.4, 2.4, 3.4, 3.4, 3, 1, 0.9, 2.6); // side windows
  K.windows('x', -5.53, -2.4, 2.4, 3.4, 3.4, 3, 1, 0.9, 2.6);
  return built(K);
}

// ---------------------------------------------------------------------------
// L — BOMBED APARTMENT  (shelled mid-rise: corner blown off, floors exposed)
// ---------------------------------------------------------------------------
function buildBombedApartment() {
  const K = makeKit();
  const W = 9, D = 8, storeys = 4, sh = 3.2, T = 0.4;
  const hw = W / 2, hd = D / 2, H = storeys * sh;

  K.box(W, T, D, 0, T / 2, 0);                     // ground slab

  // Perimeter columns at three corners; the +X/+Z corner is gone (blown off)
  const corners = [[-hw, -hd], [hw, -hd], [-hw, hd]];
  for (const [cx, cz] of corners) K.box(0.5, H, 0.5, cx, H / 2, cz);

  // Exterior walls, ragged: full on the intact sides, stubs near the blast
  K.box(W, H, T, 0, H / 2, -hd);                   // back wall (intact)
  K.box(T, H, D, -hw, H / 2, 0);                   // left wall (intact)
  K.windows('z', -hd - 0.03, -3, 3, 2.2, H - 1.2, 4, storeys, 1.0, 1.3);
  K.windows('x', -hw - 0.03, -2.6, 2.6, 2.2, H - 1.2, 3, storeys, 1.0, 1.3);
  // Front + right walls survive only on the lower floors near the good corner
  K.box(4.0, sh * 2, T, -hw + 2.0, sh, hd);        // front wall stub (2 floors)
  K.box(T, sh * 2, 4.0, hw, sh, -hd + 2.0);        // right wall stub (2 floors)

  // Interior floor slabs at each storey — near corner intact, far corner
  // sheared away so you can see straight in and walk up through the wreck
  for (let s = 1; s <= storeys; s++) {
    const fy = s * sh;
    const frac = 1 - s * 0.15;                     // higher floors lost more
    const fw = W * frac, fd = D * frac;
    K.box(fw, 0.25, fd, -hw + fw / 2, fy, -hd + fd / 2);
    // A hanging partition stub on some floors
    if (s % 2 === 1) K.box(T, sh * 0.7, 2.4, -1.5, fy + sh * 0.35, -1.0);
  }

  // Rubble pile spilling out of the destroyed corner
  K.box(3.0, 1.0, 3.0, hw - 1.2, 0.5, hd - 1.2);
  K.box(1.6, 0.6, 1.4, hw + 0.6, 0.3, hd + 0.4);
  K.cone(1.2, 1.4, hw - 2.2, 0.7, hd - 0.4, 5);    // collapsed slab shard
  return built(K);
}

// ---------------------------------------------------------------------------
// Registry — evaluation order A … L
// ---------------------------------------------------------------------------

export const BUILDING_TEMPLATES = [
  { letter: 'A', name: 'TOWNHOUSE ROW',    build: buildTownhouseRow,    labelY: 9  },
  { letter: 'B', name: 'SUBURBAN HOUSE',   build: buildSuburbanHouse,   labelY: 7  },
  { letter: 'C', name: 'CORNER STORE',     build: buildStore,           labelY: 7  },
  { letter: 'D', name: 'APARTMENT BLOCK',  build: buildApartment,       labelY: 20 },
  { letter: 'E', name: 'OFFICE TOWER',     build: buildTower,           labelY: 34 },
  { letter: 'F', name: 'CHURCH',           build: buildChurch,          labelY: 18 },
  { letter: 'G', name: 'WAREHOUSE ✷ DAMAGED', build: buildWarehouse,    labelY: 15 },
  { letter: 'H', name: 'WATER TOWER',      build: buildWaterTower,      labelY: 16 },
  { letter: 'I', name: 'PARKING GARAGE',   build: buildGarage,          labelY: 11 },
  { letter: 'J', name: 'GRAIN SILOS',      build: buildSilos,           labelY: 16 },
  { letter: 'K', name: 'CIVIC HALL',       build: buildCivic,           labelY: 9  },
  { letter: 'L', name: 'BOMBED APARTMENT ✷ DAMAGED', build: buildBombedApartment, labelY: 15 },
];
