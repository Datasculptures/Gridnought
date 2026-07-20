import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { APP, POWERUP } from '../utils/constants.js';

/**
 * HOW TO / ABOUT — the Area X museum, rebuilt.
 *
 * A walkable exhibition field: every enemy and power-up stands as a static
 * display with its name floating above it. You explore it as a small blue
 * infantry figure (W/S walk, A/D turn). One roped-off side of the field is
 * the PROTOTYPE RANGE — concept units under evaluation. Controls and the
 * version/date are shown as overlays.
 *
 * Rendered as a full-screen overlay with its own scene/renderer — the game
 * canvas underneath stays mounted and untouched.
 */

const GREEN = 0x00ff00;
const RED   = 0xff4444;
const BLUE  = 0x4488ff;
const GREY  = 0x888888;

// ---------------------------------------------------------------------------
// Model builders (static, simplified)
// ---------------------------------------------------------------------------

function solidMat() {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
}

/** Adds a solid+wire box pair to group g. */
function box(g, S, W, w, h, d, x, y, z, rx = 0, ry = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  for (const m of [new THREE.Mesh(geo, S), new THREE.Mesh(geo, W)]) {
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.rotation.y = ry;
    g.add(m);
  }
  return geo;
}

function buildTank(color, opts = {}) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 2.4, 1.0, 3.6, 0, 0.5, 0));            // hull
  geos.push(box(g, S, W, 1.35, 0.7, 1.8, 0, 1.35, 0));          // turret (narrow)
  // Wide track skirts matching the in-game model
  geos.push(box(g, S, W, 0.30, 0.52, 3.5,  1.42, 0.30, 0));     // skirts
  geos.push(box(g, S, W, 0.30, 0.52, 3.5, -1.42, 0.30, 0));
  geos.push(box(g, S, W, 1.8, 0.18, 0.95, 0, 1.08, -1.20));     // engine deck
  geos.push(box(g, S, W, 1.15, 0.48, 0.55, 0, 1.35, -1.12));    // bustle
  geos.push(box(g, S, W, 0.82, 0.46, 0.28, 0, 1.58, 0.95));     // mantlet
  const cupGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.22, 6);
  for (const m of [new THREE.Mesh(cupGeo, S), new THREE.Mesh(cupGeo, W)]) {
    m.position.set(-0.42, 1.80, -0.25);
    g.add(m);
  }
  geos.push(cupGeo);
  if (opts.twinBarrel) {
    const bg = new THREE.CylinderGeometry(0.09, 0.09, 2.4, 4);
    for (const bx of [-0.3, 0.3]) {
      for (const m of [new THREE.Mesh(bg, S), new THREE.Mesh(bg, W)]) {
        m.rotation.x = Math.PI / 2;
        m.position.set(bx, 1.5, 2.1);
        g.add(m);
      }
    }
    geos.push(bg);
  } else {
    const bg = new THREE.CylinderGeometry(0.1, 0.1, 3.0, 4);
    for (const m of [new THREE.Mesh(bg, S), new THREE.Mesh(bg, W)]) {
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 1.5, 2.4);
      g.add(m);
    }
    geos.push(bg);
  }
  if (opts.scale) g.scale.setScalar(opts.scale);
  return { group: g, mats: [S, W], geos };
}

function buildInfantry(color) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 0.34, 0.42, 0.2, 0, 0.52, 0));               // torso
  geos.push(box(g, S, W, 0.12, 0.32, 0.16, -0.10, 0.16, 0));          // legs
  geos.push(box(g, S, W, 0.12, 0.32, 0.16,  0.10, 0.16, 0));
  const armGeo = new THREE.BoxGeometry(0.10, 0.30, 0.14);
  // /|\ stance — tops at the shoulders, bottoms flared outward
  for (const [ax, rz] of [[-0.22, -0.35], [0.22, 0.35]]) {
    for (const m of [new THREE.Mesh(armGeo, S), new THREE.Mesh(armGeo, W)]) {
      m.position.set(ax, 0.50, 0);
      m.rotation.z = rz;
      g.add(m);
    }
  }
  geos.push(armGeo);
  const headGeo = new THREE.SphereGeometry(0.15, 6, 5);
  for (const m of [new THREE.Mesh(headGeo, S), new THREE.Mesh(headGeo, W)]) {
    m.position.set(0, 0.88, 0);
    g.add(m);
  }
  geos.push(headGeo);
  return { group: g, mats: [S, W], geos };
}

