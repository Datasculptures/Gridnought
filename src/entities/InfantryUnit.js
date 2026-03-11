import * as THREE from 'three';
import { INFANTRY, MACHINEGUN, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';
import { WeaponType } from '../weapons/WeaponTypes.js';

/**
 * A single enemy infantry unit.
 * Built-in AI: PATROL → CHASE/FIRE when player enters sightRange.
 * Fires burst of 3 MG rounds (straight-line, no gravity) at the player.
 * One hit from any projectile (except its own) destroys it.
 */
export default class InfantryUnit {
  /**
   * @param {THREE.Scene} scene
   * @param {{
   *   position:          {x:number, z:number},
   *   terrain:           object,
   *   movementValidator: object,
   * }} config
   */
  constructor(scene, config) {
    this.scene             = scene;
    this.terrain           = config.terrain;
    this.movementValidator = config.movementValidator;
    this.mineManager       = config.mineManager || null;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading     = Math.random() * Math.PI * 2;
    this.speed       = 0;
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;

    // Fire state
    this._fireCooldown = INFANTRY.fireCooldown; // don't fire on first frame

    // AI state
    this._aiState       = 'patrol';
    this._patrolTimer   = 0;
    this._patrolTarget  = this.heading;

    // Destruction effect
    this.destructionEffect = null;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);

    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  // ---------------------------------------------------------------------------
  // Mesh
  // ---------------------------------------------------------------------------

  _buildMesh() {
    // Solid black body + enemy-red wireframe silhouette
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this._wireMat = new THREE.MeshBasicMaterial({ color: COLORS.enemyTank, wireframe: true });

    this.group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.4, 0.9, 0.3);
    this.solidMesh = new THREE.Mesh(bodyGeo, this._solidMat);
    this.solidMesh.position.y = 0.45;
    this.wireMesh  = new THREE.Mesh(bodyGeo, this._wireMat);
    this.wireMesh.position.y = 0.45;

    this.group.add(this.solidMesh);
    this.group.add(this.wireMesh);
  }

  _applyTransform() {
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * @param {number}      delta
   * @param {object}      playerTank        - reference for targeting
   * @param {object}      projectileManager - for spawning MG rounds
   */
  update(delta, playerTank, projectileManager) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }

    const dx   = playerTank.position.x - this.position.x;
    const dz   = playerTank.position.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // --- AI state transitions ---
    if (dist <= INFANTRY.sightRange) {
      this._aiState = 'chase';
    } else if (this._aiState === 'chase') {
      this._aiState = 'patrol';
    }

    // --- Patrol: random walk ---
    if (this._aiState === 'patrol') {
      this._patrolTimer -= delta;
      if (this._patrolTimer <= 0) {
        this._patrolTarget = Math.random() * Math.PI * 2;
        this._patrolTimer  = 1.5 + Math.random() * 2.0;
      }
      this._turnToward(this._patrolTarget, delta);
      this.speed = INFANTRY.moveSpeed * 0.4;

    } else {
      // --- Chase / fire ---
      const targetHeading = Math.atan2(dx, dz);
      this._turnToward(targetHeading, delta);
      this.speed = (dist > INFANTRY.fireRange) ? INFANTRY.moveSpeed : 0;
    }

    // --- Movement ---
    if (this.speed > 0) {
      const nx = this.position.x + Math.sin(this.heading) * this.speed * delta;
      const nz = this.position.z + Math.cos(this.heading) * this.speed * delta;
      const check = this.movementValidator.canMoveTo(
        this.position.x, this.position.z, nx, nz,
      );
      const mineSafe = !this.mineManager || !this.mineManager.isMineNearby(nx, nz);
      if (check.allowed && mineSafe) {
        this.position.x = nx;
        this.position.z = nz;
      }
    }

    // --- Fire logic (single shot with cooldown) ---
    if (this._aiState === 'chase' && dist <= INFANTRY.fireRange) {
      this._fireCooldown -= delta;
      if (this._fireCooldown <= 0) {
        this._fireShot(playerTank, projectileManager);
        this._fireCooldown = INFANTRY.fireCooldown;
      }
    }

    this._applyTransform();
  }

  _turnToward(targetHeading, delta) {
    let diff = ((targetHeading - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), INFANTRY.turnSpeed * delta);
    this.heading = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  _fireShot(playerTank, projectileManager) {
    // Aim directly at player's centre (3D direction, then set y to 0 for flat)
    const dx = playerTank.position.x - this.position.x;
    const dz = playerTank.position.z - this.position.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    const dirX  = horiz > 0 ? dx / horiz : Math.sin(this.heading);
    const dirZ  = horiz > 0 ? dz / horiz : Math.cos(this.heading);

    const origin = new THREE.Vector3(
      this.position.x + dirX * 0.25,
      this.position.y + 0.7,        // gun height
      this.position.z + dirZ * 0.25,
    );
    const velocity = new THREE.Vector3(
      dirX * MACHINEGUN.muzzleVelocity,
      0,
      dirZ * MACHINEGUN.muzzleVelocity,
    );

    projectileManager.spawn({
      origin,
      velocity,
      owner:         this,
      color:         MACHINEGUN.enemyColor,
      radius:        MACHINEGUN.radius,
      gravity:       MACHINEGUN.gravity,
      maxFlightTime: MACHINEGUN.maxFlightTime,
      weaponType:    WeaponType.LIGHT_MG,
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the world-space centre of the infantry hit sphere. */
  getHitCenter() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + INFANTRY.hitYOffset,
      this.position.z,
    );
  }

  /** One hit kills infantry (no armour — any damage is fatal). */
  takeHit(zone = null, damage = 1) {
    if (!this.isAlive) return;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(
      this.scene,
      this.position.clone(),
      COLORS.enemyTank,
    );
  }

  /** Repositions infantry for a new round. */
  reset(pos) {
    if (this.destructionEffect) {
      this.destructionEffect.dispose();
      this.destructionEffect = null;
    }
    this.position.set(pos.x, 0, pos.z);
    this.position.y    = this.terrain.getHeightAt(pos.x, pos.z);
    this.heading       = Math.random() * Math.PI * 2;
    this.speed         = 0;
    this.isAlive       = true;
    this.isDestroyed   = false;
    this._fireCooldown = INFANTRY.fireCooldown;
    this._aiState      = 'patrol';
    this._patrolTimer  = 0;
    if (this.group) this.group.visible = true;
    this._applyTransform();
  }

  dispose() {
    if (this.destructionEffect) {
      this.destructionEffect.dispose();
      this.destructionEffect = null;
    }
    if (this.group) {
      this.scene.remove(this.group);
      if (this.wireMesh) this.wireMesh.geometry.dispose();
      this.group = null;
    }
    if (this._wireMat)   { this._wireMat.dispose();   this._wireMat   = null; }
    if (this._solidMat)  { this._solidMat.dispose();  this._solidMat  = null; }
    this.scene             = null;
    this.terrain           = null;
    this.movementValidator = null;
    this.mineManager       = null;
  }
}
