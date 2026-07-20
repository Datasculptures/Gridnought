import * as THREE from 'three';
import { EMPLACEMENT, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';
import { WeaponType } from '../weapons/WeaponTypes.js';

/**
 * Turret emplacement — an immobile enemy tank. A dug-in pedestal with a
 * full tank turret that tracks the player and fires cannon shells inside
 * its engagement range. Armoured (machine-gun rounds bounce off); 4 HP.
 */
export default class TurretEmplacement {
  /**
   * @param {THREE.Scene} scene
   * @param {{ position: {x,z}, terrain: object }} config
   */
  constructor(scene, config) {
    this.scene   = scene;
    this.terrain = config.terrain;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading     = Math.random() * Math.PI * 2; // pedestal facing (fixed)
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = true;
    this._hp         = EMPLACEMENT.hp;

    // Unified entity metadata
    this.kind           = 'turret';
    this.faction        = 'enemy';
    this.hitRadius      = EMPLACEMENT.hitRadius;
    this.scoreValue     = EMPLACEMENT.score;
    this.blocksMovement = true;

    this._turretYaw   = this.heading; // world yaw of the turret
    this._cooldown    = EMPLACEMENT.cooldown * (0.5 + Math.random() * 0.5);

    // Concealment — dormant and sunk until the player enters activateRange
    this._active   = false;
    this._riseY    = 0;  // 0 = fully sunk, 1 = fully raised

    this.destructionEffect = null;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);

    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  _buildMesh() {
    const S = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    // Starts camouflaged dark green; turns hostile red on activation
    const W = new THREE.MeshBasicMaterial({ color: EMPLACEMENT.dormantColor, wireframe: true });
    this._solidMat = S;
    this._wireMat  = W;
    this._geos = [];
    this.group = new THREE.Group();

    const part = (geo, parent, x, y, z, rx = 0) => {
      this._geos.push(geo);
      for (const mat of [S, W]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.x = rx;
        parent.add(m);
      }
    };

    // Dug-in pedestal base with a sloped collar
    part(new THREE.BoxGeometry(2.6, 0.7, 2.6), this.group, 0, 0.35, 0);
    part(new THREE.CylinderGeometry(1.15, 1.45, 0.5, 8), this.group, 0, 0.90, 0);

    // Rotating turret assembly — starts sunk into the pedestal (concealed)
    this.turretPivot = new THREE.Group();
    this._turretBaseY = 1.15;
    this.turretPivot.position.y = this._turretBaseY - EMPLACEMENT.riseHeight;
    part(new THREE.BoxGeometry(1.6, 0.7, 1.8), this.turretPivot, 0, 0.35, 0);          // turret
    part(new THREE.BoxGeometry(1.15, 0.48, 0.55), this.turretPivot, 0, 0.35, -1.12);   // bustle
    part(new THREE.CylinderGeometry(0.27, 0.27, 0.22, 6), this.turretPivot, -0.42, 0.80, -0.25); // cupola
    part(new THREE.BoxGeometry(0.82, 0.46, 0.28), this.turretPivot, 0, 0.45, 0.95);    // mantlet
    const barrelGeo = new THREE.CylinderGeometry(0.1, 0.1, 3.0, 4);
    for (const mat of [S, W]) {
      const m = new THREE.Mesh(barrelGeo, mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 0.42, 2.3);
      this.turretPivot.add(m);
    }
    this._geos.push(barrelGeo);

    this.group.add(this.turretPivot);
  }

  _applyTransform() {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;
  }

  getHitCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.1, this.position.z);
  }

  update(delta, ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }
    const player = ctx?.playerTank;
    if (!player?.isAlive) return;

    const dx   = player.position.x - this.position.x;
    const dz   = player.position.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Activation — stay concealed until the player wanders into range
    if (!this._active) {
      if (dist <= EMPLACEMENT.activateRange) {
        this._active = true;
        this._wireMat.color.setHex(COLORS.enemyTank); // go hostile red
      } else {
        return; // dormant: no rise, no track, no fire
      }
    }

    // Rise animation (concealed → deployed)
    if (this._riseY < 1) {
      this._riseY = Math.min(1, this._riseY + EMPLACEMENT.riseSpeed * delta / EMPLACEMENT.riseHeight);
      this.turretPivot.position.y = this._turretBaseY - (1 - this._riseY) * EMPLACEMENT.riseHeight;
    }

    // Slew the turret toward the player
    const targetYaw = Math.atan2(dx, dz);
    let diff = ((targetYaw - this._turretYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this._turretYaw += Math.sign(diff) * Math.min(Math.abs(diff), EMPLACEMENT.traverse * delta);
    this.turretPivot.rotation.y = this._turretYaw - this.heading;

    // Fire only once fully deployed, aimed, and in range
    this._cooldown -= delta;
    if (this._riseY >= 1 && dist <= EMPLACEMENT.range
        && Math.abs(diff) < EMPLACEMENT.aimTolerance && this._cooldown <= 0) {
      this._cooldown = EMPLACEMENT.cooldown;
      this._fire(player, ctx.projectileManager);
    }
  }

  _fire(player, projectileManager) {
    if (!projectileManager) return;
    // Muzzle position in world space
    const sin = Math.sin(this._turretYaw), cos = Math.cos(this._turretYaw);
    const origin = new THREE.Vector3(
      this.position.x + sin * 3.6,
      this.position.y + 1.55,
      this.position.z + cos * 3.6,
    );
    // Aim directly at the player's hit centre
    const target = new THREE.Vector3(player.position.x, player.position.y + 0.8, player.position.z);
    const dir = target.sub(origin).normalize();

    projectileManager.spawn({
      origin,
      velocity: dir.multiplyScalar(EMPLACEMENT.muzzleVelocity),
      owner:         this,
      color:         COLORS.enemyProjectile,
      weaponType:    WeaponType.EMPLACEMENT_CANNON,
      gravity:       0,
      maxFlightTime: (EMPLACEMENT.range * 1.2) / EMPLACEMENT.muzzleVelocity,
      explodeOnKill: true,
    });
  }

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this._hp -= damage;
    if (this._hp > 0) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), COLORS.enemyTank);
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
