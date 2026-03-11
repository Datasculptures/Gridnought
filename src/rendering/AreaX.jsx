import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';

// ---------------------------------------------------------------------------
// Labels for every projected item — order must match entities[] in the effect.
// header:true items render in yellow with bold text.
// ---------------------------------------------------------------------------
const ALL_LABELS = [
  // ── Entities (6) ──────────────────────────────────────────────────────────
  { label: 'PLAYER TANK', header: false },
  { label: 'ENEMY TANK',  header: false },
  { label: 'DRONE',       header: false },
  { label: 'PROJECTILE',  header: false },
  { label: 'LAND MINE',   header: false },
  { label: 'INFANTRY',    header: false },
  // ── Weight-class section headers (3) ──────────────────────────────────────
  { label: '── LIGHT ──',  header: true },
  { label: '── MEDIUM ──', header: true },
  { label: '── HEAVY ──',  header: true },
  // ── Tank designs (12, light → medium → heavy) ─────────────────────────────
  { label: 'SWIFT',      header: false },
  { label: 'LYNX',       header: false },
  { label: 'PHANTOM',    header: false },
  { label: 'GECKO',      header: false },
  { label: 'IRON CROSS', header: false },
  { label: 'RONIN',      header: false },
  { label: 'VANDAL',     header: false },
  { label: 'WRAITH',     header: false },
  { label: 'GOLIATH',    header: false },
  { label: 'KREMLIN',    header: false },
  { label: 'MAMMOTH',    header: false },
  { label: 'LEVIATHAN',  header: false },
];

// ---------------------------------------------------------------------------
// Mesh builder helpers
// ---------------------------------------------------------------------------

function makeSolidMat() {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function buildTank(scene, color, x, z, heading) {
  const wire  = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  const hullGeo = new THREE.BoxGeometry(2.4, 1.0, 3.6);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.5;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.5;

  const turGeo = new THREE.BoxGeometry(1.6, 0.7, 1.8);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 0.85;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 0.85;

  const barGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.0, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 0.3, 2.4);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 0.3, 2.4);

  g.add(h1, h2, t1, t2, b1, b2);
  g.position.set(x, 0, z);
  g.rotation.y = heading ?? 0;
  scene.add(g);

  return { group: g, worldPos: new THREE.Vector3(x, 2.6, z) };
}

function buildDrone(scene, x, y, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: COLORS.terrain, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(0.9, 0.3, 1.8);
  g.add(new THREE.Mesh(bodyGeo, solid), new THREE.Mesh(bodyGeo, wire));

  const wingGeo = new THREE.BoxGeometry(10.0, 0.12, 0.7);
  g.add(new THREE.Mesh(wingGeo, solid), new THREE.Mesh(wingGeo, wire));

  const tailH = new THREE.Group();
  tailH.position.set(0, 0, -0.85);
  const thGeo = new THREE.BoxGeometry(3.0, 0.10, 0.45);
  tailH.add(new THREE.Mesh(thGeo, solid), new THREE.Mesh(thGeo, wire));
  g.add(tailH);

  const tailV = new THREE.Group();
  tailV.position.set(0, 0.35, -0.85);
  const tvGeo = new THREE.BoxGeometry(0.10, 0.7, 0.5);
  tailV.add(new THREE.Mesh(tvGeo, solid), new THREE.Mesh(tvGeo, wire));
  g.add(tailV);

  g.position.set(x, y, z);
  scene.add(g);

  return { group: g, worldPos: new THREE.Vector3(x, y + 1.2, z) };
}

function buildProjectile(scene, x, y, z) {
  const wire = new THREE.MeshBasicMaterial({ color: COLORS.projectile, wireframe: true });
  const geo  = new THREE.SphereGeometry(0.35, 8, 6);
  const g    = new THREE.Group();
  g.add(new THREE.Mesh(geo, wire));
  g.position.set(x, y, z);
  scene.add(g);

  return { group: g, worldPos: new THREE.Vector3(x, y + 1.2, z) };
}

function buildMine(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0xff2222, wireframe: true });
  const solid = new THREE.MeshBasicMaterial({
    color: 0x440000,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const geo = new THREE.SphereGeometry(0.5, 6, 4);
  const m1  = new THREE.Mesh(geo, solid); m1.position.y = 0.5;
  const m2  = new THREE.Mesh(geo, wire);  m2.position.y = 0.5;
  const g   = new THREE.Group();
  g.add(m1, m2);
  g.position.set(x, 0, z);
  scene.add(g);

  return { group: g, worldPos: new THREE.Vector3(x, 2.0, z) };
}

function buildInfantry(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: COLORS.enemyTank, wireframe: true });
  const solid = makeSolidMat();
  const geo   = new THREE.BoxGeometry(0.4, 0.9, 0.3);
  const m1    = new THREE.Mesh(geo, solid); m1.position.y = 0.45;
  const m2    = new THREE.Mesh(geo, wire);  m2.position.y = 0.45;
  const g     = new THREE.Group();
  g.add(m1, m2);
  g.position.set(x, 0, z);
  scene.add(g);

  return { group: g, worldPos: new THREE.Vector3(x, 2.0, z) };
}

