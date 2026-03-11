import Projectile from './Projectile.js';

/**
 * Manages the lifecycle of all active projectiles.
 * Implements the system interface (update / dispose).
 */
export default class ProjectileManager {
  constructor(scene, terrain) {
    this.scene          = scene;
    this.terrain        = terrain;
    this._projectiles   = [];
    this.effectsManager = null;
  }

  /** Wire the EffectsManager so spawned projectiles can fire hit sparks. */
  setEffectsManager(em) {
    this.effectsManager = em;
  }

  /**
   * Spawns a new projectile and adds it to the active list.
   * @param {{ origin: THREE.Vector3, direction: THREE.Vector3, owner: object, color: number }} config
   * @returns {Projectile}
   */
  spawn(config) {
    const p = new Projectile(this.scene, {
      ...config,
      terrain: this.terrain,
      effectsManager: this.effectsManager,
    });
    this._projectiles.push(p);
    return p;
  }

  update(delta) {
    for (const p of this._projectiles) {
      p.update(delta);
    }

    // Post-iteration sweep — dispose and remove dead projectiles
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      if (!this._projectiles[i].isAlive) {
        this._projectiles[i].dispose();
        this._projectiles.splice(i, 1);
      }
    }
  }

  /** Returns the live projectiles array (read-only intent — do not mutate). */
  getActiveProjectiles() {
    return this._projectiles;
  }

  /** Immediately dispose all active projectiles. */
  clear() {
    for (const p of this._projectiles) {
      p.dispose();
    }
    this._projectiles = [];
  }

  dispose() {
    this.clear();
    this.scene          = null;
    this.terrain        = null;
    this.effectsManager = null;
  }
}
