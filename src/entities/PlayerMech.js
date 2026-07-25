import * as THREE from 'three';
import { MECH, TANK } from '../utils/constants.js';
import Tank from './Tank.js';

/**
 * PlayerMech — a two-legged walker chassis for the player.
 *
 * It subclasses Tank so it inherits every combat system unchanged (ammo,
 * armour, reload, firing, first-person, destruction) and overrides only the
 * body and how it moves/aims:
 *
 *   • A tall, slim biped: two jointed legs → pelvis → a ball joint → the HEAD,
 *     an open-front cockpit with the driver up top and the cannon fixed centred
 *     beneath. The camera looks straight out of the open cockpit.
 *   • The cannon does not traverse on its own — the whole head aims on the ball
 *     joint, limited to ±80° yaw and ±45° pitch. Beyond that you turn the hull.
 *   • A procedural walk cycle whose stride tracks speed; the torso bobs and
 *     rolls, so the cockpit view naturally swings with each step.
 *   • Ravine traversal: it steps into/over ravines a tank must avoid, riding
 *     the higher of its fore/aft footfalls to bridge narrow ones.
 */
export default class PlayerMech extends Tank {
  // --- Model ----------------------------------------------------------------

  /** Adds a solid+wireframe pair sharing one geometry; tracks it for dispose. */
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
    const w = MECH.legWidth;
    const root = new THREE.Group();
    root.position.set(side * MECH.legSpread, MECH.bodyHeight, 0);
    this._detail(new THREE.BoxGeometry(w + 0.2, 0.5, 0.5), root, 0, 0, 0); // hip actuator

    const hip = new THREE.Group();
    root.add(hip);
    this._detail(new THREE.BoxGeometry(w, MECH.thigh, w), hip, 0, -MECH.thigh / 2, 0);

    const knee = new THREE.Group();
    knee.position.y = -MECH.thigh;
    hip.add(knee);
    this._detail(new THREE.BoxGeometry(w + 0.06, 0.32, w + 0.06), knee, 0, 0, 0);          // knee
    this._detail(new THREE.BoxGeometry(w - 0.04, MECH.shin, w - 0.04), knee, 0, -MECH.shin / 2, 0.02); // shin
    this._detail(new THREE.BoxGeometry(0.6, 0.22, 1.3), knee, 0, -MECH.shin + 0.05, 0.3);  // foot

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