// ---------------------------------------------------------------------------
// Light tank mesh builders
// ---------------------------------------------------------------------------

/**
 * SWIFT — BT-7 / T-70 inspired.
 * Narrow low hull, small turret offset to the right, thin short barrel.
 * Fastest silhouette in the light class.
 */
function buildSwift(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Hull: narrow (1.8 w) and low (0.7 h)
  const hullGeo = new THREE.BoxGeometry(1.8, 0.7, 3.0);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.35;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.35;
  g.add(h1, h2);

  // Small turret, shifted +0.3 to the right
  const turGeo = new THREE.BoxGeometry(1.0, 0.5, 1.2);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.set(0.3, 0.95, 0);
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.set(0.3, 0.95, 0);
  g.add(t1, t2);

  // Thin short barrel
  const barGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  // centre: x matches turret offset, z = turret front (0.6) + half barrel (1.1)
  b1.rotation.x = Math.PI / 2; b1.position.set(0.3, 0.95, 1.7);
  b2.rotation.x = Math.PI / 2; b2.position.set(0.3, 0.95, 1.7);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 2.0, z) };
}

/**
 * LYNX — AMX-13 inspired.
 * Two-part "oscillating" turret (lower ring + upper wedge), long barrel,
 * autoloader drum box at the rear.
 */
function buildLynx(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Compact hull
  const hullGeo = new THREE.BoxGeometry(2.0, 0.7, 3.2);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.35;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.35;
  g.add(h1, h2);

  // Lower turret ring
  const lrGeo = new THREE.BoxGeometry(1.4, 0.35, 1.6);
  const lr1 = new THREE.Mesh(lrGeo, solid); lr1.position.set(0, 0.875, 0);
  const lr2 = new THREE.Mesh(lrGeo, wire);  lr2.position.set(0, 0.875, 0);
  g.add(lr1, lr2);

  // Upper turret — slightly forward-biased to read as front-heavy
  const utGeo = new THREE.BoxGeometry(1.2, 0.4, 1.4);
  const ut1 = new THREE.Mesh(utGeo, solid); ut1.position.set(0, 1.25, 0.1);
  const ut2 = new THREE.Mesh(utGeo, wire);  ut2.position.set(0, 1.25, 0.1);
  g.add(ut1, ut2);

  // Autoloader drum at rear of upper turret
  const adGeo = new THREE.BoxGeometry(0.8, 0.35, 0.5);
  const ad1 = new THREE.Mesh(adGeo, solid); ad1.position.set(0, 1.25, -0.85);
  const ad2 = new THREE.Mesh(adGeo, wire);  ad2.position.set(0, 1.25, -0.85);
  g.add(ad1, ad2);

  // Long thin barrel — from front of upper turret (0.1+0.7=0.8), half-length 1.75
  const barGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.5, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 1.35, 2.55);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 1.35, 2.55);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 2.4, z) };
}

/**
 * PHANTOM — M8 Greyhound / Stalker inspired.
 * Wide flat hull, turret nearly flush with hull top, short wide barrel.
 * Lowest profile of all designs.
 */
function buildPhantom(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Wide flat hull
  const hullGeo = new THREE.BoxGeometry(3.0, 0.5, 3.2);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.25;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.25;
  g.add(h1, h2);

  // Low wide turret, almost flush with hull top
  const turGeo = new THREE.BoxGeometry(1.6, 0.35, 1.4);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 0.675;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 0.675;
  g.add(t1, t2);

  // Short wide barrel (6-sided for a chunkier look)
  const barGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  // z = turret front (0.7) + half barrel (0.9) = 1.6
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 0.675, 1.6);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 0.675, 1.6);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 1.8, z) };
}

/**
 * GECKO — Type 62 inspired.
 * Narrow elongated hull, long thin turret, fuel/ammo canister boxes on hull sides.
 */
