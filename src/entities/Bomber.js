import * as THREE from 'three';
import { BOMBER, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * Enemy bomber — flies a straight line from beyond the horizon, over the
 * player's position, and away. As it approaches the target point it drops
 * a stick of bombs that fall and detonate in a line. Low and slow enough
 * to shoot down with the main gun; worth solid points.
 *
 * Registered with the EntityManager (kind 'bomber'). Bombs are managed
 * internally; detonation effects/damage go through the onDetonate callback
 * supplied by GameManager.
 */
export default class Bomber {
  /**
   * @param {THREE.Scene} scene
   * @param {{
   *   start:  {x,z},           // spawn point (far out)
   *   target: {x,z},           // point to overfly (player position at spawn)
   *   terrain: object,
   *   onDetonate: (pos: THREE.Vector3) => void,
   * }} config
   */
  constructor(scene, config) {
    this.scene      = scene;
    this.terrain    = config.terrain;
    this._onDetonate = config.onDetonate;

    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;

    // Unified entity metadata
    this.kind           = 'bomber';
    this.faction        = 'enemy';
    this.hitRadius      = BOMBER.hitRadius;
    this.scoreValue     = BOMBER.score;
    this.blocksMovement = false;

    // Straight-line flight
    const dx = config.target.x - config.start.x;
    const dz = config.target.z - config.start.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    this._dir    = { x: dx / len, z: dz / len };
    this._target = { ...config.target };
    this.position = new THREE.Vector3(config.start.x, BOMBER.altitude, config.start.z);

    // Bombing run state
    this._bombsLeft  = BOMBER.bombCount;
    this._dropTimer  = 0;
    this._dropping   = false;
    this._passedDist = 0;    // distance past the target point
    this._bombs      = [];   // { mesh, pos, vy }

    this.destructionEffect = null;

    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  _buildMesh() {
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this._wireMat = new THREE.MeshBasicMaterial({ color: COLORS.enemyTank, wireframe: true });
    this._bombGeo = new THREE.OctahedronGeometry(0.35, 0);
    this.group = new THREE.Group();
    this._geos = [this._bombGeo];

    const part = (geo, x, y, z) => {
      this._geos.push(geo);
      const s = new THREE.Mesh(geo, this._solidMat);
      const w = new THREE.Mesh(geo, this._wireMat);
      s.position.set(x, y, z); w.position.set(x, y, z);
      this.group.add(s, w);
    };

    // Fuselage — long slab, nose toward +Z (flight direction)
    part(new THREE.BoxGeometry(1.6, 1.0, 7.0), 0, 0, 0);
    // Main wings — broad, slightly back from the nose
    part(new THREE.BoxGeometry(14.0, 0.25, 2.6), 0, 0, 0.6);
    // Inboard engines — one pod under each wing
    part(new THREE.BoxGeometry(0.7, 0.7, 2.2), -3.2, -0.5, 0.6);
    part(new THREE.BoxGeometry(0.7, 0.7, 2.2),  3.2, -0.5, 0.6);
    // Tailplane + twin fins
    part(new THREE.BoxGeometry(5.0, 0.2, 1.4), 0, 0.1, -3.2);
    part(new THREE.BoxGeometry(0.15, 1.5, 1.3), -2.4, 0.8, -3.2);
    part(new THREE.BoxGeometry(0.15, 1.5, 1.3),  2.4, 0.8, -3.2);
  }

  _applyTransform() {
    this.group.position.copy(this.position);
    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
  }

  getHitCenter() {
    return this.position.clone();
  }

  takeHit(_damage = 1) {
    if (!this.isAlive) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this._clearBombs();
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), COLORS.enemyTank);
    return true;
  }

  update(delta, _ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      this._updateBombs(delta); // bombs already falling keep falling
      return;
    }

    // Fly the line
    this.position.x += this._dir.x * BOMBER.speed * delta;
    this.position.z += this._dir.z * BOMBER.speed * delta;
    this._applyTransform();

    // Signed progress along the path relative to the target point
    const tx = this.position.x - this._target.x;
    const tz = this.position.z - this._target.z;
    const along = tx * this._dir.x + tz * this._dir.z; // <0 approaching, >0 past
    this._passedDist = along;

    // Open the bomb bay on approach; release the stick on an interval
    if (!this._dropping && along > -BOMBER.dropStartDist && this._bombsLeft > 0) {
      this._dropping = true;
    }
    if (this._dropping && this._bombsLeft > 0) {
      this._dropTimer -= delta;
      if (this._dropTimer <= 0) {
        this._dropTimer = BOMBER.dropInterval;
        this._bombsLeft--;
        this._dropBomb();
      }
    }

    this._updateBombs(delta);

    // Quietly leave once the run is complete and it's far past the target
    if (this._bombsLeft === 0 && this._bombs.length === 0 && along > BOMBER.despawnDist) {
      this.isAlive = false;
      if (this.group) this.group.visible = false;
    }
  }

  _dropBomb() {
    const s = new THREE.Mesh(this._bombGeo, this._solidMat);
    const w = new THREE.Mesh(this._bombGeo, this._wireMat);
    const pos = this.position.clone();
    pos.y -= 1.0;
    s.position.copy(pos);
    w.position.copy(pos);
    this.scene.add(s, w);
    this._bombs.push({ solid: s, wire: w, pos, vy: 0 });
  }

  _updateBombs(delta) {
    for (let i = this._bombs.length - 1; i >= 0; i--) {
      const b = this._bombs[i];
      b.vy   -= BOMBER.bombGravity * delta;
      b.pos.y += b.vy * delta;
      // Bombs keep the bomber's forward momentum
      b.pos.x += this._dir.x * BOMBER.speed * 0.6 * delta;
      b.pos.z += this._dir.z * BOMBER.speed * 0.6 * delta;
      b.solid.position.copy(b.pos);
      b.wire.position.copy(b.pos);

      const ground = this.terrain.getHeightAt(b.pos.x, b.pos.z);
      if (b.pos.y <= ground + 0.3) {
        b.pos.y = ground;
        this._removeBomb(i);
        if (typeof this._onDetonate === 'function') this._onDetonate(b.pos.clone());
      }
    }
  }

  _removeBomb(i) {
    const b = this._bombs[i];
    this.scene.remove(b.solid);
    this.scene.remove(b.wire);
    this._bombs.splice(i, 1);
  }

  _clearBombs() {
    // Called on shoot-down: bombs already in the air keep falling, so only
    // future drops are cancelled
    this._bombsLeft = 0;
  }

  dispose() {
    for (let i = this._bombs.length - 1; i >= 0; i--) this._removeBomb(i);
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    if (this.group) {
      this.scene.remove(this.group);
      if (this._geos) { this._geos.forEach(g => g.dispose()); this._geos = null; }
      this.group = null;
    }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat = null; }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    this.scene = null; this.terrain = null; this._onDetonate = null;
  }
}
