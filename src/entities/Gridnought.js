import * as THREE from 'three';
import { GRIDNOUGHT, COLORS } from '../utils/constants.js';
import DestructionEffect from '../rendering/DestructionEffect.js';
import { WeaponType } from '../weapons/WeaponTypes.js';

/**
 * Gridnought — a heavy, multi-turret war machine and the game's namesake, plus
 * a lighter scout that shares the walking chassis. Selected by `variant`:
 *
 *   • 'landship' — a long tracked land-battleship with three spine turrets.
 *   • 'hexapod'  — a six-legged walker with three deck turrets; as a boss it is
 *     the war machine that arrives past GRIDNOUGHT.spawnScore.
 *   • 'scout'    — a small, quick six-legged tank with a single turret and far
 *     less armour than a tank; spawns as a regular enemy.
 *
 * A plain EntityManager entity (kind 'gridnought', faction 'enemy'): it advances
 * on the nearest target, each turret tracks and fires independently, and the
 * legs step in an insect tripod gait.
 */
export default class Gridnought {
  constructor(scene, config) {
    this.scene   = scene;
    this.terrain = config.terrain;
    this.variant = ['landship', 'scout'].includes(config.variant) ? config.variant : 'hexapod';
    this.isBoss  = !!config.isBoss && this.variant === 'hexapod';

    this.position = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading  = config.position.heading ?? Math.random() * Math.PI * 2;

    this.isAlive = true;
    this.isDestroyed = false;
    this.isArmoured  = true;

    const spec = this._variantSpec();
    this._maxHp     = spec.hp;
    this._hp        = spec.hp;
    this._speed0    = spec.speed;
    this._standoff  = spec.standoff;

    // Unified entity metadata
    this.kind           = 'gridnought';
    this.faction        = 'enemy';
    this.hitRadius      = spec.hitR;
    this.scoreValue     = spec.score;
    this.blocksMovement = true;
    this.mgHitsToKill   = spec.mg;

    this._baseColor = this.isBoss ? GRIDNOUGHT.bossColor : GRIDNOUGHT.color;
    this._walkPhase = Math.random() * Math.PI * 2;
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

  _variantSpec() {
    switch (this.variant) {
      case 'landship':
        return { hp: 26, score: 60, hitR: 5.5, mg: 8, speed: GRIDNOUGHT.speed, standoff: 26 };
      case 'scout':
        return {
          hp: GRIDNOUGHT.scoutHp, score: GRIDNOUGHT.scoutScore, hitR: GRIDNOUGHT.scoutHitRadius,
          mg: GRIDNOUGHT.scoutMgHits, speed: GRIDNOUGHT.scoutSpeed, standoff: GRIDNOUGHT.scoutStandoff,
        };
      default: // hexapod (regular or boss)
        return {
          hp: this.isBoss ? GRIDNOUGHT.bossHp : GRIDNOUGHT.hp,
          score: this.isBoss ? GRIDNOUGHT.bossScore : GRIDNOUGHT.score,
          hitR: 5.5, mg: 8, speed: GRIDNOUGHT.speed, standoff: 26,
        };
    }
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

  /** A turret: rotating housing + barrel. Returns {pivot, muzzle, cooldown, yaw}. */
  _buildTurret(parent, x, y, z, scale = 1) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    this._part(new THREE.BoxGeometry(1.5 * scale, 0.8 * scale, 1.7 * scale), pivot, 0, 0.4 * scale, 0);
    this._part(new THREE.BoxGeometry(0.9 * scale, 0.45 * scale, 0.5 * scale), pivot, 0, 0.4 * scale, -1.0 * scale);
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
   * One insect leg: the femur splays up-and-out to a knee that rides ABOVE the
   * body, then the tibia drops steeply back down to a foot inside the knee — a
   * tall, spidery bent silhouette. Returns {root, hip, knee, side, gait}.
   */
  _buildLeg(x, y, z, side, gait) {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    this._part(new THREE.BoxGeometry(0.5, 0.5, 0.5), root, 0, 0, 0);          // hip housing
    const hip = new THREE.Group();                                           // fore/aft step (animated)
    root.add(hip);
    const coxa = new THREE.Group();
    coxa.rotation.z = side * 1.7;                                            // femur splays up & out
    hip.add(coxa);
    const femurLen = 1.8;
    this._part(new THREE.BoxGeometry(0.26, femurLen, 0.26), coxa, 0, -femurLen / 2, 0); // femur
    const knee = new THREE.Group();                                         // high spider knee, out to the side
    knee.position.y = -femurLen;
    knee.rotation.z = -side * 1.85;                                         // tibia drops back down (slightly inboard)
    coxa.add(knee);
    this._part(new THREE.BoxGeometry(0.36, 0.36, 0.36), knee, 0, 0, 0);     // knee joint
    const tibiaLen = 4.0;
    this._part(new THREE.BoxGeometry(0.18, tibiaLen, 0.18), knee, 0, -tibiaLen / 2, 0); // tibia
    this._part(new THREE.BoxGeometry(0.32, 0.2, 0.5), knee, 0, -tibiaLen, 0.05);        // foot / claw
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
      this._part(new THREE.BoxGeometry(5.5, 2.0, 13), this.group, 0, 1.4, 0);
      this._part(new THREE.BoxGeometry(6.2, 1.1, 13.4), this.group, 0, 0.55, 0);
      for (const sx of [-3.0, 3.0]) this._part(new THREE.BoxGeometry(0.6, 1.0, 12.6), this.group, sx, 0.5, 0);
      this._part(new THREE.BoxGeometry(4.6, 0.7, 7), this.group, 0, 2.6, -0.5);
      this.turrets.push(this._buildTurret(this.group, 0, 2.9,  4.0, 1.15));
      this.turrets.push(this._buildTurret(this.group, 0, 3.2,  0.0, 1.25));
      this.turrets.push(this._buildTurret(this.group, 0, 2.9, -4.2, 1.15));
      this._part(new THREE.BoxGeometry(1.6, 1.4, 1.6), this.group, 0, 3.9, -5.4);
      return;
    }

    // Hexapod walker (heavy) or scout (small, single turret)
    const scout = this.variant === 'scout';
    const deckY = 4.0;
    this._hitY  = scout ? 2.2 : deckY;

    this._part(new THREE.CylinderGeometry(3.4, 4.0, 1.8, 6), this.group, 0, deckY, 0);      // hull
    this._part(new THREE.CylinderGeometry(2.4, 3.0, 0.8, 6), this.group, 0, deckY + 1.1, 0); // upper deck
    this._part(new THREE.BoxGeometry(1.4, 1.2, 1.4), this.group, 0, deckY + 1.9, 0);        // sensor head

    // Six legs — three per side, alternating tripod gait
    const hipY = deckY - 0.3;
    let i = 0;
    for (const side of [-1, 1]) {
      for (const fz of [3.2, 0, -3.2]) {
        const leg = this._buildLeg(side * 3.4, hipY, fz, side, (i % 2 === 0) ? 0 : Math.PI);
        this.group.add(leg.root);
        this.legs.push(leg);
        i++;
      }
    }

    if (scout) {
      this.turrets.push(this._buildTurret(this.group, 0, deckY + 1.4, 0.6, 1.0)); // single turret
    } else {
      this.turrets.push(this._buildTurret(this.group,  0.0, deckY + 1.4,  2.4, 1.15));
      this.turrets.push(this._buildTurret(this.group, -2.2, deckY + 1.4, -1.6, 1.05));
      this.turrets.push(this._buildTurret(this.group,  2.2, deckY + 1.4, -1.6, 1.05));
    }

    if (scout) this.group.scale.setScalar(GRIDNOUGHT.scoutScale);
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

    if (chase?.isAlive) {
      const dx = chase.position.x - this.position.x;
      const dz = chase.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      let hd = ((desired - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.heading += Math.sign(hd) * Math.min(Math.abs(hd), GRIDNOUGHT.turnSpeed * delta);
      const move = dist > this._standoff ? this._speed0 : 0;
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

  /**
   * Insect tripod gait: each leg protracts (swings forward) with the foot
   * lifted, plants, then retracts (sweeps back) with the foot down. The two
   * tripods alternate, so three feet are always planted.
   */
  _animateLegs(delta) {
    const frac = Math.min(1, this._speed / this._speed0);
    const act  = 0.28 + frac;                            // a little idle shuffle, more when moving
    this._walkPhase += (0.5 + frac * 1.4) * delta * 3.4;
    const k = Math.min(1, 13 * delta);
    for (const leg of this.legs) {
      const ph = this._walkPhase + leg.gait;
      const swing = Math.sin(ph) * 0.5 * act;            // fore/aft protraction/retraction
      const lift  = Math.max(0, Math.cos(ph)) * 0.85 * act; // knee lifts during the forward swing
      leg.hip.rotation.x  += (swing - leg.hip.rotation.x) * k;
      leg.knee.rotation.x += ((0.12 + lift) - leg.knee.rotation.x) * k;
    }
  }

  _updateTurrets(delta, foe, projectileManager) {
    const fc = foe.getHitCenter ? foe.getHitCenter() : { x: foe.position.x, y: foe.position.y + 0.8, z: foe.position.z };
    for (const t of this.turrets) {
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