function buildGecko(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Narrow elongated hull
  const hullGeo = new THREE.BoxGeometry(1.8, 0.8, 4.0);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.4;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.4;
  g.add(h1, h2);

  // Long narrow turret
  const turGeo = new THREE.BoxGeometry(1.2, 0.6, 2.0);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 1.1;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 1.1;
  g.add(t1, t2);

  // Long thin barrel — z = turret front (1.0) + half barrel (1.6) = 2.6
  const barGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 1.1, 2.6);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 1.1, 2.6);
  g.add(b1, b2);

  // Side canister boxes — 2 per side at different Z positions
  // x: ±(hull half-width 0.9 + box half-width 0.15) = ±1.05
  const boxGeo = new THREE.BoxGeometry(0.3, 0.35, 0.6);
  for (const sx of [-1.05, 1.05]) {
    for (const bz of [-0.8, 0.8]) {
      const bx1 = new THREE.Mesh(boxGeo, solid); bx1.position.set(sx, 0.4, bz);
      const bx2 = new THREE.Mesh(boxGeo, wire);  bx2.position.set(sx, 0.4, bz);
      g.add(bx1, bx2);
    }
  }

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 2.2, z) };
}

// ---------------------------------------------------------------------------
// Medium tank mesh builders
// ---------------------------------------------------------------------------

/**
 * IRON CROSS — Panzer IV inspired.
 * Wide boxy hull with vertical sides, large rectangular turret, prominent
 * mantlet box, tapered barrel with muzzle-brake ring at the tip.
 */
function buildIronCross(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Wide boxy hull — taller and longer than standard
  const hullGeo = new THREE.BoxGeometry(2.6, 1.0, 4.2);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.5;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.5;
  g.add(h1, h2);

  // Large rectangular turret
  const turGeo = new THREE.BoxGeometry(2.0, 0.75, 2.2);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 1.375;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 1.375;
  g.add(t1, t2);

  // Visible mantlet box on turret front
  const manGeo = new THREE.BoxGeometry(0.7, 0.65, 0.3);
  const m1 = new THREE.Mesh(manGeo, solid); m1.position.set(0, 1.375, 1.25);
  const m2 = new THREE.Mesh(manGeo, wire);  m2.position.set(0, 1.375, 1.25);
  g.add(m1, m2);

  // Tapered barrel — wider at the breech end (radiusBottom), thinner at tip (radiusTop)
  // CylGeo(radiusTop=muzzle, radiusBottom=breech, height, segs); rotated to point +Z
  const barGeo = new THREE.CylinderGeometry(0.08, 0.13, 3.2, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  // centre z = turret front (1.1) + half barrel (1.6) = 2.7
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 1.375, 2.7);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 1.375, 2.7);
  g.add(b1, b2);

  // Muzzle brake disc at barrel tip
  const mbGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.3, 8);
  const mb1 = new THREE.Mesh(mbGeo, solid);
  const mb2 = new THREE.Mesh(mbGeo, wire);
  // tip z = 2.7 + 1.6 = 4.3; disc centre z = 4.3 + 0.15 = 4.45
  mb1.rotation.x = Math.PI / 2; mb1.position.set(0, 1.375, 4.45);
  mb2.rotation.x = Math.PI / 2; mb2.position.set(0, 1.375, 4.45);
  g.add(mb1, mb2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 2.6, z) };
}

/**
 * RONIN — Type 10 / Armored Core inspired.
 * Stacked trapezoidal turret (wide base, narrower top), sloped glacis plate,
 * reactive-armour tile array across the hull front.
 */
function buildRonin(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Standard hull
  const hullGeo = new THREE.BoxGeometry(2.4, 1.0, 3.8);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.5;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.5;
  g.add(h1, h2);

  // Sloped glacis plate over hull front (rotation gives the slope angle)
  const glacisGeo = new THREE.BoxGeometry(2.4, 0.18, 1.3);
  const gl1 = new THREE.Mesh(glacisGeo, solid);
  const gl2 = new THREE.Mesh(glacisGeo, wire);
  gl1.rotation.x = -0.45; gl1.position.set(0, 0.5, 1.85);
  gl2.rotation.x = -0.45; gl2.position.set(0, 0.5, 1.85);
  g.add(gl1, gl2);

  // Reactive armour tiles — 2×2 grid on the glacis
  const tileGeo = new THREE.BoxGeometry(0.5, 0.09, 0.45);
  for (const tx of [-0.55, 0.55]) {
    for (const ty of [0.3, 0.65]) {
      const ra1 = new THREE.Mesh(tileGeo, solid);
      const ra2 = new THREE.Mesh(tileGeo, wire);
      ra1.rotation.x = -0.45; ra1.position.set(tx, ty, 1.95);
      ra2.rotation.x = -0.45; ra2.position.set(tx, ty, 1.95);
      g.add(ra1, ra2);
    }
  }

  // Lower turret layer (wide base)
  const lt1Geo = new THREE.BoxGeometry(1.8, 0.45, 1.8);
  const lt1a = new THREE.Mesh(lt1Geo, solid); lt1a.position.y = 1.225;
  const lt1b = new THREE.Mesh(lt1Geo, wire);  lt1b.position.y = 1.225;
  g.add(lt1a, lt1b);

  // Upper turret layer (narrower top — trapezoidal silhouette)
  const lt2Geo = new THREE.BoxGeometry(1.4, 0.4, 1.6);
  const lt2a = new THREE.Mesh(lt2Geo, solid); lt2a.position.y = 1.65;
  const lt2b = new THREE.Mesh(lt2Geo, wire);  lt2b.position.y = 1.65;
  g.add(lt2a, lt2b);

  // Long smooth barrel — z = turret front (0.8) + half barrel (1.7) = 2.5
  const barGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.4, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 1.55, 2.5);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 1.55, 2.5);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 2.8, z) };
}

