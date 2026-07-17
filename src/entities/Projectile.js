import * as THREE from 'three';
import { PROJECTILE } from '../utils/constants.js';

export default class Projectile {
  /**
   * @param {THREE.Scene} scene
   * @param {{
   *   origin: THREE.Vector3,
   *   velocity: THREE.Vector3,   // 3D launch velocity (muzzle velocity + elevation)
   *   owner: object,
   *   color: number,
   *   terrain: object,
   * }} config
   */
  constructor(scene, config) {
    this.scene          = scene;
    this.terrain        = config.terrain;
    this.owner          = config.owner;
    this.isAlive        = true;
    this._color         = config.color;
    this.effectsManager = config.effectsManager || null;

    // Per-projectile physics overrides (used by MG rounds)
    this._gravity        = config.gravity        ?? PROJECTILE.gravity;
    this._maxFlightTime  = config.maxFlightTime  ?? PROJECTILE.maxFlightTime;
    this.radius          = config.radius         ?? PROJECTILE.radius;
    const headRadius     = this.radius;

    // If false, this projectile skips tank hit checks (e.g. player MG rounds)
    this.canHitTanks     = config.canHitTanks    ?? true;

    // If true, death spawns a large explosion instead of hit sparks
    this._explodeOnKill  = config.explodeOnKill  ?? false;

    // Weapon type — carries damage, penetrating flag, and range limit
    this.weaponType      = config.weaponType     ?? null;

    // Damage multiplier from power-ups (AP rounds) on the owning tank
    this.damageMultiplier = config.damageMultiplier ?? 1;

    // Mutable 3D velocity — gravity decrements .y each frame
    this._velocity    = config.velocity.clone();
    this._flightTime  = 0;

    // Spawn position — used for range enforcement
    this._originX     = config.origin.x;
    this._originZ     = config.origin.z;

    // --- Head mesh ---
    const headGeo = new THREE.OctahedronGeometry(headRadius, 0);
    const headMat = new THREE.MeshBasicMaterial({ color: config.color, wireframe: true });
    this._headMesh = new THREE.Mesh(headGeo, headMat);
    this._headMesh.position.copy(config.origin);
    scene.add(this._headMesh);

    // --- Trail meshes (each has its own material for independent opacity) ---
    this._trailMeshes = [];
    for (let i = 0; i < PROJECTILE.trailLength; i++) {
      const trailGeo = new THREE.OctahedronGeometry(PROJECTILE.radius * 0.7, 0);
      const trailMat = new THREE.MeshBasicMaterial({
        color: PROJECTILE.trailColor,
        wireframe: true,
        transparent: true,
        opacity: Math.max(0, 1.0 - (i + 1) * PROJECTILE.trailOpacityFalloff),
      });
      const mesh = new THREE.Mesh(trailGeo, trailMat);
      mesh.position.copy(config.origin);
      mesh.visible = false;
      scene.add(mesh);
      this._trailMeshes.push(mesh);
    }

    // --- Snapshot ring buffer for trail positions ---
    this._snapshotPositions = [];
    this._lastSnapshotPos   = config.origin.clone();
  }

  /** World-space position of the projectile head. */
  get position() {
    return this._headMesh ? this._headMesh.position : null;
  }

  /** Current 3D velocity (mutated each frame by gravity). */
  get velocity() {
    return this._velocity;
  }

  /** Immediately marks the projectile as dead (e.g. on hit). Spawns impact effect. */
  kill() {
    this._die();
  }

  /** Internal death — spawns the appropriate visual effect and clears isAlive. */
  _die() {
    if (this.effectsManager && this._headMesh) {
      if (this._explodeOnKill) {
        this.effectsManager.spawnExplosion(this._headMesh.position.clone(), this._color);
      } else {
        this.effectsManager.spawnHitSparks(this._headMesh.position.clone(), this._color);
      }
    }
    this.isAlive = false;
  }

  update(delta) {
    if (!this.isAlive) return;

    // --- Ballistic physics ---
    this._flightTime += delta;
    this._velocity.y -= this._gravity * delta;

    // Advance head along current velocity
    this._headMesh.position.addScaledVector(this._velocity, delta);

    const hx = this._headMesh.position.x;
    const hz = this._headMesh.position.z;
    const hy = this._headMesh.position.y;

    // Snapshot when we've moved trailSpacing from the last snapshot
    if (this._headMesh.position.distanceTo(this._lastSnapshotPos) >= PROJECTILE.trailSpacing) {
      this._snapshotPositions.unshift(this._headMesh.position.clone());
      if (this._snapshotPositions.length > PROJECTILE.trailLength) {
        this._snapshotPositions.pop();
      }
      this._lastSnapshotPos.copy(this._headMesh.position);
    }

    // Update trail mesh positions
    for (let i = 0; i < this._trailMeshes.length; i++) {
      if (i < this._snapshotPositions.length) {
        this._trailMeshes[i].position.copy(this._snapshotPositions[i]);
        this._trailMeshes[i].visible = true;
      } else {
        this._trailMeshes[i].visible = false;
      }
    }

    // --- Kill conditions ---

    // Safety: maximum flight time
    if (this._flightTime >= this._maxFlightTime) {
      this._die();
      return;
    }

    // Weapon range — kill when horizontal distance from origin is exceeded
    if (this.weaponType?.range != null) {
      const rx = hx - this._originX;
      const rz = hz - this._originZ;
      if (rx * rx + rz * rz >= this.weaponType.range * this.weaponType.range) {
        this._die();
        return;
      }
    }

    // Terrain collision — projectile has hit the ground
    const terrainY = this.terrain.getHeightAt(hx, hz);
    if (hy <= terrainY + PROJECTILE.radius) {
      this._die();
    }
  }

  dispose() {
    if (this._headMesh) {
      this.scene.remove(this._headMesh);
      this._headMesh.geometry.dispose();
      this._headMesh.material.dispose();
      this._headMesh = null;
    }
    for (const mesh of this._trailMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._trailMeshes       = [];
    this._snapshotPositions = [];
    this.scene          = null;
    this.terrain        = null;
    this.owner          = null;
    this.effectsManager = null;
  }
}
