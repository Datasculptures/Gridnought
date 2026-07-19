import * as THREE from 'three';
import { JAMMER } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * Jammer Truck — bright red, 1 HP, no weapons.
 * While alive and within JAMMER.jamRadius world-units of the player,
 * enemy entities flicker intermittently (handled by GameManager).
 *
 * Visual: cab-over truck body + radar dish (cone) + vertical antenna.
 */
export default class JammerTruck {
  constructor(scene, config) {
    this.scene             = scene;
    this.terrain           = config.terrain;
    this.movementValidator = config.movementValidator;
    this.mineManager       = config.mineManager || null;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading     = Math.random() * Math.PI * 2;
    this.speed       = 0;
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;

    // Unified entity metadata (EntityManager contract)
    this.kind           = 'jammer';
    this.faction        = 'enemy';
    this.hitRadius      = JAMMER.hitRadius;
    this.scoreValue     = 5;
    this.blocksMovement = true;

    // Waypoint navigation
    this._waypoint     = new THREE.Vector3();
    this._waypointTime = 0;
    this._stuckTimer   = 0;
    this._lastPos      = this.position.clone();
    this._reverseTimer = 0;

    this.destructionEffect = null;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this._pickWaypoint();

    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  // ---------------------------------------------------------------------------
  // Mesh — red truck + radar dish (open cone) + antenna
  // ---------------------------------------------------------------------------

  _buildMesh() {
    const S = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const W = new THREE.MeshBasicMaterial({ color: JAMMER.color, wireframe: true });
    this._solidMat = S;
    this._wireMat  = W;
    this.group = new THREE.Group();

    const h = JAMMER.hull;
    const c = JAMMER.cab;
    const bedD = h.depth * 0.58;
    const bedZ = -h.depth * 0.21;
    const cabH = h.height + c.height;
    const cabZ = h.depth * 0.29;

    // Cargo bed
    this._box(h.width, h.height, bedD,  0, h.height / 2, bedZ, S, W);

    // Cab
    this._box(c.width, cabH, c.depth,  0, cabH / 2, cabZ, S, W);

    // Windshield recess
    this._box(c.width * 0.75, cabH * 0.38, 0.12,  0, cabH * 0.67, cabZ + c.depth / 2, S, W);

    // Bed side rails
    const rW = 0.1, rH = 0.26, rD = bedD * 0.85;
    const rX = h.width / 2 + rW / 2;
    this._box(rW, rH, rD,  rX, h.height + rH / 2, bedZ, S, W);
    this._box(rW, rH, rD, -rX, h.height + rH / 2, bedZ, S, W);

    // Wheels
    const wW = 0.28, wH = 0.44, wD = 0.52;
    const wY = wH / 2 - 0.05;
    const wX = h.width / 2 + wW / 2;
    this._box(wW, wH, wD,  wX, wY, cabZ + 0.35, S, W);
    this._box(wW, wH, wD, -wX, wY, cabZ + 0.35, S, W);
    this._box(wW, wH, wD,  wX, wY, bedZ - 0.25, S, W);
    this._box(wW, wH, wD, -wX, wY, bedZ - 0.25, S, W);

    // Bumper
    this._box(h.width + 0.2, 0.18, 0.14,  0, 0.22, cabZ + c.depth / 2 + 0.07, S, W);

    // --- Radar equipment on bed ---
    const equipBaseY = h.height;

    // Equipment mount/pedestal box on the bed
    this._box(0.55, 0.45, 0.55,  0, equipBaseY + 0.23, bedZ, S, W);

    // Radar dish — open cone (wireframe shows as lattice)
    // ConeGeometry(radius, height, radialSegments, heightSegments, openEnded)
    const dishGeo = new THREE.ConeGeometry(0.65, 0.38, 8, 2, true);
    const dishS   = new THREE.Mesh(dishGeo, S);
    const dishW   = new THREE.Mesh(dishGeo, W);
    const dishY   = equipBaseY + 0.46 + 0.19; // top of pedestal + half dish height
    // Tilt forward to face upward-and-forward (rotate X so opening faces up)
    dishS.rotation.x = -Math.PI / 2;
    dishW.rotation.x = -Math.PI / 2;
    dishS.position.set(0, dishY, bedZ);
    dishW.position.set(0, dishY, bedZ);
    this.group.add(dishS, dishW);

    // Dish rim — torus at the open edge of the cone
    const rimGeo = new THREE.TorusGeometry(0.65, 0.06, 4, 10);
    const rimS   = new THREE.Mesh(rimGeo, S);
    const rimW   = new THREE.Mesh(rimGeo, W);
    rimS.position.set(0, dishY + 0.19, bedZ);
    rimW.position.set(0, dishY + 0.19, bedZ);
    this.group.add(rimS, rimW);

    // Support arm — horizontal strut behind dish
    this._box(0.08, 0.08, 0.5,  0, dishY, bedZ - 0.25, S, W);

    // Vertical antenna — thin tall box
    this._box(0.07, 1.1, 0.07,  0.6, equipBaseY + 0.55, bedZ + 0.1, S, W);

    // Small crossbar on antenna
    this._box(0.35, 0.06, 0.06,  0.6, equipBaseY + 1.45, bedZ + 0.1, S, W);
  }

  _box(w, h, d, x, y, z, S, W) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const ms  = new THREE.Mesh(geo, S);
    const mw  = new THREE.Mesh(geo, W);
    ms.position.set(x, y, z);
    mw.position.set(x, y, z);
    this.group.add(ms, mw);
  }

