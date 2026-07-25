import * as THREE from 'three';
import { GRIDNOUGHT, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';
import { WeaponType } from '../weapons/WeaponTypes.js';

/**
 * Gridnought — a heavy, multi-turret war machine and the game's namesake. Two
 * chassis, selected by `variant`:
 *
 *   • 'landship' — a long tracked land-battleship with three turrets down its
 *     spine.
 *   • 'hexapod'  — a six-legged walker carrying three turrets on a raised deck;
 *     this is the level boss that arrives past GRIDNOUGHT.spawnScore.
 *
 * It is a plain EntityManager entity (kind 'gridnought', faction 'enemy'): it
 * advances on the nearest target, each turret tracks and fires independently,
 * and it soaks a huge amount of damage, brightening as its armour fails.
 */
export default class Gridnought {
  constructor(scene, config) {
    this.scene   = scene;
    this.terrain = config.terrain;
    this.variant = config.variant === 'landship' ? 'landship' : 'hexapod';
    this.isBoss  = !!config.isBoss;

    this.position = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading  = config.position.heading ?? Math.random() * Math.PI * 2;

    this.isAlive = true;
    this.isDestroyed = false;
    this.isArmoured  = true;

    this._maxHp = this.isBoss ? GRIDNOUGHT.bossHp : GRIDNOUGHT.hp;
    this._hp    = this._maxHp;

    // Unified entity metadata
    this.kind           = 'gridnought';
    this.faction        = 'enemy';
    this.hitRadius      = GRIDNOUGHT.hitRadius;
    this.scoreValue     = this.isBoss ? GRIDNOUGHT.bossScore : GRIDNOUGHT.score;
    this.blocksMovement = true;
    this.mgHitsToKill   = GRIDNOUGHT.mgHitsToKill;

    this._baseColor = this.isBoss ? GRIDNOUGHT.bossColor : GRIDNOUGHT.color;
    this._walkPhase = 0;
    this._speed     = 0;
    this.turrets    = [];
    this.legs       = [];
    this.destructionEffect = null;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z)
                    + GRIDNOUGHT.groundOffset;

    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  // ---------------------------------------------------------------------------
  // Model
  // ---------------------------------------------------------------------------

  _part(geo, parent, x, y, z, rx = 0, ry = 0, rz = 0) {
    this._geos.push(geo);
    for (const mat of [this._solidMat, this._wireMat]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
    }
  }

  /** A turret: rotating housing + barrel. Returns {pivot, muzzle, cooldown}. */
  _buildTurret(parent, x, y, z, scale = 1) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    this._part(new THREE.BoxGeometry(1.5 * scale, 0.8 * scale, 1.7 * scale), pivot, 0, 0.4 * scale, 0);
    this._part(new THREE.BoxGeometry(0.9 * scale, 0.45 * scale, 0.5 * scale), pivot, 0, 0.4 * scale, -1.0 * scale); // bustle
    const bl = 2.6 * scale;
    const barrelGeo = new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, bl, 4);
    this._geos.push(barrelGeo);
    for (const mat of [this._solidMat, this._wireMat]) {
      const m = new THREE.Mesh(barrelGeo, mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 0.45 * scale, bl / 2 + 0.6 * scale);
      pivot.add(m);
    }
    const muzzle = new THREE.Vector3(0, 0.45 * scale, bl + 0.6 * scale);
    return { pivot, muzzle, cooldown: GRIDNOUGHT.cooldown * (0.3 + Math.random() * 0.7), yaw: 0 };
  }

  /**
   * One insect-style walker leg: the femur splays sharply out to a high knee,
   * then the tibia drops back down to a foot near the body's footprint — the
   * classic bent, spidery silhouette. Returns {root, hip, knee, side, gait}.
   */
  _buildLeg(x, y, z, side, gait) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    this._part(new THREE.BoxGeometry(0.5, 0.5, 0.5), root, 0, 0, 0);          // hip housing
    const hip = new THREE.Group();                                           // fore/aft swing (animated)
    root.add(hip);
    const coxa = new THREE.Group();
    coxa.rotation.z = side * 1.15;                                           // splay the femur out to the side
    hip.add(coxa);
    const femurLen = 1.8;
    this._part(new THREE.BoxGeometry(0.26, femurLen, 0.26), coxa, 0, -femurLen / 2, 0); // femur (up-and-out)
    const knee = new THREE.Group();                                         // elbow, high and out to the side
    knee.position.y = -femurLen;
    knee.rotation.z = -side * 1.5;                                          // tibia drops back down past vertical
    coxa.add(knee);
    this._part(new THREE.BoxGeometry(0.34, 0.34, 0.34), knee, 0, 0, 0);     // knee joint
    const tibiaLen = 3.0;
    this._part(new THREE.BoxGeometry(0.2, tibiaLen, 0.2), knee, 0, -tibiaLen / 2, 0);  // tibia (down to the ground)
    this._part(new THREE.BoxGeometry(0.35, 0.2, 0.55), knee, 0, -tibiaLen, 0.05);      // foot / claw
    return { root, hip, knee, side, gait };
  }

  _buildMesh() {
    this._solidMat = new THREE.MeshBasicMaterial({
      color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this._wireMat = new THREE.MeshBasicMaterial({ color: this._baseColor, wireframe: true });
    this._geos = [];
    this.group = new THREE.Group();

    if (this.variant === 'landship') {
      this._hitY = 2.2;
      // Long tracked hull
      this._part(new THREE.BoxGeometry(5.5, 2.0, 13), this.group, 0, 1.4, 0);
      this._part(new THREE.BoxGeometry(6.2, 1.1, 13.4), this.group, 0, 0.55, 0);   // track deck
      for (const sx of [-3.0, 3.0]) {                                              // track skirts
        this._part(new THREE.BoxGeometry(0.6, 1.0, 12.6), this.group, sx, 0.5, 0);
      }
      this._part(new THREE.BoxGeometry(4.6, 0.7, 7), this.group, 0, 2.6, -0.5);    // spine deck
      // Three turrets down the spine
      this.turrets.push(this._buildTurret(this.group,  0, 2.9,  4.0, 1.15));
      this.turrets.push(this._buildTurret(this.group,  0, 3.2,  0.0, 1.25));
      this.turrets.push(this._buildTurret(this.group,  0, 2.9, -4.2, 1.15));
      // Command tower
      this._part(new THREE.BoxGeometry(1.6, 1.4, 1.6), this.group, 0, 3.9, -5.4);
    } else {
      // Hexapod walker — raised deck on six legs
      const deckY = 4.0;
      this._hitY = deckY;
      this._part(new THREE.CylinderGeometry(3.4, 4.0, 1.8, 6), this.group, 0, deckY, 0);  // hull
      this._part(new THREE.CylinderGeometry(2.4, 3.0, 0.8, 6), this.group, 0, deckY + 1.1, 0); // upper deck
      this._part(new THREE.BoxGeometry(1.4, 1.2, 1.4), this.group, 0, deckY + 1.9, 0);   // sensor mast head
      // Six legs — three per side, staggered fore/aft; alternating tripod gait
      const hipY = deckY - 0.3;
      let i = 0;
      for (const side of [-1, 1]) {
        for (const fz of [3.2, 0, -3.2]) {
          const gait = (i % 2 === 0) ? 0 : Math.PI; // alternating tripod
          this.legs.push(this._buildLeg(side * 3.4, hipY, fz, side, gait));
          this.group.add(this.legs[this.legs.length - 1].root);
          i++;
        }
      }
      // Three turrets around the upper deck
      this.turrets.push(this._buildTurret(this.group,  0.0, deckY + 1.4,  2.4, 1.15));
      this.turrets.push(this._buildTurret(this.group, -2.2, deckY + 1.4, -1.6, 1.05));
      this.turrets.push(this._buildTurret(this.group,  2.2, deckY + 1.4, -1.6, 1.05));
    }
  }

  _applyTransform() {
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.heading, 0);
  }

  getHitCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + this._hitY, this.position.z);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta, ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }

    const chase = ctx?.playerTank;
    const foe = ctx?.findHostile ? ctx.findHostile(this, GRIDNOUGHT.range * 2) : chase;

    // Advance on the player (steer the hull toward them, hold at standoff)
    if (chase?.isAlive) {
      const dx = chase.position.x - this.position.x;
      const dz = chase.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      let hd = ((desired - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.heading += Math.sign(hd) * Math.min(Math.abs(hd), GRIDNOUGHT.turnSpeed * delta);
      const move = dist > GRIDNOUGHT.standoff ? GRIDNOUGHT.speed : 0;
      this._speed = move;
      if (move) {
        this.position.x += Math.sin(this.heading) * move * delta;
        this.position.z += Math.cos(this.heading) * move * delta;
      }
    } else {
      this._speed = 0;
    }

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z) + GRIDNOUGHT.groundOffset;
    this._applyTransform();

    if (this.legs.length) this._animateLegs(delta);
    if (foe?.isAlive) this._updateTurrets(delta, foe, ctx.projectileManager);
  }

  _animateLegs(delta) {
    const frac = Math.min(1, this._speed / GRIDNOUGHT.speed);
    this._walkPhase += (0.6 + frac) * delta * 3.2;
    const k = Math.min(1, 10 * delta);
    for (const leg of this.legs) {
      const ph = this._walkPhase + leg.gait;
      const swing = Math.sin(ph) * 0.4 * (0.35 + frac);
      const lift  = Math.max(0, Math.sin(ph)) * 0.5 * (0.35 + frac);
      leg.hip.rotation.x  += (swing - leg.hip.rotation.x) * k;
      leg.knee.rotation.x += ((0.2 + lift) - leg.knee.rotation.x) * k;
    }
  }

  _updateTurrets(delta, foe, projectileManager) {
    const fc = foe.getHitCenter ? foe.getHitCenter() : { ...foe.position, y: foe.position.y + 0.8 };
    for (const t of this.turrets) {
      // World position of this turret
      const wp = t.pivot.getWorldPosition(new THREE.Vector3());
      const dx = fc.x - wp.x, dz = fc.z - wp.z;
      const dist = Math.hypot(dx, dz);
      const worldYaw = Math.atan2(dx, dz);
      const targetLocal = worldYaw - this.heading;
      let diff = ((targetLocal - t.pivot.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      t.pivot.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), GRIDNOUGHT.turretTraverse * delta);

      t.cooldown -= delta;
      if (dist <= GRIDNOUGHT.range && Math.abs(diff) < GRIDNOUGHT.aimTolerance && t.cooldown <= 0) {
        t.cooldown = GRIDNOUGHT.cooldown;
        this._fire(t, fc, projectileManager);
      }
    }
  }

  _fire(turret, targetCenter, projectileManager) {
    if (!projectileManager) return;
    turret.pivot.updateWorldMatrix(true, true);
    const origin = turret.pivot.localToWorld(turret.muzzle.clone());
    const dir = new THREE.Vector3(targetCenter.x, targetCenter.y, targetCenter.z).sub(origin).normalize();
    projectileManager.spawn({
      origin,
      velocity: dir.multiplyScalar(GRIDNOUGHT.muzzleVelocity),
      owner:         this,
      color:         COLORS.enemyProjectile,
      weaponType:    WeaponType.EMPLACEMENT_CANNON,
      gravity:       0,
      maxFlightTime: (GRIDNOUGHT.range * 1.3) / GRIDNOUGHT.muzzleVelocity,
      explodeOnKill: true,
    });
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this._hp -= damage;
    // Brighten toward white as the armour fails
    const t = 1 - Math.max(0, this._hp) / this._maxHp;
    this._wireMat.color.copy(new THREE.Color(this._baseColor).lerp(new THREE.Color(0xffffff), t * 0.7));
    if (this._hp > 0) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.getHitCenter(), this._baseColor);
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
    this.scene = null; this.terrain = null; this.turrets = []; this.legs = [];
  }
}
