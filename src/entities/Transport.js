import * as THREE from 'three';
import { TRANSPORT, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * Enemy transport aircraft — a fat, slab-sided cargo plane that crosses the
 * battlefield and airdrops its load over the player's position: either a
 * string of mines or a stick of paratroops. Slower and bigger than the
 * bomber, so it's an easier kill, and stopping it prevents the delivery.
 *
 * Cargo that has already left the aircraft still lands if it's shot down.
 */
export default class Transport {
  /**
   * @param {THREE.Scene} scene
   * @param {{
   *   start: {x,z}, target: {x,z}, payload: 'mines'|'troops',
   *   terrain: object,
   *   onDeliver: (pos: THREE.Vector3, payload: string) => void,
   * }} config
   */
  constructor(scene, config) {
    this.scene      = scene;
    this.terrain    = config.terrain;
    this.payload    = config.payload === 'troops' ? 'troops' : 'mines';
    this._onDeliver = config.onDeliver;

    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;

    this.kind           = 'transport';
    this.faction        = 'enemy';
    this.hitRadius      = TRANSPORT.hitRadius;
    this.scoreValue     = TRANSPORT.score;
    this.blocksMovement = false;

    const dx = config.target.x - config.start.x;
    const dz = config.target.z - config.start.z;
    const len = Math.hypot(dx, dz) || 1;
    this._dir    = { x: dx / len, z: dz / len };
    this._target = { ...config.target };
    this.position = new THREE.Vector3(config.start.x, TRANSPORT.altitude, config.start.z);

    this._left      = TRANSPORT.dropCount;
    this._dropTimer = 0;
    this._dropping  = false;
    this._cargo     = []; // { solid, wire, pos }

    this.destructionEffect = null;
    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  _buildMesh() {
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this._wireMat = new THREE.MeshBasicMaterial({ color: COLORS.enemyTank, wireframe: true });
    this._cargoGeo = this.payload === 'mines'
      ? new THREE.SphereGeometry(0.3, 6, 4)
      : new THREE.BoxGeometry(0.34, 0.6, 0.24);
    this.group = new THREE.Group();
    this._geos = [this._cargoGeo];

    const part = (geo, x, y, z) => {
      this._geos.push(geo);
      for (const mat of [this._solidMat, this._wireMat]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        this.group.add(m);
      }
    };

    // Deep slab fuselage with a boxy hold, high straight wing, twin booms
    part(new THREE.BoxGeometry(2.4, 2.0, 9.0), 0, 0, 0);
    part(new THREE.BoxGeometry(16.0, 0.3, 3.0), 0, 1.2, 0.4);
    part(new THREE.BoxGeometry(0.9, 0.9, 2.6), -4.0, 0.9, 0.4);   // engine pods
    part(new THREE.BoxGeometry(0.9, 0.9, 2.6),  4.0, 0.9, 0.4);
    part(new THREE.BoxGeometry(6.0, 0.25, 1.6), 0, 1.0, -4.2);    // tailplane
    part(new THREE.BoxGeometry(0.18, 1.8, 1.4), -2.9, 1.9, -4.2); // twin fins
    part(new THREE.BoxGeometry(0.18, 1.8, 1.4),  2.9, 1.9, -4.2);
    part(new THREE.BoxGeometry(1.6, 1.0, 0.2), 0, -0.6, -4.5);    // rear ramp
  }

  _applyTransform() {
    this.group.position.copy(this.position);
    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
  }

  getHitCenter() { return this.position.clone(); }

  takeHit(_damage = 1) {
    if (!this.isAlive) return false;
    this.isAlive = false;
    this.isDestroyed = true;
    this._left = 0; // nothing further leaves the hold
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), COLORS.enemyTank);
    return true;
  }

  update(delta, _ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      this._updateCargo(delta); // already-dropped cargo still lands
      return;
    }

    this.position.x += this._dir.x * TRANSPORT.speed * delta;
    this.position.z += this._dir.z * TRANSPORT.speed * delta;
    this._applyTransform();

    const along = (this.position.x - this._target.x) * this._dir.x
                + (this.position.z - this._target.z) * this._dir.z;

    if (!this._dropping && along > -TRANSPORT.dropStartDist && this._left > 0) this._dropping = true;
    if (this._dropping && this._left > 0) {
      this._dropTimer -= delta;
      if (this._dropTimer <= 0) {
        this._dropTimer = TRANSPORT.dropInterval;
        this._left--;
        this._dropCargo();
      }
    }

    this._updateCargo(delta);

    if (this._left === 0 && this._cargo.length === 0 && along > TRANSPORT.despawnDist) {
      this.isAlive = false;
      if (this.group) this.group.visible = false;
    }
  }

  _dropCargo() {
    const pos = this.position.clone();
    pos.y -= 1.2;
    const solid = new THREE.Mesh(this._cargoGeo, this._solidMat);
    const wire  = new THREE.Mesh(this._cargoGeo, this._wireMat);
    solid.position.copy(pos);
    wire.position.copy(pos);
    this.scene.add(solid, wire);
    this._cargo.push({ solid, wire, pos });
  }

  _updateCargo(delta) {
    for (let i = this._cargo.length - 1; i >= 0; i--) {
      const c = this._cargo[i];
      // Chutes descend at a steady rate rather than free-falling
      c.pos.y -= TRANSPORT.fallSpeed * delta;
      c.pos.x += this._dir.x * TRANSPORT.speed * 0.35 * delta;
      c.pos.z += this._dir.z * TRANSPORT.speed * 0.35 * delta;
      c.solid.position.copy(c.pos);
      c.wire.position.copy(c.pos);

      if (c.pos.y <= this.terrain.getHeightAt(c.pos.x, c.pos.z) + 0.25) {
        this.scene.remove(c.solid);
        this.scene.remove(c.wire);
        this._cargo.splice(i, 1);
        if (typeof this._onDeliver === 'function') {
          this._onDeliver(c.pos.clone(), this.payload);
        }
      }
    }
  }

  dispose() {
    for (const c of this._cargo) { this.scene.remove(c.solid); this.scene.remove(c.wire); }
    this._cargo = [];
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    if (this.group) {
      this.scene.remove(this.group);
      if (this._geos) { this._geos.forEach(g => g.dispose()); this._geos = null; }
      this.group = null;
    }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat = null; }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    this.scene = null; this.terrain = null; this._onDeliver = null;
  }
}