    // ---- Legs (planted on the root; the torso bobs above them) ----
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = this._buildLeg(side);
      this.group.add(leg.root);
      this.legs.push(leg);
    }

    // ---- Body pivot: pelvis + neck + ball joint; bobs/sways with the gait ----
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = MECH.bodyHeight;
    this.group.add(this.bodyPivot);

    this._detail(new THREE.BoxGeometry(MECH.legSpread * 2 + 0.3, 0.55, 0.9),
      this.bodyPivot, 0, 0, 0);                                            // pelvis
    this._detail(new THREE.CylinderGeometry(0.16, 0.2, MECH.neck, 6),
      this.bodyPivot, 0, MECH.neck / 2, 0);                               // neck / spine
    this._detail(new THREE.SphereGeometry(0.34, 8, 6),
      this.bodyPivot, 0, MECH.neck, 0);                                   // ball joint

    // ---- Head: yaws about the ball joint (turretPivot), pitches about the
    //      same point (barrelElevPivot). Cockpit above, cannon below. ----
    this.turretPivot = new THREE.Group();
    this.turretPivot.position.set(0, MECH.neck, 0);
    this.bodyPivot.add(this.turretPivot);

    this.barrelElevPivot = new THREE.Group();          // whole-head pitch pivot
    this.turretPivot.add(this.barrelElevPivot);

    const T = MECH.torso;
    // Cockpit shell = the armoured "hull" box (open to the front for the view)
    const cockGeo = new THREE.BoxGeometry(T.width, T.height, T.depth);
    this.hullSolidMesh = new THREE.Mesh(cockGeo, this._hullFaceMats);
    this.hullMesh      = new THREE.Mesh(cockGeo, this._wireMat);
    this.hullSolidMesh.position.y = MECH.cockpitRise;
    this.hullMesh.position.y      = MECH.cockpitRise;
    this.barrelElevPivot.add(this.hullSolidMesh);
    this.barrelElevPivot.add(this.hullMesh);

    // Cockpit detailing — canopy rim, seat, driver (all behind the eye point)
    this._detail(new THREE.BoxGeometry(T.width + 0.1, 0.06, T.depth + 0.1),
      this.barrelElevPivot, 0, MECH.cockpitRise + T.height / 2, -0.05);   // roof rim
    this._detail(new THREE.SphereGeometry(0.19, 6, 5),
      this.barrelElevPivot, 0, MECH.cockpitRise - 0.1, -0.35);            // driver head
    this._detail(new THREE.BoxGeometry(0.6, 0.5, 0.1),
      this.barrelElevPivot, 0, MECH.cockpitRise - 0.35, -0.55);          // seat back

    // Fixed cannon, centred BELOW the cockpit
    const gunHouseGeo = new THREE.BoxGeometry(0.9, 0.7, 1.0);
    this._detail(gunHouseGeo, this.barrelElevPivot, 0, -MECH.cannonDrop, MECH.cannonFwd);
    const barrelGeo = new THREE.CylinderGeometry(
      TANK.barrel.radius, TANK.barrel.radius, TANK.barrel.length, 4,
    );
    // barrel (solid+wire) — expose barrelMesh/barrelSolidMesh so Tank.dispose frees it
    this.barrelSolidMesh = new THREE.Mesh(barrelGeo, this._solidMat);
    this.barrelMesh      = new THREE.Mesh(barrelGeo, this._wireMat);
    for (const m of [this.barrelSolidMesh, this.barrelMesh]) {
      m.rotation.x = Math.PI / 2;
      m.position.set(0, -MECH.cannonDrop, MECH.cannonFwd + TANK.barrel.length / 2);
      this.barrelElevPivot.add(m);
    }
    const muzzleGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.4, 5);
    this._detail(muzzleGeo, this.barrelElevPivot, 0, -MECH.cannonDrop,
      MECH.cannonFwd + TANK.barrel.length - 0.1, Math.PI / 2, 0, 0);

    // ---- Driver eye: at the open front of the cockpit, looking out ----
    this.eyeAnchor = new THREE.Object3D();
    this.eyeAnchor.position.set(0, MECH.cockpitRise + MECH.eyeUp, MECH.eyeFwd);
    this.barrelElevPivot.add(this.eyeAnchor);
  }

  // --- Orientation ----------------------------------------------------------

  /** A walker stays upright — only its heading turns the body. */
  _applyTransform() {
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.heading, 0);
  }

  // --- Aim: limited-traverse ball-joint head --------------------------------

  _elevLimits() { return { min: -MECH.headPitchLimit, max: MECH.headPitchLimit }; }
  _yawLimit()   { return MECH.headYawLimit; }
  _turretTraverseSpeed() { return MECH.headTurnSpeed; }

  /** Direct head control — mouse steers the head within its arc, no world-lock. */
  _firstPersonLook(d) {
    const SENS = 0.0022;
    const yl = this._yawLimit();
    const { min, max } = this._elevLimits();
    this.turretTargetAngle = Math.max(-yl, Math.min(yl, this.turretTargetAngle - d.x * SENS));
    this._elevation        = Math.max(min, Math.min(max, this._elevation - d.y * SENS));
  }

  /** Muzzle world position — the cannon sits below the ball-joint pivot. */
  getBarrelTip() {
    this.group.updateWorldMatrix(true, true);
    const localTip = new THREE.Vector3(0, -MECH.cannonDrop, MECH.cannonFwd + TANK.barrel.length);
    return this.barrelElevPivot.localToWorld(localTip);
  }

  // --- Traversal ------------------------------------------------------------

  _movementFlags() {
    return { avoidDeep: false, relaxSlope: true };
  }

  /**
   * Body height = ride the higher of the fore/aft footfalls, so a narrow
   * ravine is bridged (a foot on each rim) and a wide one is descended.
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
    this._walkPhase += this.speed * delta * MECH.strideRate;
    const ph = this._walkPhase;
    const k  = Math.min(1, MECH.ease * delta);

    // Legs swing in anti-phase; the knee bends as its leg lifts forward.
    for (const leg of this.legs) {
      const phase = ph + (leg.side < 0 ? 0 : Math.PI);
      const swingTarget = Math.sin(phase) * MECH.swingAmp * speedFrac;
      const kneeTarget  = MECH.kneeIdle + Math.max(0, Math.sin(phase)) * MECH.kneeAmp * speedFrac;
      leg.hip.rotation.x  += (swingTarget - leg.hip.rotation.x) * k;
      leg.knee.rotation.x += (kneeTarget  - leg.knee.rotation.x) * k;
    }

    // Torso bob (twice per stride) + roll/pitch sway, fading with speed. This
    // physically moves the cockpit — and with it the driver's eye anchor.
    const bobTarget   = Math.sin(ph * 2) * MECH.bobAmp   * speedFrac;
    const rollTarget  = Math.sin(ph)     * MECH.rollAmp  * speedFrac;
    const pitchTarget = Math.cos(ph * 2) * MECH.pitchAmp * speedFrac;
    this.bodyPivot.position.y += ((MECH.bodyHeight + bobTarget) - this.bodyPivot.position.y) * k;
    this.bodyPivot.rotation.z += (rollTarget  - this.bodyPivot.rotation.z) * k;
    this.bodyPivot.rotation.x += (pitchTarget - this.bodyPivot.rotation.x) * k;

    // A little rotational swing on top of the eye's physical bob.
    this._viewBob.dyaw   = Math.sin(ph)     * MECH.viewYawAmp   * speedFrac;
    this._viewBob.dpitch = Math.cos(ph * 2) * MECH.viewPitchAmp * speedFrac;
    this._viewBob.droll  = Math.sin(ph)     * MECH.viewRollAmp  * speedFrac;
  }

  // --- Camera hooks ----------------------------------------------------------

  /** World position of the driver's eye, at the open front of the cockpit. */
  getEyeWorld() {
    return this.eyeAnchor.getWorldPosition(new THREE.Vector3());
  }

  getViewBob() { return this._viewBob; }
}
