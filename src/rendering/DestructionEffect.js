import * as THREE from 'three';
import { DESTRUCTION } from '../utils/constants.js';

/**
 * Spawns wireframe tetrahedron fragments that fly outward with gravity,
 * expand, and fade over DESTRUCTION.duration seconds.
 */
export default class DestructionEffect {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position - World position of the explosion centre.
   * @param {number} color           - Hex colour for the fragments.
   */
  constructor(scene, position, color) {
    this.scene      = scene;
    this.isComplete = false;
    this._elapsed   = 0;
    this._fragments = [];

    for (let i = 0; i < DESTRUCTION.fragmentCount; i++) {
      const geo = new THREE.TetrahedronGeometry(DESTRUCTION.fragmentSize, 0);
      const mat = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 1.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);

      // Random outward velocity — XZ angle spread, upward Y bias
      const angle       = Math.random() * Math.PI * 2;
      const speedFactor = 0.8 + Math.random() * 0.4; // 80–120 % of base speed
      const vx = Math.sin(angle) * DESTRUCTION.fragmentSpeed * speedFactor;
      const vy = (0.5 + Math.random() * 0.5) * DESTRUCTION.fragmentSpeed * speedFactor;
      const vz = Math.cos(angle) * DESTRUCTION.fragmentSpeed * speedFactor;

      // NaN guard — keep fragment moving even if trig produced garbage
      const velocity = new THREE.Vector3(
        Number.isFinite(vx) ? vx : 0,
        Number.isFinite(vy) ? vy : DESTRUCTION.fragmentSpeed * 0.5,
        Number.isFinite(vz) ? vz : 0,
      );

      this._fragments.push({ mesh, velocity });
      scene.add(mesh);
    }
  }

  update(delta) {
    if (this.isComplete) return;

    this._elapsed += delta;
    const t = Math.min(1, this._elapsed / DESTRUCTION.duration);

    for (const { mesh, velocity } of this._fragments) {
      // Gravity
      velocity.y -= DESTRUCTION.fragmentGravity * delta;
      if (mesh.position.y <= 0 && velocity.y < 0) {
        velocity.y = 0;
      }

      // Translate
      mesh.position.addScaledVector(velocity, delta);

      // Scale expansion
      const s = 1.0 + DESTRUCTION.expandRate * t;
      mesh.scale.setScalar(s);

      // Opacity fade
      mesh.material.opacity = Math.max(0, 1.0 - DESTRUCTION.fadeRate * t);
    }

    if (this._elapsed >= DESTRUCTION.duration) {
      this.isComplete = true;
    }
  }

  dispose() {
    for (const { mesh } of this._fragments) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._fragments = [];
    this.scene      = null;
  }
}
