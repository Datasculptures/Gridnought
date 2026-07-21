import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { APP, POWERUP, COLORS, AMMO } from '../utils/constants.js';

import Tank from '../entities/Tank.js';
import InfantryUnit from '../entities/InfantryUnit.js';
import TruckVehicle from '../entities/TruckVehicle.js';
import APCVehicle from '../entities/APCVehicle.js';
import JammerTruck from '../entities/JammerTruck.js';
import MinelayerVehicle from '../entities/MinelayerVehicle.js';
import TurretEmplacement from '../entities/TurretEmplacement.js';
import DestructibleBuilding from '../entities/DestructibleBuilding.js';
import Bomber from '../entities/Bomber.js';
import Transport from '../entities/Transport.js';
import Drone from '../entities/Drone.js';
import PowerUp from '../entities/PowerUp.js';
import MineManager from '../entities/MineManager.js';

/**
 * HOW TO / ABOUT — the Area X museum.
 *
 * Every exhibit is an instance of the *real* game class standing on a flat
 * stub terrain, so the display can never drift out of sync with what you
 * meet in the field. Entities are constructed but never updated (except the
 * spinning power-ups), which keeps them as static display pieces.
 *
 * You explore as a small blue infantry figure: W/S walk, A/D turn.
 */

const BLUE = 0x4488ff;

/** Flat ground at y=0 — enough terrain API for entity construction. */
const stubTerrain = {
  seed: 1,
  getHeightAt: () => 0,
  getNormalAt: () => new THREE.Vector3(0, 1, 0),
  isHazardAt: () => false,
  isPassable: () => true,
  solidMeshes: [],
  worldGen: { riverInfoAt: () => ({ inChannel: false, isFord: false }) },
};

// ---------------------------------------------------------------------------
// Concept-only models (not in the game yet — hand-built for the prototype range)
// ---------------------------------------------------------------------------