function buildTruck(color, opts = {}) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 2.2, 1.2, 2.2, 0, 0.6, -0.75));  // bed
  geos.push(box(g, S, W, 2.0, 2.2, 1.6, 0, 1.1, 1.0));    // cab
  if (opts.dish) {
    const dishGeo = new THREE.ConeGeometry(0.65, 0.38, 8, 2, true);
    for (const m of [new THREE.Mesh(dishGeo, S), new THREE.Mesh(dishGeo, W)]) {
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 1.75, -0.75);
      g.add(m);
    }
    geos.push(dishGeo);
  }
  return { group: g, mats: [S, W], geos };
}

function buildAPC(color) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 2.6, 1.4, 4.2, 0, 0.7, 0));   // hull
  geos.push(box(g, S, W, 1.6, 0.6, 1.6, 0, 1.7, 0));   // turret
  geos.push(box(g, S, W, 0.12, 0.12, 0.55, 0, 1.7, 1.05)); // MG stub
  return { group: g, mats: [S, W], geos };
}

function buildBomber(color) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 1.6, 1.0, 7.0, 0, 0, 0));      // fuselage
  geos.push(box(g, S, W, 14.0, 0.25, 2.6, 0, 0, 0.6));  // wings
  geos.push(box(g, S, W, 5.0, 0.2, 1.4, 0, 0.1, -3.2)); // tailplane
  geos.push(box(g, S, W, 0.15, 1.5, 1.3, -2.4, 0.8, -3.2));
  geos.push(box(g, S, W, 0.15, 1.5, 1.3,  2.4, 0.8, -3.2));
  return { group: g, mats: [S, W], geos };
}

function buildDrone(color) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 0.9, 0.3, 1.8, 0, 0, 0));
  geos.push(box(g, S, W, 10.0, 0.12, 0.7, 0, 0, 0));
  geos.push(box(g, S, W, 3.0, 0.10, 0.45, 0, 0, -0.85));
  return { group: g, mats: [S, W], geos };
}

function buildTurret(color) {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 2.6, 0.7, 2.6, 0, 0.35, 0));   // pedestal
  const collarGeo = new THREE.CylinderGeometry(1.15, 1.45, 0.5, 8);
  for (const m of [new THREE.Mesh(collarGeo, S), new THREE.Mesh(collarGeo, W)]) {
    m.position.set(0, 0.9, 0);
    g.add(m);
  }
  geos.push(collarGeo);
  geos.push(box(g, S, W, 1.6, 0.7, 1.8, 0, 1.5, 0));    // turret
  const barrelGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.0, 4);
  for (const m of [new THREE.Mesh(barrelGeo, S), new THREE.Mesh(barrelGeo, W)]) {
    m.rotation.x = Math.PI / 2;
    m.position.set(0, 1.57, 2.3);
    g.add(m);
  }
  geos.push(barrelGeo);
  return { group: g, mats: [S, W], geos };
}

function buildHQ() {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color: 0xff3333, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 11, 7, 11, 0, 3.5, 0));       // main block
  geos.push(box(g, S, W, 6, 3.5, 6, 0, 8.75, 0));      // upper storey
  geos.push(box(g, S, W, 0.2, 3, 0.2, 0, 12, 0));      // mast
  geos.push(box(g, S, W, 5.5, 0.3, 0.2, 0, 4.2, 5.55)); // cross bar
  geos.push(box(g, S, W, 0.3, 3.5, 0.2, 0, 4.2, 5.55)); // cross post
  return { group: g, mats: [S, W], geos };
}

function buildTrench() {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color: 0x668855, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  geos.push(box(g, S, W, 2.2, 0.1, 16, 0, -1.2, 0));      // floor
  geos.push(box(g, S, W, 0.12, 1.2, 16,  1.1, -0.6, 0));  // walls
  geos.push(box(g, S, W, 0.12, 1.2, 16, -1.1, -0.6, 0));
  geos.push(box(g, S, W, 0.5, 0.35, 16,  1.4, 0.15, 0));  // parapet
  geos.push(box(g, S, W, 0.5, 0.35, 16, -1.4, 0.15, 0));
  return { group: g, mats: [S, W], geos };
}

function buildMine() {
  const S = new THREE.MeshBasicMaterial({ color: 0x440000 });
  const W = new THREE.MeshBasicMaterial({ color: 0xff2222, wireframe: true });
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.3, 8, 6);
  for (const [x, z] of [[0, 0], [0.9, 0.3], [-0.6, 0.7], [0.3, -0.8]]) {
    for (const m of [new THREE.Mesh(geo, S), new THREE.Mesh(geo, W)]) {
      m.position.set(x, 0.3, z);
      g.add(m);
    }
  }
  return { group: g, mats: [S, W], geos: [geo] };
}

