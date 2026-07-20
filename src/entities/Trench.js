import * as THREE from 'three';
import { TRENCH } from '../utils/constants.js';

/**
 * A narrow infantry trench — a wireframe trough with a low parapet. Purely
 * a prop: it never blocks movement and lets fire pass, so a tank drives
 * straight over it while its garrison shrugs off some hits (cover handled
 * on the infantry). Registered as a neutral entity so it doesn't read as a
 * threat on the minimap or draw fire.
 */
export default class Trench {
  /**
   * @param {THREE.Scene} scene
   * @param {{ position: {x,z}, heading: number, terrain: object }} config
   */
  constructor(scene, config) {
    this.scene   = scene;
    this.terrain = config.terrain;
    this.heading = config.heading ?? 0;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;

    this.kind                  = 'trench';
    this.faction               = 'neutral';
    this.hitRadius             = 0;
    this.scoreValue            = 0;
    this.blocksMovement        = false;
    this.projectileTransparent = true;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this._buildMesh();
    scene.add(this.group);
  }

  _buildMesh() {
    const W = new THREE.MeshBasicMaterial({ color: 0x668855, wireframe: true });
    const S = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this._wireMat = W;
    this._solidMat = S;
    this._geos = [];
    this.group = new THREE.Group();

    const L = TRENCH.length, hw = TRENCH.halfWidth, dep = TRENCH.depth;
    const add = (geo, x, y, z) => {
      this._geos.push(geo);
      for (const mat of [S, W]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        this.group.add(m);
      }
    };

    // Trench floor (sunk) + two long walls + two end caps
    add(new THREE.BoxGeometry(hw * 2, 0.1, L), 0, -dep, 0);
    add(new THREE.BoxGeometry(0.12, dep, L),  hw, -dep / 2, 0);
    add(new THREE.BoxGeometry(0.12, dep, L), -hw, -dep / 2, 0);
    add(new THREE.BoxGeometry(hw * 2, dep, 0.12), 0, -dep / 2,  L / 2);
    add(new THREE.BoxGeometry(hw * 2, dep, 0.12), 0, -dep / 2, -L / 2);
    // Low parapet berm along each edge (the "cover")
    add(new THREE.BoxGeometry(0.5, 0.35, L),  hw + 0.3, 0.15, 0);
    add(new THREE.BoxGeometry(0.5, 0.35, L), -hw - 0.3, 0.15, 0);

    this.group.position.set(this.position.x, this.position.y, this.position.z);
    this.group.rotation.y = this.heading;
  }

  /** Evenly spaced firing positions along the trench (world space). */
  garrisonPositions(count) {
    const out = [];
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    for (let i = 0; i < count; i++) {
      const t = (count === 1) ? 0 : (i / (count - 1) - 0.5);
      const along = t * (TRENCH.length - 3);
      out.push({
        x: this.position.x + sin * along,
        z: this.position.z + cos * along,
      });
    }
    return out;
  }

  getHitCenter() { return this.position.clone(); }
  takeHit() { return false; }
  update(_delta, _ctx) {}

  dispose() {
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