/**
 * VANDAL — M26 Pershing inspired.
 * Rounded cylindrical turret with a rear bustle, commander's cupola on top,
 * circular mantlet ring at the barrel root.
 */
function buildVandal(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Slightly elongated hull
  const hullGeo = new THREE.BoxGeometry(2.4, 1.0, 3.8);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.5;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.5;
  g.add(h1, h2);

  // Rounded turret body — tapered cylinder (narrower at top, wider at base)
  const turGeo = new THREE.CylinderGeometry(0.85, 1.05, 0.85, 10);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 1.425;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 1.425;
  g.add(t1, t2);

  // Rear bustle (ammo storage box behind turret)
  // Turret rear at z ≈ -1.05; bustle centre z = -1.05 - 0.35 = -1.4
  const bustleGeo = new THREE.BoxGeometry(0.9, 0.65, 0.7);
  const bu1 = new THREE.Mesh(bustleGeo, solid); bu1.position.set(0, 1.425, -1.4);
  const bu2 = new THREE.Mesh(bustleGeo, wire);  bu2.position.set(0, 1.425, -1.4);
  g.add(bu1, bu2);

  // Commander's cupola on top of turret (small cylinder, offset right and rear)
  const cuGeo = new THREE.CylinderGeometry(0.26, 0.30, 0.3, 8);
  const cu1 = new THREE.Mesh(cuGeo, solid); cu1.position.set(0.22, 1.98, -0.2);
  const cu2 = new THREE.Mesh(cuGeo, wire);  cu2.position.set(0.22, 1.98, -0.2);
  g.add(cu1, cu2);

  // Circular mantlet ring at barrel root — lies horizontally (rotation.x = PI/2)
  const manGeo = new THREE.CylinderGeometry(0.23, 0.28, 0.25, 8);
  const mn1 = new THREE.Mesh(manGeo, solid);
  const mn2 = new THREE.Mesh(manGeo, wire);
  // front of turret ≈ 1.05; mantlet centre z = 1.05 + 0.125 = 1.175
  mn1.rotation.x = Math.PI / 2; mn1.position.set(0, 1.425, 1.175);
  mn2.rotation.x = Math.PI / 2; mn2.position.set(0, 1.425, 1.175);
  g.add(mn1, mn2);

  // Mid-length barrel — z = 1.05 + 1.6 = 2.65
  const barGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.2, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 1.425, 2.65);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 1.425, 2.65);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 2.9, z) };
}

/**
 * WRAITH — Halo Wraith inspired.
 * Wide hovering hull with side wing-pods, stacked dome turret, mortar cannon
 * angled 45° upward. Completely alien silhouette.
 */
