import * as THREE from 'three';
import { TANK, TURRET, PROJECTILE, MACHINEGUN, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';
import { WeaponType } from '../weapons/WeaponTypes.js';

// Per-class stats: armor HP per zone, speed multiplier, visual scale, points
const CLASS_HP    = Object.freeze({ light: 3,    medium: 5, heavy: 10   });
const CLASS_SPEED = Object.freeze({ light: 1.15, medium: 1, heavy: 0.75 });
const CLASS_SCALE = Object.freeze({ light: 0.85, medium: 1, heavy: 1.25 });
const CLASS_SCORE = Object.freeze({ light: 8,    medium: 10, heavy: 15  });

// BoxGeometry face-group → armor zone mapping
// Three.js groups: 0=+X(right), 1=-X(left), 2=+Y(top), 3=-Y(bottom), 4=+Z(front), 5=-Z(back)
const ZONE_FACE = Object.freeze({ rightSide: 0, leftSide: 1, top: 2, bottom: 3, front: 4, back: 5 });

/** Returns a fresh armor object (6 zones × maxHP each). */
function freshArmor(maxHP) {
  return { top: maxHP, front: maxHP, back: maxHP, leftSide: maxHP, rightSide: maxHP, bottom: maxHP };
}

export default class Tank {
  /**
   * @param {THREE.Scene} scene
   * @param {{
   *   position: {x: number, z: number, heading: number},
   *   color: number,
   *   terrain: object,
   *   inputManager: object|null,
   *   movementValidator: object
   * }} config
   */
  constructor(scene, config) {
    this.scene             = scene;
    this.terrain           = config.terrain;
    this.inputManager      = config.inputManager; // null → AI-controlled
    this.movementValidator = config.movementValidator;
    this._spawnConfig      = config.position;     // saved for NaN recovery
    this._color            = config.color;

    // --- State ---
    this.position          = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading           = config.position.heading; // hull rotation around Y (radians)
    this.turretAngle       = 0;      // relative to hull, normalised to [-π, π]
    this.turretTargetAngle = 0;
    this._elevation        = TANK.barrel.defaultElevation; // radians, 0=flat, positive=up
    this.speed             = 0;      // current forward speed (negative = reverse)
    this.isAlive           = true;
    this.isDestroyed       = false;
    this.reloadTimer       = 0;
    this.canFire           = true;

    // --- Tank class + armor ---
    this.tankClass         = config.tankClass ?? 'medium';
    this._armorMaxHP       = CLASS_HP[this.tankClass] ?? 5;
    this.classSpeed        = CLASS_SPEED[this.tankClass] ?? 1;
    this.scoreValue        = CLASS_SCORE[this.tankClass] ?? 10;
    this.isArmoured        = true;
    this.armor             = freshArmor(this._armorMaxHP);

    // --- First-person aim state (world-stabilised turret yaw) ---
    this._aimWorldYaw = null;

    // --- Power-up modifiers / audio ---
    this.reloadFactor = 1;     // <1 while rapid-fire is active
    this.speedFactor  = 1;     // >1 while overdrive is active
    this.damageFactor = 1;     // >1 while AP rounds are active
    this.soundManager = null;  // injected by GameManager

    // --- Machine gun burst state ---
    this._mgBurstLeft  = 0;
    this._mgBurstTimer = 0;
    this._mgCooldown   = 0;
    this._xWasDown     = false;

    // Destruction effect — created by destroy(), animated until complete
    this.destructionEffect = null;

    // Effects manager — injected by GameManager for muzzle flash
    this.effectsManager    = null;

    // Aim dependencies — injected after construction
    this.camera            = null;
    this.projectileManager = null;
    this._raycaster        = new THREE.Raycaster();

    // AI controller — set via setAIController() for AI-controlled tanks
    this.aiController      = null;

    // Camera controller — injected by GameManager for pinned-mode aim
    this.cameraController  = null;

    // Initial height from terrain
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);

    // Build mesh hierarchy and add to scene
    this._buildMesh(config.color);
    // Class silhouette: light tanks are visibly smaller, heavies bulkier
    const cs = CLASS_SCALE[this.tankClass] ?? 1;
    if (cs !== 1) this.group.scale.set(cs, cs, cs);
    this._applyTransform();
    scene.add(this.group);
  }

  /**
   * Provides the camera and projectile manager needed for turret aiming and firing.
   * Pass camera=null for AI-controlled tanks (they don't raycast from screen).
   */
  setAimDependencies(camera, projectileManager) {
    this.camera            = camera;
    this.projectileManager = projectileManager;
  }

  /** Wires an AIController to this tank for AI-driven input. */
  setAIController(aiController) {
    this.aiController = aiController;
  }

  /** Called when the player enters first-person mode — seeds the aim yaw. */
  enterFirstPerson() {
    this._aimWorldYaw = this.heading + this.turretAngle;
    if (this.inputManager) this.inputManager.consumeMouseDelta(); // discard stale motion
  }

  /** Barrel elevation as the first-person view pitch. */
  getViewElevation() {
    return this._elevation;
  }

  // ---------------------------------------------------------------------------
  // Mesh construction
  // ---------------------------------------------------------------------------

  _buildMesh(color) {
    // Wireframe material — tank's own colour for all parts
    this._wireMat = new THREE.MeshBasicMaterial({ color, wireframe: true });

    // Solid black material for turret and barrel (polygon offset sits behind wireframe)
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    // Per-face hull solid materials: one per BoxGeometry group (index 0-5), all start black
    this._hullFaceMats = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }));

    this.group = new THREE.Group();

    // ---- Hull ----
    const hullGeo = new THREE.BoxGeometry(TANK.hull.width, TANK.hull.height, TANK.hull.depth);
    // Solid fill (per-face colors, polygon-offset behind wireframe)
    this.hullSolidMesh = new THREE.Mesh(hullGeo, this._hullFaceMats);
    this.hullSolidMesh.position.y = TANK.hull.height / 2;
    // Wireframe on top
    this.hullMesh = new THREE.Mesh(hullGeo, this._wireMat);
    this.hullMesh.position.y = TANK.hull.height / 2;

    // ---- Detail parts (visual only — armor logic stays on the hull box) ----
    this._extraGeos = [];
    // Adds a solid+wire pair of `geo` to `parent` at (x,y,z) with rotation
    const detail = (geo, parent, x, y, z, rx = 0, ry = 0, rz = 0) => {
      this._extraGeos.push(geo);
      for (const mat of [this._solidMat, this._wireMat]) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.set(rx, ry, rz);
        parent.add(m);
      }
    };


    // ---- Hull greebles: skirts, fenders, engine deck, exhausts, sensors ----
    const skirtGeo = new THREE.BoxGeometry(0.12, 0.36, 3.3);
    detail(skirtGeo, this.group,  1.26, 0.40, 0);
    detail(skirtGeo, this.group, -1.26, 0.40, 0);
    const fenderGeo = new THREE.BoxGeometry(0.32, 0.08, 3.4);
    detail(fenderGeo, this.group,  1.12, 1.05, 0);
    detail(fenderGeo, this.group, -1.12, 1.05, 0);
    detail(new THREE.BoxGeometry(1.8, 0.18, 0.95), this.group, 0, 1.08, -1.20); // engine deck
    const exhaustGeo = new THREE.BoxGeometry(0.18, 0.15, 0.5);
    detail(exhaustGeo, this.group,  0.72, 1.14, -1.55);
    detail(exhaustGeo, this.group, -0.72, 1.14, -1.55);
    const sensorGeo = new THREE.BoxGeometry(0.22, 0.16, 0.22);
    detail(sensorGeo, this.group,  0.92, 1.06, 1.50); // front sensor pods
    detail(sensorGeo, this.group, -0.92, 1.06, 1.50);

    // ---- Turret pivot ----
    this.turretPivot = new THREE.Group();

    const turretGeo = new THREE.BoxGeometry(TANK.turret.width, TANK.turret.height, TANK.turret.depth);
    this.turretSolidMesh = new THREE.Mesh(turretGeo, this._solidMat);
    this.turretSolidMesh.position.set(0, TANK.turret.yOffset, 0);
    this.turretMesh = new THREE.Mesh(turretGeo, this._wireMat);
    this.turretMesh.position.set(0, TANK.turret.yOffset, 0);

    // ---- Turret greebles: bustle, cupola, angled side plates, mast, mantlet ----
    detail(new THREE.BoxGeometry(1.15, 0.48, 0.55), this.turretPivot, 0, 1.35, -1.12); // bustle
    detail(new THREE.CylinderGeometry(0.27, 0.27, 0.22, 6), this.turretPivot, -0.42, 1.80, -0.25); // cupola
    const platGeo = new THREE.BoxGeometry(0.08, 0.52, 1.25);
    detail(platGeo, this.turretPivot,  0.88, 1.35, -0.1, 0, 0, -0.22); // angled side plates
    detail(platGeo, this.turretPivot, -0.88, 1.35, -0.1, 0, 0,  0.22);
    detail(new THREE.BoxGeometry(0.05, 0.62, 0.05), this.turretPivot, 0.55, 1.95, -0.62); // sensor mast
    detail(new THREE.BoxGeometry(0.82, 0.46, 0.28), this.turretPivot, 0, 1.58, 0.95);     // gun mantlet

    // ---- Barrel elevation pivot ----
    this.barrelElevPivot = new THREE.Group();
    this.barrelElevPivot.position.set(0, TANK.barrel.topOffset, TANK.turret.depth / 2);

    const barrelGeo = new THREE.CylinderGeometry(
      TANK.barrel.radius, TANK.barrel.radius, TANK.barrel.length, 4,
    );
    this.barrelSolidMesh = new THREE.Mesh(barrelGeo, this._solidMat);
    this.barrelSolidMesh.rotation.x = Math.PI / 2;
    this.barrelSolidMesh.position.set(0, 0, TANK.barrel.length / 2);
    this.barrelMesh = new THREE.Mesh(barrelGeo, this._wireMat);
    this.barrelMesh.rotation.x = Math.PI / 2;
    this.barrelMesh.position.set(0, 0, TANK.barrel.length / 2);

    // ---- Barrel greebles: base sleeve + muzzle brake (elevate with the gun) ----
    const sleeveGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.7, 5);
    const muzzleGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.38, 5);
    for (const [geo, z] of [[sleeveGeo, 0.5], [muzzleGeo, 2.72]]) {
      this._extraGeos.push(geo);
      for (const mat of [this._solidMat, this._wireMat]) {
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = Math.PI / 2;
        m.position.set(0, 0, z);
        this.barrelElevPivot.add(m);
      }
    }

    // ---- Assembly ----
    this.barrelElevPivot.add(this.barrelSolidMesh);
    this.barrelElevPivot.add(this.barrelMesh);
    this.turretPivot.add(this.turretSolidMesh);
    this.turretPivot.add(this.turretMesh);
    this.turretPivot.add(this.barrelElevPivot);
    this.group.add(this.hullSolidMesh);
    this.group.add(this.hullMesh);
    this.group.add(this.turretPivot);
  }

  // ---------------------------------------------------------------------------
  // Transform helpers
  // ---------------------------------------------------------------------------

  _applyTransform() {
    const normal  = this.terrain.getNormalAt(this.position.x, this.position.z);
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const up      = normal.clone().normalize();
    const right   = new THREE.Vector3().crossVectors(up, forward).normalize();
    const correctedForward = new THREE.Vector3().crossVectors(right, up).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(right, up, correctedForward);
    this.group.quaternion.setFromRotationMatrix(rotMatrix);
    this.group.position.copy(this.position);
  }

  _transformIsValid() {
    const p = this.group.position;
    const q = this.group.quaternion;
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
        && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z)
        && Number.isFinite(q.w);
  }

  /**
   * Recolours the 5 armored hull faces: t=0 (full HP) → black; t=1 (0 HP) → tank colour.
   */
  _updateHullColors() {
    const tankColor = new THREE.Color(this._color);
    const black     = new THREE.Color(0x000000);
    for (const [zone, faceIdx] of Object.entries(ZONE_FACE)) {
      const hp = this.armor[zone];
      const t  = (this._armorMaxHP - hp) / this._armorMaxHP; // 0 = undamaged, 1 = destroyed
      this._hullFaceMats[faceIdx].color.copy(black.clone().lerp(tankColor, t));
    }
  }

  /**
   * Restores HP to every armor zone (repair power-up).
   * @param {number} amount
   */
  repair(amount) {
    if (!this.isAlive) return;
    for (const zone of Object.keys(this.armor)) {
      this.armor[zone] = Math.min(this._armorMaxHP, this.armor[zone] + amount);
    }
    this._updateHullColors();
  }

  /**
   * Applies one hit to an armor zone. Brightens the face, destroys tank if HP reaches 0.
   * @param {'top'|'front'|'back'|'leftSide'|'rightSide'} zone
   * @returns {boolean} true if the hit destroyed the tank
   */
  takeHit(zone, damage = 1) {
    if (!this.isAlive) return false;
    if (this.armor[zone] === undefined) return false;
    this.armor[zone] = Math.max(0, this.armor[zone] - damage);
    this._updateHullColors();
    if (this.armor[zone] === 0) {
      this.destroy();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Machine gun
  // ---------------------------------------------------------------------------

  /** Fires one MG round from the barrel tip in the current turret direction (flat, no gravity). */
  _fireMG() {
    if (!this.projectileManager) return;
    this.group.updateWorldMatrix(true, true);
    const origin     = this.getBarrelTip();
    const worldAngle = this.heading + this.turretAngle;
    const velocity   = new THREE.Vector3(
      Math.sin(worldAngle) * MACHINEGUN.muzzleVelocity,
      0,
      Math.cos(worldAngle) * MACHINEGUN.muzzleVelocity,
    );
    this.projectileManager.spawn({
      origin,
      velocity,
      owner:         this,
      color:         MACHINEGUN.playerColor,
      radius:        MACHINEGUN.radius,
      gravity:       MACHINEGUN.gravity,
      maxFlightTime: MACHINEGUN.maxFlightTime,
      canHitTanks:   false,
      weaponType:    WeaponType.LIGHT_MG,
      damageMultiplier: this.damageFactor,
    });
    this.soundManager?.mg(this.position);
    if (this.effectsManager) {
      this.effectsManager.spawnMuzzleFlash(origin.clone());
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta) {
    if (!this.isAlive) {
      // Animate destruction effect until it completes
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }

    // --- Determine input source ---
    let moveInput = 0;
    let turnInput = 0;
    let aimTarget = null;  // world-space THREE.Vector3, or null (player uses raycaster)
    let wantsFire = false;

    if (this.inputManager) {
      // Player-controlled
      if (this.inputManager.isKeyDown('KeyW')) moveInput += 1;
      if (this.inputManager.isKeyDown('KeyS')) moveInput -= 1;
      if (this.inputManager.isKeyDown('KeyA')) turnInput += 1;
      if (this.inputManager.isKeyDown('KeyD')) turnInput -= 1;
      wantsFire = this.inputManager.isMouseDown(0);

      // Barrel elevation — Comma lowers, Period raises
      if (this.inputManager.isKeyDown('Comma'))  this._elevation -= TANK.barrel.elevationSpeed * delta;
      if (this.inputManager.isKeyDown('Period'))  this._elevation += TANK.barrel.elevationSpeed * delta;
      this._elevation = Math.max(
        TANK.barrel.minElevation,
        Math.min(TANK.barrel.maxElevation, this._elevation),
      );

      // aimTarget stays null — player uses raycaster below
    } else if (this.aiController) {
      // AI-controlled — validate commands before using them
      const c = this.aiController.commands;
      moveInput = (c.moveInput === -1 || c.moveInput === 0 || c.moveInput === 1) ? c.moveInput : 0;
      turnInput = (c.turnInput === -1 || c.turnInput === 0 || c.turnInput === 1) ? c.turnInput : 0;
      if (c.aimTarget instanceof THREE.Vector3
          && Number.isFinite(c.aimTarget.x)
          && Number.isFinite(c.aimTarget.y)
          && Number.isFinite(c.aimTarget.z)) {
        aimTarget = c.aimTarget;
      }
      wantsFire = c.fire === true;

      // AI-commanded elevation
      if (Number.isFinite(c.elevation)) {
        this._elevation = Math.max(
          TANK.barrel.minElevation,
          Math.min(TANK.barrel.maxElevation, c.elevation),
        );
      }
    }

    // 2. Hull rotation — normalised to [0, 2π) to prevent long-session drift
    this.heading += turnInput * TANK.turnSpeed * delta;
    this.heading  = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // 3. Target speed
    let targetSpeed = 0;
    const spd = this.speedFactor * this.classSpeed;
    if      (moveInput > 0) targetSpeed =  TANK.moveSpeed * spd;
    else if (moveInput < 0) targetSpeed = -TANK.moveSpeed * TANK.reverseSpeedFactor * spd;

    // 4. Acceleration / deceleration
    const diff = targetSpeed - this.speed;
    const speedingUp = moveInput !== 0
      && Math.abs(this.speed) < Math.abs(targetSpeed)
      && (this.speed === 0 || Math.sign(this.speed) === Math.sign(targetSpeed));
    const rate = speedingUp ? TANK.acceleration : TANK.deceleration;
    this.speed += Math.sign(diff) * Math.min(Math.abs(diff), rate * delta);

    if (moveInput === 0 && Math.abs(this.speed) < 0.01) this.speed = 0;

    // 5. Slope slowdown
    const slopeMultiplier = this.movementValidator.getSlopeSpeedMultiplier(
      this.position.x, this.position.z, this.heading,
    );
    const effectiveSpeed = this.speed * slopeMultiplier;

    // 6. Proposed position
    const fromX = this.position.x;
    const fromZ = this.position.z;
    const newX  = fromX + Math.sin(this.heading) * effectiveSpeed * delta;
    const newZ  = fromZ + Math.cos(this.heading) * effectiveSpeed * delta;

    // 7. Movement validation — wall-slide on rejection (vehicle blocking skips slide)
    // AI tanks refuse ravine terrain; the player may risk it
    const avoidDeep = !this.inputManager;
    const vBlocked = this.movementValidator.isVehicleBlocked(newX, newZ, this);
    const check    = this.movementValidator.canMoveTo(fromX, fromZ, newX, newZ, avoidDeep);
    if (check.allowed && !vBlocked) {
      this.position.x = newX;
      this.position.z = newZ;
    } else if (!vBlocked) {
      const checkX = this.movementValidator.canMoveTo(fromX, fromZ, newX, fromZ, avoidDeep);
      const checkZ = this.movementValidator.canMoveTo(fromX, fromZ, fromX, newZ, avoidDeep);
      if (checkX.allowed) this.position.x = newX;
      if (checkZ.allowed) this.position.z = newZ;
      // Do NOT zero speed — keep it so the player can reverse out immediately
    }

    // 8. Ground clamping
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z)
                    + TANK.groundOffset;

    // 9 + 10. Terrain orientation + position
    this._applyTransform();

    // NaN guard
    if (!this._transformIsValid()) {
      console.warn('Tank: corrupt transform — resetting to spawn');
      this.reset(this._spawnConfig);
    }

    // 11. Reload timer (main gun)
    if (!this.canFire) {
      this.reloadTimer -= delta;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        this.canFire     = true;
      }
    }

    // 11b. Machine gun burst (player only — X key).
    // Stands down while X is bound to a drone strike on a locked target.
    if (this.inputManager) {
      const xDown = this.inputManager.isKeyDown('KeyX') && !(this.mgSuppressed?.());
      if (xDown && !this._xWasDown && this._mgCooldown <= 0 && this._mgBurstLeft === 0) {
        this._mgBurstLeft  = MACHINEGUN.burstCount;
        this._mgBurstTimer = 0;
      }
      this._xWasDown = xDown;
    }

    if (this._mgBurstLeft > 0) {
      this._mgBurstTimer -= delta;
      if (this._mgBurstTimer <= 0) {
        this._fireMG();
        this._mgBurstLeft--;
        this._mgBurstTimer = (this._mgBurstLeft > 0) ? MACHINEGUN.burstInterval : 0;
        if (this._mgBurstLeft === 0) this._mgCooldown = MACHINEGUN.cooldown;
      }
    } else {
      this._mgCooldown = Math.max(0, this._mgCooldown - delta);
    }

    // 12. Turret aiming
    let aimPoint = null;
    if (this.inputManager && this.camera) {
      const mousePos = this.inputManager.getMousePosition();
      this._raycaster.setFromCamera(mousePos, this.camera);

      if (this.cameraController?.isPinned) {
        // First-person mode: pointer-lock mouse look drives the turret.
        // The aim yaw is world-stabilised — rotating the hull doesn't drag
        // the gun off target (the turret counter-rotates to hold aim).
        const d    = this.inputManager.consumeMouseDelta();
        const SENS = 0.0022; // radians per pixel of mouse movement
        if (this._aimWorldYaw === null) {
          this._aimWorldYaw = this.heading + this.turretAngle;
        }
        // Yaw increases counter-clockwise (left), so mouse-right subtracts
        this._aimWorldYaw -= d.x * SENS;
        this._elevation = Math.max(
          TANK.barrel.minElevation,
          Math.min(TANK.barrel.maxElevation, this._elevation - d.y * SENS),
        );
        this.turretTargetAngle = ((this._aimWorldYaw - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      } else {
        // Free orbit mode: raycast against terrain for the aim point
        const hits = this._raycaster.intersectObjects(this.terrain.solidMeshes);
        if (hits.length > 0) aimPoint = hits[0].point;
      }
    } else if (aimTarget) {
      // AI: aim at the provided world position directly
      aimPoint = aimTarget;
    }

    if (aimPoint) {
      const dx = aimPoint.x - this.position.x;
      const dz = aimPoint.z - this.position.z;
      this.turretTargetAngle = Math.atan2(dx, dz) - this.heading;
      this.turretTargetAngle = ((this.turretTargetAngle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }

    if (aimPoint || (this.inputManager && this.camera)) {
      let turretDiff = this.turretTargetAngle - this.turretAngle;
      turretDiff = ((turretDiff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.turretAngle += Math.sign(turretDiff) * Math.min(Math.abs(turretDiff), TURRET.maxTraverseSpeed * delta);
      this.turretAngle = ((this.turretAngle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    }
    this.turretPivot.rotation.y = this.turretAngle;

    // Apply barrel elevation (negative X rotation raises the barrel)
    this.barrelElevPivot.rotation.x = -this._elevation;

    // 13. Firing
    if (wantsFire && this.canFire && this.projectileManager) {
      this.group.updateWorldMatrix(true, true);
      const origin = this.getBarrelTip();

      // Compute 3D launch velocity from turret world-angle + elevation
      const worldAngle = this.heading + this.turretAngle;
      const cosE = Math.cos(this._elevation);
      const sinE = Math.sin(this._elevation);
      const velocity = new THREE.Vector3(
        Math.sin(worldAngle) * cosE * PROJECTILE.muzzleVelocity,
        sinE                       * PROJECTILE.muzzleVelocity,
        Math.cos(worldAngle) * cosE * PROJECTILE.muzzleVelocity,
      );

      this.projectileManager.spawn({
        origin,
        velocity,
        owner:         this,
        color:         this.inputManager ? COLORS.projectile : COLORS.enemyProjectile,
        weaponType:    WeaponType.HEAVY_CANNON,
        damageMultiplier: this.damageFactor,
        gravity:       0,          // cannon fires straight — no arc
        maxFlightTime: 40,         // long enough to cross the full map twice
        explodeOnKill: true,       // detonate on impact
      });
      if (this.effectsManager) {
        this.effectsManager.spawnMuzzleFlash(origin.clone());
      }
      this.canFire     = false;
      this.reloadTimer = TANK.reloadTime * (this.reloadFactor ?? 1);
      this.soundManager?.fire(this.position);
    }

    // Reset one-shot AI fire command after reading
    if (this.aiController) {
      this.aiController.commands.fire = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** World-space position of the barrel tip. Ensures world matrix is current. */
  getBarrelTip() {
    this.group.updateWorldMatrix(true, true);
    // Tip is at the far end of the barrel in barrelElevPivot local space
    const localTip = new THREE.Vector3(0, 0, TANK.barrel.length);
    return this.barrelElevPivot.localToWorld(localTip);
  }

  /** Normalised world-space direction the hull is facing. */
  getForwardDirection() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** Normalised world-space direction the turret is pointing (horizontal only). */
  getTurretDirection() {
    const angle = this.heading + this.turretAngle;
    return new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  }

  /** [0, 1] reload progress — 1.0 = ready to fire. */
  getReloadProgress() {
    if (this.canFire) return 1.0;
    return Math.max(0, 1.0 - this.reloadTimer / TANK.reloadTime);
  }

  /**
   * Destroys the tank: hides the mesh, spawns a destruction effect, sets isAlive=false.
   * Safe to call only once — subsequent calls are no-ops.
   */
  destroy() {
    if (!this.isAlive) return;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(
      this.scene,
      this.position.clone(),
      this._color,
    );
  }

  /**
   * Resets the tank to the given spawn configuration.
   * @param {{ x: number, z: number, heading: number }} spawnConfig
   */
  reset(spawnConfig) {
    // Clean up any existing destruction effect
    if (this.destructionEffect) {
      this.destructionEffect.dispose();
      this.destructionEffect = null;
    }

    this.isDestroyed       = false;
    if (this.group) this.group.visible = true;

    this.position.set(spawnConfig.x, 0, spawnConfig.z);
    this.position.y        = this.terrain.getHeightAt(spawnConfig.x, spawnConfig.z);
    this.heading           = spawnConfig.heading;
    this.turretAngle       = 0;
    this.turretTargetAngle = 0;
    this._elevation        = TANK.barrel.defaultElevation;
    this.speed             = 0;
    this.isAlive           = true;
    this.reloadTimer       = 0;
    this.canFire           = true;

    // Restore full armor and reset face colours to black
    this.armor = freshArmor(this._armorMaxHP);
    this._updateHullColors();

    // Reset MG burst state
    this._mgBurstLeft  = 0;
    this._mgBurstTimer = 0;
    this._mgCooldown   = 0;
    this._xWasDown     = false;

    this._applyTransform();
  }

  dispose() {
    if (this.destructionEffect) {
      this.destructionEffect.dispose();
      this.destructionEffect = null;
    }

    if (this.group) {
      this.scene.remove(this.group);
      // Dispose each unique geometry once (solid+wire meshes share the same geo objects)
      if (this.hullMesh)   this.hullMesh.geometry.dispose();
      if (this.turretMesh) this.turretMesh.geometry.dispose();
      if (this.barrelMesh) this.barrelMesh.geometry.dispose();
      if (this._extraGeos) { this._extraGeos.forEach(g => g.dispose()); this._extraGeos = null; }
      this.group = null;
    }

    // Dispose per-tank materials
    if (this._wireMat)      { this._wireMat.dispose();                          this._wireMat      = null; }
    if (this._solidMat)     { this._solidMat.dispose();                         this._solidMat     = null; }
    if (this._hullFaceMats) { this._hullFaceMats.forEach(m => m.dispose());     this._hullFaceMats = null; }

    this.scene             = null;
    this.terrain           = null;
    this.inputManager      = null;
    this.movementValidator = null;
    this.camera            = null;
    this.projectileManager = null;
    this.effectsManager    = null;
    this.aiController      = null;
    this.cameraController  = null;
    this._raycaster        = null;
    this.hullSolidMesh     = null;
    this.hullMesh          = null;
    this.turretPivot       = null;
    this.turretSolidMesh   = null;
    this.turretMesh        = null;
    this.barrelElevPivot   = null;
    this.barrelSolidMesh   = null;
    this.barrelMesh        = null;
  }
}