function solidMat() {
  return new THREE.MeshBasicMaterial({
    color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
}

function conceptBox(g, S, W, w, h, d, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  for (const m of [new THREE.Mesh(geo, S), new THREE.Mesh(geo, W)]) {
    m.position.set(x, y, z);
    g.add(m);
  }
  return geo;
}

function buildMortarTeam() {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color: COLORS.enemyTank, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  for (const ox of [-0.7, 0.7]) {
    geos.push(conceptBox(g, S, W, 0.34, 0.34, 0.2, ox, 0.32, -0.4));
    const head = new THREE.SphereGeometry(0.14, 6, 5);
    for (const m of [new THREE.Mesh(head, S), new THREE.Mesh(head, W)]) {
      m.position.set(ox, 0.6, -0.4);
      g.add(m);
    }
    geos.push(head);
  }
  geos.push(conceptBox(g, S, W, 0.7, 0.08, 0.7, 0, 0.04, 0.3));
  const tube = new THREE.CylinderGeometry(0.09, 0.11, 1.1, 6);
  for (const m of [new THREE.Mesh(tube, S), new THREE.Mesh(tube, W)]) {
    m.position.set(0, 0.5, 0.3);
    m.rotation.x = -0.5;
    g.add(m);
  }
  geos.push(tube);
  return { group: g, mats: [S, W], geos };
}

function buildTwinBarrelConcept() {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color: BLUE, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(conceptBox(g, S, W, 2.4, 1.0, 3.6, 0, 0.5, 0));
  geos.push(conceptBox(g, S, W, 1.35, 0.7, 1.8, 0, 1.35, 0));
  geos.push(conceptBox(g, S, W, 0.30, 0.52, 3.5, 1.42, 0.30, 0));
  geos.push(conceptBox(g, S, W, 0.30, 0.52, 3.5, -1.42, 0.30, 0));
  const bg = new THREE.CylinderGeometry(0.09, 0.09, 2.4, 4);
  for (const bx of [-0.3, 0.3]) {
    for (const m of [new THREE.Mesh(bg, S), new THREE.Mesh(bg, W)]) {
      m.rotation.x = Math.PI / 2;
      m.position.set(bx, 1.5, 2.1);
      g.add(m);
    }
  }
  geos.push(bg);
  return { group: g, mats: [S, W], geos };
}

function buildMedicTruckConcept() {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(conceptBox(g, S, W, 2.2, 1.2, 2.2, 0, 0.6, -0.75));
  geos.push(conceptBox(g, S, W, 2.0, 2.2, 1.6, 0, 1.1, 1.0));
  const R = new THREE.MeshBasicMaterial({ color: 0xff2222, wireframe: true });
  geos.push(conceptBox(g, S, R, 0.9, 0.22, 0.1, 0, 1.2, -1.9));
  geos.push(conceptBox(g, S, R, 0.22, 0.9, 0.1, 0, 1.2, -1.9));
  return { group: g, mats: [S, W, R], geos };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HowToPage({ visible, onBack }) {
  const mountRef  = useRef(null);
  const labelsRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    const mount = mountRef.current;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

    const gridSize = 150;
    const grid = new THREE.GridHelper(gridSize, 60, 0x00aa00, 0x004400);
    scene.add(grid);

    // Everything that needs tearing down: game entities expose dispose(),
    // concept models expose { mats, geos }.
    const entities = [];
    const concepts = [];
    const exhibits = [];

    /** Places a live game entity and registers its floating label. */
    const show = (label, entity, x, z, ry = 0, labelY = 3.2, y = 0) => {
      entity.group.position.set(x, y, z);
      entity.group.rotation.y = ry;
      entities.push(entity);
      exhibits.push({ label, x, y: labelY, z });
      return entity;
    };

    /** Places a hand-built concept model. */
    const showConcept = (label, built, x, z, ry = 0, labelY = 3.2) => {
      built.group.position.set(x, 0, z);
      built.group.rotation.y = ry;
      scene.add(built.group);
      concepts.push(built);
      exhibits.push({ label, x, y: labelY, z });
    };

    const vehicleCfg = {
      terrain: stubTerrain, movementValidator: null, mineManager: null,
    };
    const tankCfg = (cls) => ({
      position: { x: 0, z: 0, heading: 0 },
      color: COLORS.enemyTank,
      tankClass: cls,
      terrain: stubTerrain,
      inputManager: null,
      movementValidator: null,
    });

    // ---- Row 1: armour ----
    show('ENEMY TANK — LIGHT · 8 PTS',  new Tank(scene, tankCfg('light')),  -26, -20, Math.PI);
    show('ENEMY TANK — MEDIUM · 10 PTS', new Tank(scene, tankCfg('medium')), -13, -20, Math.PI);
    show('ENEMY TANK — HEAVY · 15 PTS',  new Tank(scene, tankCfg('heavy')),    1, -20, Math.PI);
    show('YOUR TANK', new Tank(scene, { ...tankCfg('medium'), color: COLORS.playerTank }), 16, -20, Math.PI);

    // A deployed turret: force it out of its dormant, sunk state for display
    const turret = new TurretEmplacement(scene, { position: { x: 0, z: 0 }, terrain: stubTerrain });
    turret._active = true;
    turret._riseY  = 1;
    turret._wireMat.color.setHex(COLORS.enemyTank);
    turret.turretPivot.position.y = turret._turretBaseY;
    show('TURRET EMPLACEMENT · 6 PTS', turret, 30, -20, Math.PI, 4.2);

    // ---- Row 2: ground forces ----
    show('INFANTRY · 1 PT',
      new InfantryUnit(scene, { position: { x: 0, z: 0 }, ...vehicleCfg }), -26, -7, Math.PI, 2.2);
    show('ALLIED INFANTRY — FIGHTS FOR YOU',
      new InfantryUnit(scene, { position: { x: 0, z: 0 }, faction: 'friendly', ...vehicleCfg }),
      -19, -7, 0, 2.2);
    show('SUPPLY TRUCK · DROPS SUPPLIES',
      new TruckVehicle(scene, { position: { x: 0, z: 0 }, ...vehicleCfg }), -10, -7, Math.PI);
    show('APC · 5 PTS · DEPLOYS INFANTRY · MG',
      new APCVehicle(scene, { position: { x: 0, z: 0 }, ...vehicleCfg }), 2, -7, Math.PI);
    show('JAMMER · 5 PTS · SCRAMBLES SENSORS',
      new JammerTruck(scene, { position: { x: 0, z: 0 }, ...vehicleCfg }), 14, -7, Math.PI);
    show('MINELAYER · 7 PTS · SEEDS MINES',
      new MinelayerVehicle(scene, { position: { x: 0, z: 0 }, ...vehicleCfg }), 26, -7, Math.PI);
    show('ENEMY HQ · 10 SHOTS · 40 PTS',
      new DestructibleBuilding(scene, { position: { x: 0, z: 0 }, terrain: stubTerrain }), 40, -16, 0, 5.5);

    // A patch of live mines
    const mineManager = new MineManager(scene);
    for (const [mx, mz] of [[36, -6], [37.4, -4.8], [34.8, -4.4], [36.4, -3.2]]) {
      mineManager.addMineAt(stubTerrain, mx, mz);
    }
    exhibits.push({ label: 'MINEFIELD — KEEP CLEAR', x: 36, y: 1.8, z: -4.6 });

    // ---- Row 3: aircraft (parked above the floor) ----
    show('BOMBER · 20 PTS · BOMB LINE',
      new Bomber(scene, {
        start: { x: 0, z: -1 }, target: { x: 0, z: 0 }, terrain: stubTerrain, onDetonate: () => {},
      }), -16, 8, Math.PI * 0.5, 10.5, 7);
    show('TRANSPORT · 25 PTS · MINES OR PARATROOPS',
      new Transport(scene, {
        start: { x: 0, z: -1 }, target: { x: 0, z: 0 }, payload: 'troops',
        terrain: stubTerrain, onDeliver: () => {},
      }), 6, 8, Math.PI * 0.5, 11, 7);
    show('YOUR DRONE · SPOTS FOR THE MINIMAP · R TO RETASK',
      new Drone(scene), 26, 8, 0, 7.5, 5);

    // ---- Row 4: pickups (they spin themselves) ----
    const spinners = [];
    let px = -26;
    for (const [key, def] of Object.entries(POWERUP.types)) {
      const pu = new PowerUp(scene, { position: { x: px, z: 18 }, type: key, terrain: stubTerrain });
      entities.push(pu);
      spinners.push(pu);
      exhibits.push({ label: def.label, x: px, y: 3.4, z: 18 });
      px += 9;
    }

    // ---- Prototype range (east side, roped off) ----
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(52, 0.8, -34), new THREE.Vector3(52, 0.8, 30),
    ]);
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    scene.add(new THREE.Line(ropeGeo, ropeMat));
    exhibits.push({ label: '⚠ PROTOTYPE RANGE — CONCEPTS UNDER EVALUATION', x: 62, y: 6.5, z: 0 });

    showConcept('CONCEPT: TWIN-BARREL TANK', buildTwinBarrelConcept(), 62, -16, -Math.PI / 2);
    showConcept('CONCEPT: MORTAR TEAM',      buildMortarTeam(),        62, -4, -Math.PI / 2, 1.8);
    showConcept('CONCEPT: MEDIC TRUCK — DO NOT FIRE', buildMedicTruckConcept(), 62, 10, -Math.PI / 2);

    // ---- The visitor ----
    const figure = new InfantryUnit(scene, {
      position: { x: 0, z: 30 }, faction: 'friendly', ...vehicleCfg,
    });
    entities.push(figure);
    const player = { x: 0, z: 30, heading: Math.PI };

    // ---- Input (capture phase so the game underneath never sees it) ----
    const keys = new Set();
    const onKeyDown = (e) => {
      // stopImmediatePropagation so the game's own Escape handler (which
      // would resume the round) never sees this keypress
      if (e.code === 'Escape') { e.stopImmediatePropagation(); onBack(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Enter', 'Space'].includes(e.code)) {
        e.stopPropagation();
        e.preventDefault();
        keys.add(e.code);
      }
    };
    const onKeyUp = (e) => { keys.delete(e.code); };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    // ---- Loop ----
    const clock = new THREE.Clock();
    let rafId;
    const v3 = new THREE.Vector3();

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);

      if (keys.has('KeyA')) player.heading += 2.6 * dt;
      if (keys.has('KeyD')) player.heading -= 2.6 * dt;
      let move = 0;
      if (keys.has('KeyW')) move = 1;
      if (keys.has('KeyS')) move = -1;
      if (move !== 0) {
        player.x += Math.sin(player.heading) * move * 9 * dt;
        player.z += Math.cos(player.heading) * move * 9 * dt;
        const B = gridSize / 2 - 2;
        player.x = Math.max(-B, Math.min(B, player.x));
        player.z = Math.max(-B, Math.min(B, player.z));
      }
      figure.position.set(player.x, 0, player.z);
      figure.heading = player.heading;
      figure.group.position.set(player.x, 0, player.z);
      figure.group.rotation.y = player.heading;

      const camX = player.x - Math.sin(player.heading) * 7;
      const camZ = player.z - Math.cos(player.heading) * 7;
      camera.position.set(camX, 4.2, camZ);
      camera.lookAt(player.x + Math.sin(player.heading) * 4, 1.2, player.z + Math.cos(player.heading) * 4);

      for (const pu of spinners) pu.update(dt, null);

      const labelHost = labelsRef.current;
      if (labelHost) {
        for (let i = 0; i < exhibits.length; i++) {
          const ex = exhibits[i];
          let el = labelHost.children[i];
          if (!el) {
            el = document.createElement('div');
            el.style.cssText =
              'position:absolute;transform:translate(-50%,-100%);color:#00ff00;' +
              'font-family:monospace;font-size:11px;letter-spacing:1px;white-space:nowrap;' +
              'text-shadow:0 0 4px #000;pointer-events:none;';
            labelHost.appendChild(el);
          }
          el.textContent = ex.label;
          v3.set(ex.x, ex.y, ex.z).project(camera);
          const behind = v3.z > 1;
          el.style.display = behind ? 'none' : 'block';
          el.style.left = `${(v3.x * 0.5 + 0.5) * window.innerWidth}px`;
          el.style.top  = `${(-v3.y * 0.5 + 0.5) * window.innerHeight}px`;
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('resize', onResize);
      for (const e of entities) e.dispose();
      mineManager.dispose();
      for (const c of concepts) {
        scene.remove(c.group);
        for (const m of c.mats ?? []) m.dispose();
        for (const g of c.geos ?? []) g.dispose();
      }
      ropeGeo.dispose();
      ropeMat.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [visible, onBack]);

  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#000' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />

      <div style={{
        position: 'absolute', top: 16, left: 0, right: 0, textAlign: 'center',
        color: '#00ff00', fontFamily: 'monospace', pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 24, letterSpacing: 6, fontWeight: 'bold' }}>AREA X — FIELD MANUAL</div>
        <div style={{ fontSize: 11, color: '#00aa00', marginTop: 4 }}>WALK THE FLOOR · W/S MOVE · A/D TURN · ESC TO RETURN</div>
      </div>

      <div style={{
        position: 'absolute', left: 16, top: 90, color: '#00cc00',
        fontFamily: 'monospace', fontSize: 11, lineHeight: 1.9, letterSpacing: 1,
        background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(0,255,0,0.3)',
        padding: '10px 14px', pointerEvents: 'none',
      }}>
        <div style={{ color: '#ffff00', marginBottom: 4 }}>COMMANDS</div>
        <div>W / S — DRIVE</div>
        <div>A / D — TURN HULL</div>
        <div>MOUSE — AIM TURRET</div>
        <div>CLICK — FIRE SELECTED AMMO</div>
        <div>1 / 2 / 3 — {AMMO.order.map(t => AMMO.types[t].short).join(' · ')}</div>
        <div>X — DRONE STRIKE (ON TARGET LOCK)</div>
        <div>, / . — BARREL ELEVATION</div>
        <div>P — FIRST / THIRD PERSON</div>
        <div>R — RETASK DRONE</div>
        <div>Q / E — ORBIT CAMERA</div>
        <div>ESC — PAUSE MENU</div>
      </div>

      <div style={{
        position: 'absolute', right: 16, bottom: 14, color: '#008800',
        fontFamily: 'monospace', fontSize: 11, letterSpacing: 2, pointerEvents: 'none',
      }}>
        WIREZONE v{APP.version} — {APP.date}
      </div>

      <button className="wireframe-btn" onClick={onBack} style={{ position: 'absolute', left: 16, bottom: 14 }}>
        BACK
      </button>
    </div>
  );
}
