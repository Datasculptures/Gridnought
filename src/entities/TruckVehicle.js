import * as THREE from 'three';
import { TRUCK, WORLD_SIZE } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * A wandering grey truck — 1 HP, no weapons.
 * Navigates to random waypoints across the map instead of turning in place.
 */
export default class TruckVehicle {
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
    this.kind           = 'truck';
    this.faction        = 'neutral';
    this.hitRadius      = TRUCK.hitRadius;
    this.scoreValue     = 0;
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
  // Mesh — cab-over truck with wheels, side rails, exhaust
  // ---------------------------------------------------------------------------

  _buildMesh() {
    const S = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const W = new THREE.MeshBasicMaterial({ color: TRUCK.color, wireframe: true });
    this._solidMat = S;
    this._wireMat  = W;
    this.group = new THREE.Group();

    const h = TRUCK.hull;
    const c = TRUCK.cab;
    const bedD = h.depth * 0.58;
    const bedZ = -h.depth * 0.21;
    const cabH = h.height + c.height;
    const cabZ = h.depth * 0.29;

    // Cargo bed
    this._box(h.width, h.height, bedD,  0, h.height / 2, bedZ, S, W);

    // Cab (taller box at front)
    this._box(c.width, cabH, c.depth,   0, cabH / 2, cabZ, S, W);

    // Windshield recess — thin slab on cab front face
    this._box(c.width * 0.75, cabH * 0.38, 0.12,  0, cabH * 0.67, cabZ + c.depth / 2, S, W);

    // Bed side rails
    const rW = 0.1, rH = 0.28, rD = bedD * 0.85;
    const rX = h.width / 2 + rW / 2;
    this._box(rW, rH, rD,  rX, h.height + rH / 2, bedZ, S, W);
    this._box(rW, rH, rD, -rX, h.height + rH / 2, bedZ, S, W);

    // Tailgate
    this._box(h.width, h.height * 0.7, 0.12,  0, h.height * 0.35, bedZ - bedD / 2, S, W);

    // 4 wheels (overhanging sides, slightly sunken)
    const wW = 0.28, wH = 0.44, wD = 0.52;
    const wY = wH / 2 - 0.05;
    const wX = h.width / 2 + wW / 2;
    // Front pair (under cab)
    this._box(wW, wH, wD,  wX, wY, cabZ + 0.35, S, W);
    this._box(wW, wH, wD, -wX, wY, cabZ + 0.35, S, W);
    // Rear pair (under bed)
    this._box(wW, wH, wD,  wX, wY, bedZ - 0.25, S, W);
    this._box(wW, wH, wD, -wX, wY, bedZ - 0.25, S, W);

    // Exhaust pipe — right rear of cab
    this._box(0.1, 0.65, 0.1,  c.width / 2 - 0.15, cabH + 0.05, cabZ - c.depth / 2 + 0.1, S, W);

    // Bumper bar — front
    this._box(h.width + 0.2, 0.18, 0.14,  0, 0.22, cabZ + c.depth / 2 + 0.07, S, W);
  }

  /** Add a solid+wireframe box to this.group. */
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
    const halfW = WORLD_SIZE * 0.43;
    this._waypoint.set(
      (Math.random() * 2 - 1) * halfW,
      0,
      (Math.random() * 2 - 1) * halfW,
    );
    const dist = Math.sqrt(
      (this._waypoint.x - this.position.x) ** 2 +
      (this._waypoint.z - this.position.z) ** 2,
    );
    // Timeout = travel time estimate + 3s buffer
    this._waypointTime = Math.max(6, dist / TRUCK.moveSpeed + 3);
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

    // Steer toward waypoint
    const dx   = this._waypoint.x - this.position.x;
    const dz   = this._waypoint.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const targetHeading = Math.atan2(dx, dz);
    this._turnToward(targetHeading, delta);
    this.speed = TRUCK.moveSpeed;

    // Waypoint reached or timed out → pick next
    this._waypointTime -= delta;
    if (dist < 4 || this._waypointTime <= 0) {
      this._pickWaypoint();
    }

    // Stuck detection — barely moved in 1 s → new waypoint immediately
    this._stuckTimer += delta;
    if (this._stuckTimer >= 1.0) {
      if (this.position.distanceTo(this._lastPos) < 0.5) {
        this._pickWaypoint();
      }
      this._lastPos.copy(this.position);
      this._stuckTimer = 0;
    }

    // Movement — briefly reverse when blocked to escape obstacles
    if (this._reverseTimer > 0) {
      this._reverseTimer -= delta;
      const rx = this.position.x - Math.sin(this.heading) * this.speed * 0.5 * delta;
      const rz = this.position.z - Math.cos(this.heading) * this.speed * 0.5 * delta;
      if (this.movementValidator.canMoveTo(this.position.x, this.position.z, rx, rz).allowed) {
        this.position.x = rx;
        this.position.z = rz;
      }
    } else {
      const nx = this.position.x + Math.sin(this.heading) * this.speed * delta;
      const nz = this.position.z + Math.cos(this.heading) * this.speed * delta;
      const check    = this.movementValidator.canMoveTo(this.position.x, this.position.z, nx, nz);
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
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), TRUCK.turnSpeed * delta);
    this.heading  = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getHitCenter() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + TRUCK.hitYOffset,
      this.position.z,
    );
  }

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), TRUCK.color);
    return true;
  }

  reset(pos) {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    this.position.set(pos.x, 0, pos.z);
    this.position.y  = this.terrain.getHeightAt(pos.x, pos.z);
    this.heading     = Math.random() * Math.PI * 2;
    this.speed       = 0;
    this.isAlive     = true;
    this.isDestroyed  = false;
    this._stuckTimer  = 0;
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
