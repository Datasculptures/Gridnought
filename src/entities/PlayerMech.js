import * as THREE from 'three';
import { MECH, TANK } from '../utils/constants.js';
import Tank from './Tank.js';

/**
 * PlayerMech — a two-legged walker chassis for the player.
 *
 * It subclasses Tank so it inherits every combat system unchanged: turret
 * aiming, barrel elevation, the MG/HE/AP ammunition, armour zones, reload,
 * first-person mode, and destruction. What it overrides is purely the body:
 *
 *   • an articulated model — an armoured torso on two jointed legs, the driver
 *     up in a cockpit with the traversing gun slung BELOW them;
 *   • a procedural walk cycle whose stride length tracks travel speed, with the
 *     torso bobbing and rolling on each step;
 *   • a first-person camera that sways with the gait (getViewBob);
 *   • ravine traversal — the legs let it step over narrow ravines (riding the
 *     higher footfall) and descend into wide ones, and steep slopes that stop a
 *     tank don't stop it.
 */
export default class PlayerMech extends Tank {
  // --- Model ----------------------------------------------------------------

  /** Adds a solid+wireframe pair sharing one geometry; tracks the geo for dispose. */
  _detail(geo, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
    this._extraGeos.push(geo);
    for (const mat of [this._solidMat, this._wireMat]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
    }
  }

  /** One articulated leg: hip → thigh → knee → shin → foot. */
  _buildLeg(side) {
    const root = new THREE.Group();
    root.position.set(side * MECH.legSpread, MECH.bodyHeight, 0);

    this._detail(new THREE.BoxGeometry(0.7, 0.7, 0.7), root, 0, 0, 0); // hip actuator

    const hip = new THREE.Group();
    root.add(hip);
    this._detail(new THREE.BoxGeometry(0.42, MECH.thigh, 0.42), hip, 0, -MECH.thigh / 2, 0);

    const knee = new THREE.Group();
    knee.position.y = -MECH.thigh;
    hip.add(knee);
    this._detail(new THREE.BoxGeometry(0.34, MECH.shin, 0.34), knee, 0, -MECH.shin / 2, 0.02);
    this._detail(new THREE.BoxGeometry(0.36, 0.36, 0.36), knee, 0, 0, 0);            // knee joint
    this._detail(new THREE.BoxGeometry(0.8, 0.28, 1.5), knee, 0, -MECH.shin + 0.1, 0.35); // foot

    return { root, hip, knee, side };
  }

  _buildMesh(color) {
    this._walkPhase = 0;
    this._viewBob   = { dy: 0, dyaw: 0, dpitch: 0, droll: 0 };

    // Materials — mirror Tank so armour recolouring + dispose work unchanged
    this._wireMat  = new THREE.MeshBasicMaterial({ color, wireframe: true });
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this._hullFaceMats = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({
      color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    this._extraGeos = [];

    this.group = new THREE.Group();

    // ---- Legs (attached to the root so the hips stay planted while the torso
    //      bobs above them like suspension) ----
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = this._buildLeg(side);
      this.group.add(leg.root);
      this.legs.push(leg);
    }
    // Pelvis yoke bridging the two hips
    this._detail(new THREE.BoxGeometry(MECH.legSpread * 2 + 0.4, 0.5, 1.0),
      this.group, 0, MECH.bodyHeight, 0);

    // ---- Body pivot: the torso assembly that bobs / rolls / pitches ----
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = MECH.bodyHeight;
    this.group.add(this.bodyPivot);

    const T = MECH.torso;
    // Armoured torso — the box carrying the 6 per-face armour materials
    const torsoGeo = new THREE.BoxGeometry(T.width, T.height, T.depth);
    this.hullSolidMesh = new THREE.Mesh(torsoGeo, this._hullFaceMats);
    this.hullMesh      = new THREE.Mesh(torsoGeo, this._wireMat);
    this.bodyPivot.add(this.hullSolidMesh);
    this.bodyPivot.add(this.hullMesh);

    // Driver cockpit up top, open roll-cage with a helmeted driver inside
    const cabY = T.height / 2 + 0.5;
    this._detail(new THREE.BoxGeometry(1.5, 0.95, 1.5), this.bodyPivot, 0, cabY, 0.35);   // cab shell
    this._detail(new THREE.BoxGeometry(1.55, 0.05, 1.55), this.bodyPivot, 0, cabY + 0.5, 0.35); // canopy roof
    for (const sx of [-0.72, 0.72]) {                                                     // cage pillars
      this._detail(new THREE.BoxGeometry(0.06, 1.0, 0.06), this.bodyPivot, sx, cabY, 0.35 - 0.7);
      this._detail(new THREE.BoxGeometry(0.06, 1.0, 0.06), this.bodyPivot, sx, cabY, 0.35 + 0.7);
    }
    this._detail(new THREE.SphereGeometry(0.2, 6, 5), this.bodyPivot, 0, cabY + 0.12, 0.5); // driver head
    this._detail(new THREE.BoxGeometry(0.26, 0.08, 0.06), this.bodyPivot, 0, cabY + 0.14, 0.68); // visor

    // Twin autocannon flanking the cockpit shoulders (cosmetic — the Sentinel cue)
    const acGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.6, 5);
    for (const sx of [-0.55, 0.55]) {
      this._extraGeos.push(acGeo);
      for (const mat of [this._solidMat, this._wireMat]) {
        const m = new THREE.Mesh(acGeo, mat);
        m.rotation.x = Math.PI / 2;
        m.position.set(sx, cabY + 0.55, -0.2);
        this.bodyPivot.add(m);
      }
    }

    // ---- Turret pivot: the traversing main gun, slung BELOW the driver ----
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, -T.height / 2 + 0.35, 0.15);
    this.bodyPivot.add(this.turretPivot);