function buildWraith(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Wide flat main hull
  const hullGeo = new THREE.BoxGeometry(3.2, 0.55, 4.0);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.275;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.275;
  g.add(h1, h2);

  // Side wing pods — lower than the hull top, extending outward
  const wingGeo = new THREE.BoxGeometry(1.1, 0.4, 2.6);
  for (const sx of [-2.15, 2.15]) {
    const w1 = new THREE.Mesh(wingGeo, solid); w1.position.set(sx, 0.2, 0);
    const w2 = new THREE.Mesh(wingGeo, wire);  w2.position.set(sx, 0.2, 0);
    g.add(w1, w2);
  }

  // Hover discs at hull corners (flat cylinders near ground)
  const discGeo = new THREE.CylinderGeometry(0.42, 0.52, 0.22, 7);
  for (const [dx, dz] of [[-1.4, -1.6], [1.4, -1.6], [-1.4, 1.6], [1.4, 1.6]]) {
    const d1 = new THREE.Mesh(discGeo, solid); d1.position.set(dx, 0.11, dz);
    const d2 = new THREE.Mesh(discGeo, wire);  d2.position.set(dx, 0.11, dz);
    g.add(d1, d2);
  }

  // Lower dome body
  const lowerGeo = new THREE.CylinderGeometry(1.1, 1.35, 0.5, 9);
  const ld1 = new THREE.Mesh(lowerGeo, solid); ld1.position.y = 0.8;
  const ld2 = new THREE.Mesh(lowerGeo, wire);  ld2.position.y = 0.8;
  g.add(ld1, ld2);

  // Upper dome cap (narrower)
  const upperGeo = new THREE.CylinderGeometry(0.65, 1.05, 0.4, 9);
  const ud1 = new THREE.Mesh(upperGeo, solid); ud1.position.y = 1.25;
  const ud2 = new THREE.Mesh(upperGeo, wire);  ud2.position.y = 1.25;
  g.add(ud1, ud2);

  // Mortar cannon angled 45° upward from dome front
  // rotation.x = -PI/4 tilts vertical cylinder to point forward+up
  const morGeo = new THREE.CylinderGeometry(0.10, 0.15, 2.2, 6);
  const mo1 = new THREE.Mesh(morGeo, solid);
  const mo2 = new THREE.Mesh(morGeo, wire);
  mo1.rotation.x = -Math.PI / 4; mo1.position.set(0, 1.65, 0.65);
  mo2.rotation.x = -Math.PI / 4; mo2.position.set(0, 1.65, 0.65);
  g.add(mo1, mo2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 3.2, z) };
}

// ---------------------------------------------------------------------------
// Heavy tank mesh builders
// ---------------------------------------------------------------------------

/**
 * GOLIATH — Tiger I inspired.
 * Large symmetrical box turret, thick hull, long tapered high-velocity barrel,
 * thin side-skirt plates hanging below hull sides.
 */
function buildGoliath(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Thick heavy hull
  const hullGeo = new THREE.BoxGeometry(3.2, 1.2, 5.0);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.6;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.6;
  g.add(h1, h2);

  // Side skirts — thin plates covering the lower hull flanks
  // x: ±(hull half-width 1.6 + skirt half-thickness 0.05) = ±1.65
  const skirtGeo = new THREE.BoxGeometry(0.1, 0.7, 4.8);
  for (const sx of [-1.65, 1.65]) {
    const sk1 = new THREE.Mesh(skirtGeo, solid); sk1.position.set(sx, 0.35, 0);
    const sk2 = new THREE.Mesh(skirtGeo, wire);  sk2.position.set(sx, 0.35, 0);
    g.add(sk1, sk2);
  }

  // Large symmetrical box turret
  const turGeo = new THREE.BoxGeometry(2.4, 0.9, 2.8);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 1.65;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 1.65;
  g.add(t1, t2);

  // Long tapered barrel (wider at breech) — Tiger's signature high-velocity gun
  // centre z = turret front (1.4) + half barrel (2.25) = 3.65
  const barGeo = new THREE.CylinderGeometry(0.10, 0.15, 4.5, 4);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 1.65, 3.65);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 1.65, 3.65);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 3.0, z) };
}

/**
 * KREMLIN — KV-2 inspired.
 * Normal hull dwarfed by an enormous near-cubic turret.
 * Short wide howitzer barrel — the KV-2's ridiculous silhouette.
 */
function buildKremlin(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Hull (standard proportions — the turret overwhelms it)
  const hullGeo = new THREE.BoxGeometry(3.0, 1.1, 4.8);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.55;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.55;
  g.add(h1, h2);

  // ENORMOUS near-cubic turret — this is the whole design statement
  const turGeo = new THREE.BoxGeometry(2.4, 2.0, 2.6);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 2.1;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 2.1;
  g.add(t1, t2);

  // Short wide howitzer barrel (6-sided for a fat look)
  // centre z = turret front (1.3) + half barrel (1.0) = 2.3
  const barGeo = new THREE.CylinderGeometry(0.18, 0.22, 2.0, 6);
  const b1 = new THREE.Mesh(barGeo, solid);
  const b2 = new THREE.Mesh(barGeo, wire);
  b1.rotation.x = Math.PI / 2; b1.position.set(0, 2.1, 2.3);
  b2.rotation.x = Math.PI / 2; b2.position.set(0, 2.1, 2.3);
  g.add(b1, b2);

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 4.5, z) };
}

/**
 * MAMMOTH — Command & Conquer Mammoth Tank inspired.
 * Twin parallel barrels, rocket pod boxes on turret flanks with upright launch
 * tubes, very wide hull. Classic M-silhouette when viewed head-on.
 */
