import * as THREE from 'three';
import { POWERUP } from '../utils/constants.js';

/**
 * A collectible power-up: a slowly spinning, bobbing wireframe octahedron.
 * Types: 'repair' | 'rapid' | 'radar' (see POWERUP.types).
 *
 * Registered with the EntityManager (kind 'powerup') but transparent to
 * projectiles — only driving the player tank into it collects it.
 */
export default class PowerUp {
  /**
   * @param {THREE.Scene} scene
   * @param {{ position: {x,z}, type: string, terrain: object }} config
   */
  constructor(scene, config) {
    this.scene   = scene;
    this.terrain = config.terrain;
    this.type    = config.type;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;

    // Unified entity metadata (EntityManager contract)
    this.kind                  = 'powerup';
    this.faction               = 'pickup';
    this.hitRadius             = POWERUP.pickupRadius;
    this.scoreValue            = 0;
    this.blocksMovement        = false;
    this.projectileTransparent = true; // bullets pass through

    this._age = Math.random() * 10; // desync bobbing between pickups
    this._baseY = this.terrain.getHeightAt(this.position.x, this.position.z);

    this._buildMesh();
    scene.add(this.group);
  }

  _buildMesh() {
    const def = POWERUP.types[this.type] ?? POWERUP.types.armour;
    this._wireMat = new THREE.MeshBasicMaterial({ color: def.color, wireframe: true });
    this._geos    = [];
    this.group    = new THREE.Group();

    const add = (geo, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      this._geos.push(geo);
      const m = new THREE.Mesh(geo, this._wireMat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.rotation.z = rz;
      this.group.add(m);
    };

    if (def.shape === 'shield') {
      // Heater shield: tapered slab with a raised boss and rim bar
      add(new THREE.BoxGeometry(1.25, 1.35, 0.16));
      add(new THREE.ConeGeometry(0.62, 0.55, 4), 0, -0.95, 0, Math.PI); // pointed base
      add(new THREE.BoxGeometry(1.25, 0.14, 0.24), 0, 0.5, 0);          // rim bar
      add(new THREE.SphereGeometry(0.24, 6, 5), 0, -0.05, 0.14);        // boss
    } else if (def.shape === 'shells') {
      // A small stack of cannon rounds
      const body = new THREE.CylinderGeometry(0.19, 0.19, 0.85, 6);
      const tip  = new THREE.ConeGeometry(0.19, 0.34, 6);
      for (const [sx, sz] of [[-0.34, 0], [0.34, 0], [0, 0.36]]) {
        add(body, sx, 0, sz);
        add(tip,  sx, 0.6, sz);
      }
    } else {
      add(new THREE.OctahedronGeometry(POWERUP.size, 0));
    }

    this.group.position.set(this.position.x, this._baseY + 1.2, this.position.z);
  }

  update(delta, _ctx) {
    if (!this.isAlive) return;
    this._age += delta;
    this.group.rotation.y = this._age * POWERUP.spinSpeed;
    this.group.position.y = this._baseY + 1.2
      + Math.sin(this._age * Math.PI * 2 * POWERUP.bobFrequency) * POWERUP.bobAmplitude;
  }

  getHitCenter() {
    return this.group.position.clone();
  }

  /** Power-ups are indestructible by weapons; collected via collect(). */
  takeHit(_damage = 1) {
    return false;
  }

  /** Marks the pickup consumed and hides it. */
  collect() {
    this.isAlive = false;
    if (this.group) this.group.visible = false;
  }

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);
      if (this._geos) { this._geos.forEach(g => g.dispose()); this._geos = null; }
      this._wireMat.dispose();
      this.group = null;
    }
    this.scene = null;
    this.terrain = null;
  }
}
