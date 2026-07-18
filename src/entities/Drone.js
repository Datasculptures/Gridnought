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
    // Station the drone circles. Fixed until retasked (R key).
    this._center       = new THREE.Vector3(0, 0, 0);
    this._targetCenter = new THREE.Vector3(0, 0, 0);

    this._buildMesh();
    scene.add(this.group);
  }

  /** Current orbit station (world XZ). */
  get center() { return this._center; }

  /** Orders the drone to fly to and circle a new point. */
  retask(pos) {
    this._targetCenter.set(pos.x, 0, pos.z);
  }

  /**
   * Commits this drone to a kamikaze dive. `getTargetPoint()` returns the
   * current world-space aim point each frame (tracks a moving target).
   * GameManager watches proximity and triggers the detonation.
   */
  strikeAt(getTargetPoint) {
    this._strikeFn    = getTargetPoint;
    this._strikeTimer = 0;
  }

  get isStriking() { return !!this._strikeFn; }

  /** Removes the drone after its strike detonates. */
  consume() {
    this.isAlive   = false;
    this._strikeFn = null;
    if (this.group) this.group.visible = false;
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

  /** Revives the drone and stations it over `pos` (default: world origin). */
  reset(pos = null) {
    this.isAlive   = true;
    this._strikeFn = null;
    if (this.group) {
      this.group.visible = true;
      this.group.rotation.x = 0;
    }
    const x = pos ? pos.x : 0;
    const z = pos ? pos.z : 0;
    this._center.set(x, 0, z);
    this._targetCenter.set(x, 0, z);
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

    // --- Strike mode: dive straight at the tracked point ---
    if (this._strikeFn) {
      this._strikeTimer += delta;
      const p   = this._strikeFn();
      const dx  = p.x - this.group.position.x;
      const dy  = p.y - this.group.position.y;
      const dz  = p.z - this.group.position.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const step = Math.min(len, DRONE.strikeSpeed * delta);
      this.group.position.x += (dx / len) * step;
      this.group.position.y += (dy / len) * step;
      this.group.position.z += (dz / len) * step;
      this.group.rotation.y = Math.atan2(dx, dz);
      this.group.rotation.x = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 0.8;
      return;
    }

    this._angle += DRONE.orbitSpeed * delta;

    // Fly toward the tasked station (only moves after a retask order)
    const k = Math.min(1, delta * DRONE.retaskLerp * 3);
    this._center.x += (this._targetCenter.x - this._center.x) * k;
    this._center.z += (this._targetCenter.z - this._center.z) * k;

    const x = this._center.x + Math.sin(this._angle) * DRONE.orbitRadius;
    const z = this._center.z + Math.cos(this._angle) * DRONE.orbitRadius;
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