function buildMammoth(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Very wide heavy hull
  const hullGeo = new THREE.BoxGeometry(4.0, 1.2, 5.2);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.6;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.6;
  g.add(h1, h2);

  // Large turret body
  const turGeo = new THREE.BoxGeometry(2.8, 1.0, 3.0);
  const t1 = new THREE.Mesh(turGeo, solid); t1.position.y = 1.7;
  const t2 = new THREE.Mesh(turGeo, wire);  t2.position.y = 1.7;
  g.add(t1, t2);

  // Twin barrels side by side — x offset ±0.4
  // centre z = turret front (1.5) + half barrel (2.0) = 3.5
  const barGeo = new THREE.CylinderGeometry(0.10, 0.10, 4.0, 4);
  for (const bx of [-0.4, 0.4]) {
    const b1 = new THREE.Mesh(barGeo, solid);
    const b2 = new THREE.Mesh(barGeo, wire);
    b1.rotation.x = Math.PI / 2; b1.position.set(bx, 1.7, 3.5);
    b2.rotation.x = Math.PI / 2; b2.position.set(bx, 1.7, 3.5);
    g.add(b1, b2);
  }

  // Rocket pod boxes on turret flanks
  // x: ±(turret half-width 1.4 + pod half-width 0.425) = ±1.825 → ±1.9
  const podGeo = new THREE.BoxGeometry(0.85, 1.0, 0.85);
  // Launch tubes standing upright on each pod — 2 per pod
  const tubeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6);
  for (const px of [-1.9, 1.9]) {
    const p1 = new THREE.Mesh(podGeo, solid); p1.position.set(px, 1.7, -0.3);
    const p2 = new THREE.Mesh(podGeo, wire);  p2.position.set(px, 1.7, -0.3);
    g.add(p1, p2);
    // Two tubes per pod, offset ±0.2 in x
    for (const tx of [px - 0.2, px + 0.2]) {
      const tu1 = new THREE.Mesh(tubeGeo, solid); tu1.position.set(tx, 2.65, -0.3);
      const tu2 = new THREE.Mesh(tubeGeo, wire);  tu2.position.set(tx, 2.65, -0.3);
      g.add(tu1, tu2);
    }
  }

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 4.0, z) };
}

/**
 * LEVIATHAN — Bolo / Ogre super-tank inspired.
 * Massive elongated hull with layered armour slab, two independent turrets
 * (fore and aft), four box sponsons with stub guns, true super-heavy profile.
 */
