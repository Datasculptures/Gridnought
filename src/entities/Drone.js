import * as THREE from 'three';
import { DRONE, COLORS } from '../utils/constants.js';

/**
 * A passive observer drone that flies a circular orbit above the battlefield.
 * No gameplay interaction — visual only.
 *
 * Appearance: small fuselage with long slender wings, rendered in wireframe
 * style (black solid fill + grey wireframe edges).
 */
const DRONE_HIT_RADIUS = 4.0; // generous sphere covering fuselage + inner wing span

export default class Drone {
  constructor(scene) {
    this.scene      = scene;
    this._angle     = Math.random() * Math.PI * 2; // random start position on orbit
    this.isAlive    = true;
    this.isArmoured = false;

    this._buildMesh();
    scene.add(this.group);
  }

  /** World-space position of the drone centre. */
  get position() { return this.group.position; }

  /**
   * Returns true if a sphere at `pos` with `radius` overlaps the drone hit sphere.
   * If hit, marks drone as destroyed and hides the mesh.
   */
  tryHit(pos, radius) {
    if (!this.isAlive) return false;
    const dx = pos.x - this.group.position.x;
    const dy = pos.y - this.group.position.y;
    const dz = pos.z - this.group.position.z;
    if (dx * dx + dy * dy + dz * dz <= (DRONE_HIT_RADIUS + radius) ** 2) {
      this.isAlive = false;
      if (this.group) this.group.visible = false;
      return true;
    }
    return false;
  }

  reset() {
    this.isAlive = true;
    if (this.group) this.group.visible = true;
  }

  // ---------------------------------------------------------------------------
  // Mesh
  // ---------------------------------------------------------------------------

  _buildMesh() {
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this._wireMat = new THREE.MeshBasicMaterial({ color: COLORS.terrain, wireframe: true });

    this.group = new THREE.Group();

    // --- Fuselage (small elongated box) ---
    const bodyGeo = new THREE.BoxGeometry(0.9, 0.3, 1.8);
    this.group.add(new THREE.Mesh(bodyGeo, this._solidMat));
    this.group.add(new THREE.Mesh(bodyGeo, this._wireMat));

    // --- Main wings (long, slender — extend 5 units each side) ---
    const wingGeo = new THREE.BoxGeometry(10.0, 0.12, 0.7);
    this.group.add(new THREE.Mesh(wingGeo, this._solidMat));
    this.group.add(new THREE.Mesh(wingGeo, this._wireMat));

    // --- Horizontal tail stabiliser ---
    const tailHGeo = new THREE.BoxGeometry(3.0, 0.10, 0.45);
    const tailH = new THREE.Group();
    tailH.position.set(0, 0, -0.85);
    tailH.add(new THREE.Mesh(tailHGeo, this._solidMat));
    tailH.add(new THREE.Mesh(tailHGeo, this._wireMat));
    this.group.add(tailH);

    // --- Vertical tail fin ---
    const tailVGeo = new THREE.BoxGeometry(0.10, 0.7, 0.5);
    const tailV = new THREE.Group();
    tailV.position.set(0, 0.35, -0.85);
    tailV.add(new THREE.Mesh(tailVGeo, this._solidMat));
    tailV.add(new THREE.Mesh(tailVGeo, this._wireMat));
    this.group.add(tailV);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta) {
    if (!this.isAlive) return;
    this._angle += DRONE.orbitSpeed * delta;

    const x = Math.sin(this._angle) * DRONE.orbitRadius;
    const z = Math.cos(this._angle) * DRONE.orbitRadius;
    // Gentle vertical bobbing
    const y = DRONE.orbitHeight
      + Math.sin(this._angle * (DRONE.bobFrequency / DRONE.orbitSpeed)) * DRONE.bobAmplitude;

    this.group.position.set(x, y, z);

    // Point the nose in the direction of travel (tangent to the circle).
    // Velocity direction at θ: (cos θ, 0, -sin θ).
    // Three.js ry: atan2(cos θ, -sin θ) = π/2 + θ.
    this.group.rotation.y = Math.PI / 2 + this._angle;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose() {
    if (this.group) {
      this.scene.remove(this.group);
      // Dispose all child geometries + materials
      this.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
      });
      this.group = null;
    }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat  = null; }
    this.scene = null;
  }
}