  _applyTransform() {
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    const normal  = this.terrain.getNormalAt(this.position.x, this.position.z);
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const up      = normal.normalize();
    const right   = new THREE.Vector3().crossVectors(up, forward).normalize();
    const fwd     = new THREE.Vector3().crossVectors(right, up).normalize();
    this.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, fwd),
    );
  }

  // ---------------------------------------------------------------------------
  // Waypoint navigation
  // ---------------------------------------------------------------------------

  _pickWaypoint() {
    // Wander: random point 20–70 units from the current position
    const ang = Math.random() * Math.PI * 2;
    const r   = 20 + Math.random() * 50;
    this._waypoint.set(
      this.position.x + Math.sin(ang) * r,
      0,
      this.position.z + Math.cos(ang) * r,
    );
    const dist = Math.sqrt(
      (this._waypoint.x - this.position.x) ** 2 +
      (this._waypoint.z - this.position.z) ** 2,
    );
    this._waypointTime = Math.max(6, dist / JAMMER.moveSpeed + 3);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta, _ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }

    const dx   = this._waypoint.x - this.position.x;
    const dz   = this._waypoint.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    this._turnToward(Math.atan2(dx, dz), delta);
    this.speed = JAMMER.moveSpeed;

    this._waypointTime -= delta;
    if (dist < 4 || this._waypointTime <= 0) this._pickWaypoint();

    this._stuckTimer += delta;
    if (this._stuckTimer >= 1.0) {
      if (this.position.distanceTo(this._lastPos) < 0.5) this._pickWaypoint();
      this._lastPos.copy(this.position);
      this._stuckTimer = 0;
    }

    // Movement — briefly reverse when blocked to escape obstacles
    if (this._reverseTimer > 0) {
      this._reverseTimer -= delta;
      const rx = this.position.x - Math.sin(this.heading) * this.speed * 0.5 * delta;
      const rz = this.position.z - Math.cos(this.heading) * this.speed * 0.5 * delta;
      if (this.movementValidator.canMoveTo(this.position.x, this.position.z, rx, rz, true).allowed) {
        this.position.x = rx;
        this.position.z = rz;
      }
    } else {
      const nx = this.position.x + Math.sin(this.heading) * this.speed * delta;
      const nz = this.position.z + Math.cos(this.heading) * this.speed * delta;
      const check    = this.movementValidator.canMoveTo(this.position.x, this.position.z, nx, nz, true);
      const mineSafe = !this.mineManager || !this.mineManager.isMineNearby(nx, nz);
      const vFree    = !this.movementValidator.isVehicleBlocked(nx, nz, this);
      if (check.allowed && mineSafe && vFree) {
        this.position.x = nx;
        this.position.z = nz;
      } else {
        this._pickWaypoint();
        this._reverseTimer = 0.7;
      }
    }

    this._applyTransform();
  }

  _turnToward(targetHeading, delta) {
    let diff = ((targetHeading - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), JAMMER.turnSpeed * delta);
    this.heading  = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns true if this jammer is alive and within range of the given position. */
  isJammingPosition(px, pz) {
    if (!this.isAlive) return false;
    const dx = this.position.x - px;
    const dz = this.position.z - pz;
    return (dx * dx + dz * dz) <= JAMMER.jamRadius * JAMMER.jamRadius;
  }

  getHitCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + JAMMER.hitYOffset, this.position.z);
  }

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), JAMMER.color);
    return true;
  }

  reset(pos) {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    this.position.set(pos.x, 0, pos.z);
    this.position.y  = this.terrain.getHeightAt(pos.x, pos.z);
    this.heading     = Math.random() * Math.PI * 2;
    this.speed       = 0;
    this.isAlive     = true;
    this.isDestroyed   = false;
    this._stuckTimer   = 0;
    this._reverseTimer = 0;
    this._lastPos.copy(this.position);
    this._pickWaypoint();
    if (this.group) this.group.visible = true;
    this._applyTransform();
  }

  dispose() {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
      this.group = null;
    }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat  = null; }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    this.scene = null; this.terrain = null; this.movementValidator = null; this.mineManager = null;
  }
}