function buildLeviathan(scene, x, z) {
  const wire  = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });
  const solid = makeSolidMat();
  const g = new THREE.Group();

  // Massive main hull
  const hullGeo = new THREE.BoxGeometry(5.0, 1.4, 8.0);
  const h1 = new THREE.Mesh(hullGeo, solid); h1.position.y = 0.7;
  const h2 = new THREE.Mesh(hullGeo, wire);  h2.position.y = 0.7;
  g.add(h1, h2);

  // Layered upper armour slab (slightly smaller, sits on hull top)
  const slabGeo = new THREE.BoxGeometry(4.6, 0.28, 7.6);
  const sl1 = new THREE.Mesh(slabGeo, solid); sl1.position.y = 1.54;
  const sl2 = new THREE.Mesh(slabGeo, wire);  sl2.position.y = 1.54;
  g.add(sl1, sl2);

  // Fore turret (larger, facing forward)
  const foreTurGeo = new THREE.BoxGeometry(1.8, 0.8, 2.0);
  const ft1 = new THREE.Mesh(foreTurGeo, solid); ft1.position.set(0, 1.8, 2.2);
  const ft2 = new THREE.Mesh(foreTurGeo, wire);  ft2.position.set(0, 1.8, 2.2);
  g.add(ft1, ft2);

  // Fore barrel — centre z = turret front (2.2+1.0=3.2) + half barrel (1.9) = 5.1
  const foreBarGeo = new THREE.CylinderGeometry(0.11, 0.14, 3.8, 4);
  const fb1 = new THREE.Mesh(foreBarGeo, solid);
  const fb2 = new THREE.Mesh(foreBarGeo, wire);
  fb1.rotation.x = Math.PI / 2; fb1.position.set(0, 1.8, 5.1);
  fb2.rotation.x = Math.PI / 2; fb2.position.set(0, 1.8, 5.1);
  g.add(fb1, fb2);

  // Aft turret (slightly smaller, faces backward)
  const aftTurGeo = new THREE.BoxGeometry(1.6, 0.7, 1.8);
  const at1 = new THREE.Mesh(aftTurGeo, solid); at1.position.set(0, 1.75, -2.2);
  const at2 = new THREE.Mesh(aftTurGeo, wire);  at2.position.set(0, 1.75, -2.2);
  g.add(at1, at2);

  // Aft barrel — rotation.x = -PI/2 makes it point -Z (backward)
  // turret rear z = -2.2 - 0.9 = -3.1; centre z = -3.1 - 1.4 = -4.5
  const aftBarGeo = new THREE.CylinderGeometry(0.10, 0.12, 2.8, 4);
  const ab1 = new THREE.Mesh(aftBarGeo, solid);
  const ab2 = new THREE.Mesh(aftBarGeo, wire);
  ab1.rotation.x = -Math.PI / 2; ab1.position.set(0, 1.75, -4.5);
  ab2.rotation.x = -Math.PI / 2; ab2.position.set(0, 1.75, -4.5);
  g.add(ab1, ab2);

  // Side sponsons — 2 per side at fore and aft positions
  // Centre x: ±(hull half-width 2.5 + sponson half-width 0.45) = ±2.95 → ±3.0
  const sponsonGeo = new THREE.BoxGeometry(0.9, 0.9, 2.0);
  // Stub gun barrel (points outward in ±X)
  // rotation.z = +PI/2 → cylinder points -X (left side outward)
  // rotation.z = -PI/2 → cylinder points +X (right side outward)
  const stubGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.0, 4);

  for (const [sx, rotZ] of [[-3.0, Math.PI / 2], [3.0, -Math.PI / 2]]) {
    for (const sz of [-1.8, 1.8]) {
      // Sponson box
      const sp1 = new THREE.Mesh(sponsonGeo, solid); sp1.position.set(sx, 0.9, sz);
      const sp2 = new THREE.Mesh(sponsonGeo, wire);  sp2.position.set(sx, 0.9, sz);
      g.add(sp1, sp2);
      // Outward-pointing stub gun
      // gun centre x: sponson_centre_x ± (sponson_half_w + gun_half_len) = ±(3.0 + 0.45 + 0.5) = ±3.95
      const gunX = sx < 0 ? sx - 0.95 : sx + 0.95;
      const st1 = new THREE.Mesh(stubGeo, solid);
      const st2 = new THREE.Mesh(stubGeo, wire);
      st1.rotation.z = rotZ; st1.position.set(gunX, 0.9, sz);
      st2.rotation.z = rotZ; st2.position.set(gunX, 0.9, sz);
      g.add(st1, st2);
    }
  }

  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, worldPos: new THREE.Vector3(x, 4.5, z) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AreaX({ onBack }) {
  const mountRef  = useRef(null);
  const labelsRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth  || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000);
    mount.appendChild(renderer.domElement);

    // --- Scene + grid ---
    const scene = new THREE.Scene();
    const grid  = new THREE.GridHelper(72, 36, COLORS.terrain, COLORS.terrain);
    scene.add(grid);

    // --- Camera ---
    // Orbit centre sits between the entity row (z=0) and the tank rows
    // (z=-12 / -24 / -34) so the full layout is framed on load.
    const lookAt = new THREE.Vector3(0, 0, -14);
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);

    let theta  = 0.3;
    let phi    = Math.PI / 3.6;   // ~50° from zenith
    let radius = 78;

    const updateCamera = () => {
      const sinPhi = Math.sin(phi);
      camera.position.set(
        lookAt.x + radius * sinPhi * Math.sin(theta),
        lookAt.y + radius * Math.cos(phi),
        lookAt.z + radius * sinPhi * Math.cos(theta),
      );
      camera.lookAt(lookAt);
    };
    updateCamera();

    // --- Orbit controls ---
    let dragging = false;
    let dragX = 0, dragY = 0;

    const onPointerDown = (e) => { dragging = true; dragX = e.clientX; dragY = e.clientY; };
    const onPointerUp   = ()  => { dragging = false; };
    const onPointerMove = (e) => {
      if (!dragging) return;
      theta -= (e.clientX - dragX) * 0.005;
      phi    = Math.max(0.08, Math.min(Math.PI * 0.47, phi + (e.clientY - dragY) * 0.005));
      dragX  = e.clientX;
      dragY  = e.clientY;
      updateCamera();
    };
    const onWheel = (e) => {
      radius = Math.max(20, Math.min(140, radius + e.deltaY * 0.05));
      updateCamera();
      e.preventDefault();
    };

    mount.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup',   onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('wheel', onWheel, { passive: false });

    // --- Entity + tank layout ---
    //
    //  z =  0    Entity showcase    (existing 6)
    //  z = -12   Light tanks        SWIFT  LYNX  PHANTOM  GECKO
    //  z = -24   Medium tanks       IRON CROSS  RONIN  VANDAL  WRAITH
    //  z = -34   Heavy tanks        GOLIATH  KREMLIN  MAMMOTH  LEVIATHAN
    //
    const LZ = -12, MZ = -24, HZ = -34;
    const LMX = [-15, -5, 5, 15];    // light + medium x positions
    const HX  = [-20, -7, 7, 20];    // heavy x positions (wider spacing)

    const entities = [
      // ── Entities (indices 0–5) ────────────────────────────────────────────
      buildTank       (scene, COLORS.playerTank, -20, 0, 0),
      buildTank       (scene, COLORS.enemyTank,  -10, 0, Math.PI),
      buildDrone      (scene,   0,  7,  0),
      buildProjectile (scene,   9,  2,  0),
      buildMine       (scene,  16,  0),
      buildInfantry   (scene,  23,  0),

      // ── Section-header anchors (indices 6–8, no mesh) ────────────────────
      { group: null, worldPos: new THREE.Vector3(-26, 2, LZ) },
      { group: null, worldPos: new THREE.Vector3(-26, 2, MZ) },
      { group: null, worldPos: new THREE.Vector3(-26, 2, HZ) },

      // ── Light tanks (indices 9–12) ───────────────────────────────────────
      buildSwift  (scene, LMX[0], LZ),
      buildLynx   (scene, LMX[1], LZ),
      buildPhantom(scene, LMX[2], LZ),
      buildGecko  (scene, LMX[3], LZ),

      // ── Medium tanks (indices 13–16) ─────────────────────────────────────
      buildIronCross(scene, LMX[0], MZ),
      buildRonin    (scene, LMX[1], MZ),
      buildVandal   (scene, LMX[2], MZ),
      buildWraith   (scene, LMX[3], MZ),

      // ── Heavy tanks (indices 17–20) ──────────────────────────────────────
      buildGoliath  (scene, HX[0], HZ),
      buildKremlin  (scene, HX[1], HZ),
      buildMammoth  (scene, HX[2], HZ),
      buildLeviathan(scene, HX[3], HZ),
    ];

    // --- Render + label loop ---
    const tmp  = new THREE.Vector3();
    let rafId;

    const tick = () => {
      rafId = requestAnimationFrame(tick);

      const mw = mount.clientWidth;
      const mh = mount.clientHeight;
      const container = labelsRef.current;
      if (container) {
        const els = container.children;
        for (let i = 0; i < entities.length; i++) {
          const el = els[i];
          if (!el) continue;
          tmp.copy(entities[i].worldPos);
          tmp.project(camera);
          if (tmp.z > 1) { el.style.display = 'none'; continue; }
          el.style.display = '';
          el.style.left = `${(tmp.x *  0.5 + 0.5) * mw}px`;
          el.style.top  = `${(tmp.y * -0.5 + 0.5) * mh}px`;
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    // --- Resize ---
    const onResize = () => {
      const rw = mount.clientWidth, rh = mount.clientHeight;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh, false);
    };
    window.addEventListener('resize', onResize);

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(rafId);
      mount.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup',   onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);

      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div style={{
      position: 'relative',
      width: '100vw',
      height: '100vh',
      background: '#000',
      overflow: 'hidden',
    }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Page title */}
      <div style={{
        position: 'absolute', top: 20, left: 0, right: 0,
        textAlign: 'center', color: '#00ff00', fontFamily: 'monospace',
        fontSize: 22, letterSpacing: 8, pointerEvents: 'none',
      }}>
        AREA X
      </div>
      <div style={{
        position: 'absolute', top: 52, left: 0, right: 0,
        textAlign: 'center', color: '#00aa00', fontFamily: 'monospace',
        fontSize: 11, letterSpacing: 3, pointerEvents: 'none',
      }}>
        UNIT SHOWCASE — DRAG TO ORBIT · SCROLL TO ZOOM
      </div>

      {/* Floating labels — positioned each frame in RAF */}
      <div
        ref={labelsRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      >
        {ALL_LABELS.map(({ label, header }, i) => (
          <div
            key={i}
            style={{
              position:      'absolute',
              transform:     'translate(-50%, -100%)',
              color:         header ? '#aaaa00' : '#00ff00',
              fontFamily:    'monospace',
              fontSize:      header ? 11 : 10,
              fontWeight:    header ? 'bold' : 'normal',
              letterSpacing: 2,
              textShadow:    header ? '0 0 6px #888800' : '0 0 6px #00ff00',
              whiteSpace:    'nowrap',
              paddingBottom: 4,
            }}
          >
            {label}
          </div>
        ))}
      </div>

      <button
        className="wireframe-btn"
        onClick={onBack}
        style={{
          position:  'absolute',
          bottom:    30,
          left:      '50%',
          transform: 'translateX(-50%)',
        }}
      >
        ← BACK
      </button>
    </div>
  );
}
