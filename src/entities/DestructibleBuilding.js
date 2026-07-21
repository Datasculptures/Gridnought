import * as THREE from 'three';
import { BASE, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * Enemy HQ — a red command building at the heart of a base site. Takes
 * BASE.hqHp shots to level and is worth a large score. Static and armoured
 * (only cannon rounds hurt it); blocks movement.
 */
export default class DestructibleBuilding {
  constructor(scene, config) {
    this.scene   = scene;
    this.terrain = config.terrain;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = true;
    this._hp         = BASE.hqHp;

    this.kind           = 'building';
    this.faction        = 'enemy';
    this.hitRadius      = BASE.hqHitRadius;
    this.scoreValue     = BASE.hqScore;
    this.blocksMovement = true;

    this.destructionEffect = null;
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);

    this._buildMesh();
    scene.add(this.group);
  }

  _buildMesh() {
    const S = new THREE.MeshBasicMaterial({
      color: 0x220000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const W = new THREE.MeshBasicMaterial({ color: BASE.hqColor, wireframe: true });
    this._solidMat = S;
    this._wireMat  = W;
    this._geos = [];
    this.group = new THREE.Group();
    const d = BASE.hq;

    const part = (geo, x, y, z) => {
      this._geos.push(geo);
      for (const mat of [S, W]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        this.group.add(m);
      }
    };

    // Low bunker: squat casemate + sloped earth berm skirt + roof slab
    part(new THREE.BoxGeometry(d.width, d.height, d.depth), 0, d.height / 2, 0);
    part(new THREE.BoxGeometry(d.width * 1.25, d.height * 0.42, d.depth * 1.25), 0, d.height * 0.21, 0); // berm
    part(new THREE.BoxGeometry(d.width * 0.92, 0.3, d.depth * 0.92), 0, d.height + 0.15, 0);             // roof slab
    // Firing embrasures — dark slits on all four faces
    const sl = 0.32;
    part(new THREE.BoxGeometry(d.width * 0.55, sl, 0.18), 0, d.height * 0.68,  d.depth / 2 + 0.06);
    part(new THREE.BoxGeometry(d.width * 0.55, sl, 0.18), 0, d.height * 0.68, -d.depth / 2 - 0.06);
    part(new THREE.BoxGeometry(0.18, sl, d.depth * 0.55),  d.width / 2 + 0.06, d.height * 0.68, 0);
    part(new THREE.BoxGeometry(0.18, sl, d.depth * 0.55), -d.width / 2 - 0.06, d.height * 0.68, 0);
    // Stub antenna on the roof so it reads as a command post
    part(new THREE.BoxGeometry(0.14, 1.6, 0.14), d.width * 0.3, d.height + 1.0, -d.depth * 0.3);

    this.group.position.set(this.position.x, this.position.y, this.position.z);
  }

  getHitCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + BASE.hq.height / 2, this.position.z);
  }

  update(delta, _ctx) {
    if (!this.isAlive && this.destructionEffect && !this.destructionEffect.isComplete) {
      this.destructionEffect.update(delta);
    }
  }

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this._hp -= damage;
    if (this._hp > 0) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.getHitCenter(), COLORS.enemyTank);
    return true;
  }

  dispose() {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    if (this.group) {
      this.scene.remove(this.group);
      if (this._geos) { this._geos.forEach(g => g.dispose()); this._geos = null; }
      this.group = null;
    }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat = null; }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    this.scene = null; this.terrain = null;
  }
}