    const gunHouseGeo = new THREE.BoxGeometry(1.3, 0.85, 1.15);
    this.turretSolidMesh = new THREE.Mesh(gunHouseGeo, this._solidMat);
    this.turretMesh      = new THREE.Mesh(gunHouseGeo, this._wireMat);
    this.turretPivot.add(this.turretSolidMesh);
    this.turretPivot.add(this.turretMesh);
    this._detail(new THREE.BoxGeometry(0.85, 0.55, 0.35), this.turretPivot, 0, 0, 0.6); // mantlet

    // ---- Barrel elevation pivot (reuses the tank barrel dimensions) ----
    this.barrelElevPivot = new THREE.Group();
    this.barrelElevPivot.position.set(0, 0, 0.6);
    this.turretPivot.add(this.barrelElevPivot);

    const barrelGeo = new THREE.CylinderGeometry(
      TANK.barrel.radius, TANK.barrel.radius, TANK.barrel.length, 4,
    );
    this.barrelSolidMesh = new THREE.Mesh(barrelGeo, this._solidMat);
    this.barrelSolidMesh.rotation.x = Math.PI / 2;
    this.barrelSolidMesh.position.set(0, 0, TANK.barrel.length / 2);
    this.barrelMesh = new THREE.Mesh(barrelGeo, this._wireMat);
    this.barrelMesh.rotation.x = Math.PI / 2;
    this.barrelMesh.position.set(0, 0, TANK.barrel.length / 2);
    this.barrelElevPivot.add(this.barrelSolidMesh);
    this.barrelElevPivot.add(this.barrelMesh);

    // Muzzle brake + sleeve (elevate with the gun)
    const sleeveGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.6, 5);
    const muzzleGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.4, 5);
    for (const [geo, z] of [[sleeveGeo, 0.45], [muzzleGeo, TANK.barrel.length - 0.1]]) {
      this._extraGeos.push(geo);
      for (const mat of [this._solidMat, this._wireMat]) {
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = Math.PI / 2;
        m.position.set(0, 0, z);
        this.barrelElevPivot.add(m);
      }
    }
  }

  // --- Orientation ----------------------------------------------------------

  /**
   * A walker stays upright — only its heading turns the body. (Tanks conform
   * to the terrain normal; a biped keeps the torso level and lets the legs
   * absorb the ground.)
   */
  _applyTransform() {
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.heading, 0);
  }

  // --- Traversal ------------------------------------------------------------

  /** The walker takes any slope and may step into ravines the tank avoids. */
  _movementFlags() {
    return { avoidDeep: false, relaxSlope: true };
  }

  /**
   * Body height = ride the higher of the fore/aft footfalls, so a narrow
   * ravine is bridged (a foot on each rim) rather than fallen into, and a
   * wide one is descended gradually.
   */
  _supportHeight() {
    const t = this.terrain;
    const s = MECH.strideReach;
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const hC = t.getHeightAt(this.position.x, this.position.z);
    const hF = t.getHeightAt(this.position.x + sinH * s, this.position.z + cosH * s);
    const hB = t.getHeightAt(this.position.x - sinH * s, this.position.z - cosH * s);
    return Math.max(hC, (hF + hB) / 2) + MECH.groundOffset;
  }

  // --- Gait + camera sway ----------------------------------------------------

  _postUpdate(delta) {
    const speedFrac = Math.min(1, Math.abs(this.speed) / TANK.moveSpeed);
    // Advance the walk phase by distance travelled → stride tracks speed and
    // reverses correctly when backing up.
    this._walkPhase += this.speed * delta * MECH.strideRate;
    const ph = this._walkPhase;
    const k  = Math.min(1, MECH.ease * delta); // ease-toward factor

    // Legs swing in anti-phase; the knee bends as its leg lifts forward.
    for (const leg of this.legs) {
      const phase = ph + (leg.side < 0 ? 0 : Math.PI);
      const swingTarget = Math.sin(phase) * MECH.swingAmp * speedFrac;
      const kneeTarget  = MECH.kneeIdle
        + Math.max(0, Math.sin(phase)) * MECH.kneeAmp * speedFrac;
      leg.hip.rotation.x  += (swingTarget - leg.hip.rotation.x) * k;
      leg.knee.rotation.x += (kneeTarget  - leg.knee.rotation.x) * k;
    }

    // Torso bob (twice per stride) + roll/pitch sway, all fading with speed.
    const bobTarget   = MECH.bodyHeight + Math.sin(ph * 2) * MECH.bobAmp   * speedFrac;
    const rollTarget  = Math.sin(ph)     * MECH.rollAmp  * speedFrac;
    const pitchTarget = Math.cos(ph * 2) * MECH.pitchAmp * speedFrac;
    this.bodyPivot.position.y += (bobTarget   - this.bodyPivot.position.y) * k;
    this.bodyPivot.rotation.z += (rollTarget  - this.bodyPivot.rotation.z) * k;
    this.bodyPivot.rotation.x += (pitchTarget - this.bodyPivot.rotation.x) * k;

    // The walk you feel through the cockpit — a fraction reaches the camera.
    this._viewBob.dy     = Math.sin(ph * 2) * MECH.viewBobAmp   * speedFrac;
    this._viewBob.dyaw   = Math.sin(ph)     * MECH.viewYawAmp   * speedFrac;
    this._viewBob.dpitch = Math.cos(ph * 2) * MECH.viewPitchAmp * speedFrac;
    this._viewBob.droll  = Math.sin(ph)     * MECH.viewRollAmp  * speedFrac;
  }

  // --- Camera hooks ----------------------------------------------------------

  getEyeOffset() { return MECH.eyeOffset; }
  getViewBob()   { return this._viewBob; }
}
