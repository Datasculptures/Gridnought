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
    const def = POWERUP.types[this.type] ?? POWERUP.types.repair;
    this._wireMat = new THREE.MeshBasicMaterial({ color: def.color, wireframe: true });
    this._geo     = new THREE.OctahedronGeometry(POWERUP.size, 0);
    this.group    = new THREE.Group();
    this.group.add(new THREE.Mesh(this._geo, this._wireMat));
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
      this._geo.dispose();
      this._wireMat.dispose();
      this.group = null;
    }
    this.scene = null;
    this.terrain = null;
  }
}
