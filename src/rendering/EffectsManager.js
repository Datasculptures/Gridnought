import * as THREE from 'three';
import { EFFECTS } from '../utils/constants.js';

/**
 * Manages transient visual effects: muzzle flashes and hit sparks.
 * GameManager calls update(delta) every frame and clear() on round reset.
 */
export default class EffectsManager {
  constructor(scene) {
    this._scene   = scene;
    this._effects = []; // { meshes, velocities|null, timer, duration, type }
  }

  /**
   * Brief bright flash at the barrel tip position.
   * @param {THREE.Vector3} position
   */
  spawnMuzzleFlash(position) {
    const geo  = new THREE.OctahedronGeometry(EFFECTS.muzzleFlashSize, 0);
    const mat  = new THREE.MeshBasicMaterial({
      color:       EFFECTS.muzzleFlashColor,
      wireframe:   true,
      transparent: true,
      opacity:     1.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this._scene.add(mesh);

    this._effects.push({
      type:       'flash',
      meshes:     [mesh],
      velocities: null,
      timer:      EFFECTS.muzzleFlashDuration,
      duration:   EFFECTS.muzzleFlashDuration,
    });
  }

  /**
   * Burst of sparks flying outward from an impact point.
   * @param {THREE.Vector3} position
   * @param {number}        color  - Three.js hex colour integer
   */
  spawnHitSparks(position, color) {
    const meshes     = [];
    const velocities = [];

    for (let i = 0; i < EFFECTS.sparkCount; i++) {
      const geo  = new THREE.TetrahedronGeometry(EFFECTS.sparkSize, 0);
      const mat  = new THREE.MeshBasicMaterial({
        color,
        wireframe:   true,
        transparent: true,
        opacity:     1.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      this._scene.add(mesh);
      meshes.push(mesh);

      // Random outward velocity with upward bias
      const angle  = Math.random() * Math.PI * 2;
      const upBias = 0.3 + Math.random() * 0.6;
      const spd    = EFFECTS.sparkSpeed * (0.5 + Math.random() * 0.5);
      const hSpd   = spd * (1 - upBias);
      velocities.push(new THREE.Vector3(
        Math.cos(angle) * hSpd,
        upBias * spd,
        Math.sin(angle) * hSpd,
      ));
    }

    this._effects.push({
      type:       'sparks',
      meshes,
      velocities,
      timer:      EFFECTS.sparkDuration,
      duration:   EFFECTS.sparkDuration,
    });
  }

  update(delta) {
    for (let i = this._effects.length - 1; i >= 0; i--) {
      const eff = this._effects[i];
      eff.timer -= delta;

      if (eff.timer <= 0) {
        this._disposeEffect(eff);
        this._effects.splice(i, 1);
        continue;
      }

      const t = eff.timer / eff.duration; // 1→0 as effect ages

      if (eff.type === 'flash') {
        eff.meshes[0].material.opacity = t;
        eff.meshes[0].scale.setScalar(1 + (1 - t) * 3);
      } else if (eff.type === 'sparks') {
        for (let j = 0; j < eff.meshes.length; j++) {
          const mesh = eff.meshes[j];
          const vel  = eff.velocities[j];
          mesh.position.addScaledVector(vel, delta);
          vel.y -= EFFECTS.sparkGravity * delta;
          mesh.material.opacity = t;
        }
      }
    }
  }

  /** Dispose all active effects immediately (use on round reset). */
  clear() {
    for (const eff of this._effects) {
      this._disposeEffect(eff);
    }
    this._effects = [];
  }

  dispose() {
    this.clear();
    this._scene = null;
  }

  // ---------------------------------------------------------------------------

  _disposeEffect(eff) {
    for (const mesh of eff.meshes) {
      this._scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
