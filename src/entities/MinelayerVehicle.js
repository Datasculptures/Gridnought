import * as THREE from 'three';
import { MINELAYER } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * Minelayer — an orange-liveried engineering vehicle that patrols and seeds
 * live mines behind itself. Unarmed, 2 HP; the threat it poses is the trail
 * it leaves, so killing it early is worth the shell.
 */
export default class MinelayerVehicle {
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
    this._hp         = MINELAYER.hp;

    this.kind           = 'minelayer';
    this.faction        = 'enemy';
    this.hitRadius      = MINELAYER.hitRadius;
    this.scoreValue     = MINELAYER.score;
    this.blocksMovement = true;

    // Waypoint navigation
    this._waypoint     = new THREE.Vector3();
    this._waypointTime = 0;
    this._stuckTimer   = 0;
    this._lastPos      = this.position.clone();
    this._reverseTimer = 0;

    // Mine laying
    this._layTimer = MINELAYER.layInterval * (0.4 + Math.random() * 0.6);
    this._laid     = 0;

    this.destructionEffect = null;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this._pickWaypoint();
    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  _buildMesh() {
    const S = new THREE.MeshBasicMaterial({
      color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const W = new THREE.MeshBasicMaterial({ color: MINELAYER.color, wireframe: true });
    this._solidMat = S;
    this._wireMat  = W;
    this.group = new THREE.Group();
    const h = MINELAYER.hull;

    const box = (w, ht, d, x, y, z) => {
      const geo = new THREE.BoxGeometry(w, ht, d);
      const a = new THREE.Mesh(geo, S), b = new THREE.Mesh(geo, W);
      a.position.set(x, y, z); b.position.set(x, y, z);
      this.group.add(a, b);
    };

    box(h.width, h.height, h.depth, 0, h.height / 2, 0);              // hull
    box(h.width * 0.85, 0.9, 1.4, 0, h.height + 0.45, h.depth * 0.28); // cab
    // Dispenser hopper + chute at the rear — the business end
    box(h.width * 0.8, 0.7, 1.3, 0, h.height + 0.35, -h.depth * 0.22);
    box(0.5, 0.4, 0.8, 0, 0.45, -h.depth / 2 - 0.35);
    // Track boxes
    const trW = 0.3, trD = h.depth + 0.3, trX = h.width / 2 + trW / 2 - 0.05;
    box(trW, 0.32, trD,  trX, 0.16, 0);
    box(trW, 0.32, trD, -trX, 0.16, 0);
  }

  _applyTransform() {
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    const normal  = this.terrain.getNormalAt(this.position.x, this.position.z);
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const up      = normal.normalize();
    const right   = new THREE.Vector3().crossVectors(up, forward).normalize();
    const fwd     = new THREE.Vector3().crossVectors(right, up).normalize();
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
  }

  _pickWaypoint() {
    const ang = Math.random() * Math.PI * 2;
    const r   = 25 + Math.random() * 55;
    this._waypoint.set(
      this.position.x + Math.sin(ang) * r, 0, this.position.z + Math.cos(ang) * r,
    );
    const dist = Math.hypot(this._waypoint.x - this.position.x, this._waypoint.z - this.position.z);
    this._waypointTime = Math.max(8, dist / MINELAYER.moveSpeed + 4);
  }

  update(delta, _ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }

    const dx = this._waypoint.x - this.position.x;
    const dz = this._waypoint.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    this._turnToward(Math.atan2(dx, dz), delta);
    this.speed = MINELAYER.moveSpeed;

    this._waypointTime -= delta;
    if (dist < 4 || this._waypointTime <= 0) this._pickWaypoint();

    this._stuckTimer += delta;
    if (this._stuckTimer >= 1.0) {
      if (this.position.distanceTo(this._lastPos) < 0.5) this._pickWaypoint();
      this._lastPos.copy(this.position);
      this._stuckTimer = 0;
    }

    if (this._reverseTimer > 0) {
      this._reverseTimer -= delta;
      const rx = this.position.x - Math.sin(this.heading) * this.speed * 0.5 * delta;
      const rz = this.position.z - Math.cos(this.heading) * this.speed * 0.5 * delta;
      if (this.movementValidator.canMoveTo(this.position.x, this.position.z, rx, rz, true).allowed) {
        this.position.x = rx; this.position.z = rz;
      }
    } else {
      const nx = this.position.x + Math.sin(this.heading) * this.speed * delta;
      const nz = this.position.z + Math.cos(this.heading) * this.speed * delta;
      const check = this.movementValidator.canMoveTo(this.position.x, this.position.z, nx, nz, true);
      const vFree = !this.movementValidator.isVehicleBlocked(nx, nz, this);
      if (check.allowed && vFree) {
        this.position.x = nx; this.position.z = nz;
      } else {
        this._pickWaypoint();
        this._reverseTimer = 0.7;
      }
    }

    // Lay a mine out of the rear chute
    if (this.mineManager && this._laid < MINELAYER.maxMines) {
      this._layTimer -= delta;
      if (this._layTimer <= 0) {
        this._layTimer = MINELAYER.layInterval;
        const bx = this.position.x - Math.sin(this.heading) * 3.0;
        const bz = this.position.z - Math.cos(this.heading) * 3.0;
        if (this.mineManager.addMineAt(this.terrain, bx, bz)) this._laid++;
      }
    }

    this._applyTransform();
  }

  _turnToward(target, delta) {
    let diff = ((target - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), MINELAYER.turnSpeed * delta);
    this.heading  = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  getHitCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + 0.7, this.position.z);
  }

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this._hp -= damage;
    if (this._hp > 0) return false;
    this.isAlive = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), MINELAYER.color);
    return true;
  }

  dispose() {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      this.group = null;
    }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat = null; }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    this.scene = null; this.terrain = null; this.movementValidator = null; this.mineManager = null;
  }
}