function buildPowerUp(colorHex) {
  const W = new THREE.MeshBasicMaterial({ color: colorHex, wireframe: true });
  const g = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(0.9, 0);
  const m = new THREE.Mesh(geo, W);
  m.position.y = 1.3;
  g.add(m);
  return { group: g, mats: [W], geos: [geo], spin: m };
}

function buildMortarTeam() {
  const S = solidMat();
  const W = new THREE.MeshBasicMaterial({ color: RED, wireframe: true });
  const g = new THREE.Group();
  const geos = [];
  // Two crouched figures (shorter torsos)
  for (const ox of [-0.7, 0.7]) {
    geos.push(box(g, S, W, 0.34, 0.34, 0.2, ox, 0.32, -0.4));
    const headGeo = new THREE.SphereGeometry(0.14, 6, 5);
    for (const m of [new THREE.Mesh(headGeo, S), new THREE.Mesh(headGeo, W)]) {
      m.position.set(ox, 0.6, -0.4);
      g.add(m);
    }
    geos.push(headGeo);
  }
  // Mortar tube on a base plate
  geos.push(box(g, S, W, 0.7, 0.08, 0.7, 0, 0.04, 0.3));
  const tubeGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.1, 6);
  for (const m of [new THREE.Mesh(tubeGeo, S), new THREE.Mesh(tubeGeo, W)]) {
    m.position.set(0, 0.5, 0.3);
    m.rotation.x = -0.5;
    g.add(m);
  }
  geos.push(tubeGeo);
  return { group: g, mats: [S, W], geos };
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

    const scene  = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

    const disposables = [];
    const track = (built) => {
      disposables.push(built);
      return built;
    };

    // ---- Ground grid ----
    const gridSize = 130, gridDiv = 52;
    const grid = new THREE.GridHelper(gridSize, gridDiv, 0x00aa00, 0x004400);
    scene.add(grid);

    // ---- Exhibits ----
    // Each: { label, pos, built }  (label floats above)
    const exhibits = [];
    const place = (label, built, x, z, ry = 0, labelY = 3.2, y = 0) => {
      built.group.position.set(x, y, z);
      built.group.rotation.y = ry;
      scene.add(built.group);
      track(built);
      exhibits.push({ label, x, y: labelY, z, built });
    };

    // Row 1 — armour (faces the walkway)
    place('ENEMY TANK — LIGHT · 8 PTS',   buildTank(RED, { scale: 0.85 }), -24, -18, Math.PI);
    place('ENEMY TANK — MEDIUM · 10 PTS', buildTank(RED),                  -12, -18, Math.PI);
    place('ENEMY TANK — HEAVY · 15 PTS',  buildTank(RED, { scale: 1.25 }),   0, -18, Math.PI);
    place('YOUR TANK',                    buildTank(BLUE),                  14, -18, Math.PI);

    // Row 2 — ground forces
    place('INFANTRY · 1 PT',    buildInfantry(RED),          -24, -6, Math.PI, 2.2);
    place('SUPPLY TRUCK · DROPS POWER-UP', buildTruck(GREY), -14, -6, Math.PI);
    place('APC · 5 PTS · DEPLOYS INFANTRY', buildAPC(0xff6666), -2, -6, Math.PI);
    place('JAMMER · 5 PTS · SCRAMBLES SENSORS', buildTruck(0xff2222, { dish: true }), 10, -6, Math.PI);
    place('MINEFIELD — KEEP CLEAR', buildMine(), 20, -6, 0, 1.8);
    place('TURRET EMPLACEMENT · 6 PTS', buildTurret(RED), 28, -18, Math.PI);
    place('ENEMY HQ · 10 SHOTS · 40 PTS', buildHQ(), 44, -30, Math.PI, 15);
    place('TRENCH — INFANTRY COVER', buildTrench(), -34, -6, Math.PI / 2, 2.5);

    // Row 3 — air
    place('BOMBER · 20 PTS · SHOOT IT DOWN', buildBomber(RED), -14, 6, Math.PI * 0.5, 10.5, 7);
    place('YOUR DRONE · SPOTS FOR THE MINIMAP · R TO RETASK', buildDrone(GREEN), 4, 6, 0, 7.5, 5);

    // Row 4 — power-ups (spinning)
    const spinners = [];
    let px = -24;
    for (const [key, def] of Object.entries(POWERUP.types)) {
      const pu = buildPowerUp(def.color);
      place(def.label, pu, px, 16, 0, 3.0);
      spinners.push(pu.spin);
      px += 9;
    }

    // ---- Prototype range (east side, roped off) ----
    const ropeMat = new THREE.LineBasicMaterial({ color: 0xffff00 });
    const ropePts = [
      new THREE.Vector3(34, 0.8, -30), new THREE.Vector3(34, 0.8, 30),
    ];
    const ropeGeo = new THREE.BufferGeometry().setFromPoints(ropePts);
    scene.add(new THREE.Line(ropeGeo, ropeMat));
    exhibits.push({ label: '⚠ PROTOTYPE RANGE — CONCEPTS UNDER EVALUATION', x: 44, y: 6.5, z: 0 });

    place('CONCEPT: TWIN-BARREL TANK', buildTank(BLUE, { twinBarrel: true }), 44, -16, -Math.PI / 2);
    place('CONCEPT: MORTAR TEAM',      buildMortarTeam(), 44, -4, -Math.PI / 2, 1.8);
    const shield = buildPowerUp(0x88ffff);
    place('CONCEPT: SHIELD POWER-UP',  shield, 44, 6, 0, 3.0);
    spinners.push(shield.spin);
    place('CONCEPT: MEDIC TRUCK — DO NOT FIRE', buildTruck(0xffffff), 44, 16, -Math.PI / 2);

    // ---- The visitor: small blue infantry figure ----
    const figure = track(buildInfantry(BLUE));
    figure.group.position.set(0, 0, 26);
    scene.add(figure.group);
    const player = { x: 0, z: 26, heading: Math.PI }; // facing the exhibits

    // ---- Input (capture phase so the game underneath never sees it) ----
    const keys = new Set();
    const onKeyDown = (e) => {
      if (e.code === 'Escape') { e.stopPropagation(); onBack(); return; }
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

      // Walk
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
      figure.group.position.set(player.x, 0, player.z);
      figure.group.rotation.y = player.heading;

      // Third-person follow camera
      const camX = player.x - Math.sin(player.heading) * 7;
      const camZ = player.z - Math.cos(player.heading) * 7;
      camera.position.set(camX, 4.2, camZ);
      camera.lookAt(player.x + Math.sin(player.heading) * 4, 1.2, player.z + Math.cos(player.heading) * 4);

      // Spin the power-ups
      for (const s of spinners) s.rotation.y += dt * 1.4;

      // Project labels
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
          const sx = (v3.x * 0.5 + 0.5) * window.innerWidth;
          const sy = (-v3.y * 0.5 + 0.5) * window.innerHeight;
          el.style.display = behind ? 'none' : 'block';
          el.style.left = `${sx}px`;
          el.style.top  = `${sy}px`;
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
      for (const b of disposables) {
        for (const m of b.mats ?? []) m.dispose();
        for (const g of b.geos ?? []) g.dispose();
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
      {/* 3D museum canvas */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {/* Floating exhibit labels */}
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{
        position: 'absolute', top: 16, left: 0, right: 0, textAlign: 'center',
        color: '#00ff00', fontFamily: 'monospace', pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 24, letterSpacing: 6, fontWeight: 'bold' }}>AREA X — FIELD MANUAL</div>
        <div style={{ fontSize: 11, color: '#00aa00', marginTop: 4 }}>WALK THE FLOOR · W/S MOVE · A/D TURN · ESC TO RETURN</div>
      </div>

      {/* Commands list */}
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
        <div>CLICK — MAIN GUN</div>
        <div>X — MACHINE GUN</div>
        <div>, / . — BARREL ELEVATION</div>
        <div>P — FIRST / THIRD PERSON</div>
        <div>R — RETASK DRONE</div>
        <div>Q / E — ORBIT CAMERA</div>
        <div>ESC — PAUSE MENU</div>
      </div>

      {/* Version / date */}
      <div style={{
        position: 'absolute', right: 16, bottom: 14, color: '#008800',
        fontFamily: 'monospace', fontSize: 11, letterSpacing: 2, pointerEvents: 'none',
      }}>
        WIREZONE v{APP.version} — {APP.date}
      </div>

      <button
        className="wireframe-btn"
        onClick={onBack}
        style={{ position: 'absolute', left: 16, bottom: 14 }}
      >
        BACK
      </button>
    </div>
  );
}
