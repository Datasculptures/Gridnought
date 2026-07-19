import * as THREE from 'three';
import { APC } from '../utils/constants.js';
import InfantryUnit from './InfantryUnit.js';
import DestructionEffect from '../rendering/DestructionEffect.js';

/**
 * Armoured Personnel Carrier — wanders the battlefield and periodically
 * deploys infantry when stopped.  2 HP.
 */
export default class APCVehicle {
  constructor(scene, config) {
    this.scene             = scene;
    this.terrain           = config.terrain;
    this.movementValidator = config.movementValidator;
    this.mineManager       = config.mineManager || null;
    this._onSpawnInfantry  = config.onSpawnInfantry || null;

    this.position    = new THREE.Vector3(config.position.x, 0, config.position.z);
    this.heading     = Math.random() * Math.PI * 2;
    this.speed       = 0;
    this.isAlive     = true;
    this.isDestroyed = false;
    this.isArmoured  = false;
    this._hp         = APC.hp;

    // Unified entity metadata (EntityManager contract)
    this.kind           = 'apc';
    this.faction        = 'enemy';
    this.hitRadius      = APC.hitRadius;
    this.scoreValue     = 5;
    this.blocksMovement = true;

    // Waypoint navigation
    this._waypoint     = new THREE.Vector3();
    this._waypointTime = 0;
    this._stuckTimer   = 0;
    this._lastPos      = this.position.clone();
    this._reverseTimer = 0;

    // Infantry deploy
    this._deployTimer     = APC.infantrySpawnInterval;
    this._infantrySpawned = 0;

    this.destructionEffect = null;

    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this._pickWaypoint();

    this._buildMesh();
    this._applyTransform();
    scene.add(this.group);
  }

  // ---------------------------------------------------------------------------
  // Mesh — armoured hull with side skirts, track boxes, turret hatch, MG stub
  // ---------------------------------------------------------------------------

  _buildMesh() {
    const S = new THREE.MeshBasicMaterial({
      color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const W = new THREE.MeshBasicMaterial({ color: APC.color, wireframe: true });
    this._solidMat = S;
    this._wireMat  = W;
    this.group = new THREE.Group();

    const h = APC.hull;
    const t = APC.turret;

    // Main hull
    this._box(h.width, h.height, h.depth,  0, h.height / 2, 0, S, W);

    // Sloped front glacis (thin wedge represented as a flatter box at front)
    this._box(h.width * 0.9, h.height * 0.55, 0.22,  0, h.height * 0.72, h.depth / 2, S, W);

    // Side skirts — thin vertical plates along each side
    const skW = 0.1, skH = 0.35, skD = h.depth * 0.9;
    const skX = h.width / 2 + skW / 2;
    const skY = 0.18;
    this._box(skW, skH, skD,  skX, skY, 0, S, W);
    this._box(skW, skH, skD, -skX, skY, 0, S, W);

    // Track boxes — low flat rectangles under each side
    const trW = 0.3, trH = 0.22, trD = h.depth + 0.3;
    const trX = h.width / 2 + trW / 2 - 0.05;
    const trY = trH / 2;
    this._box(trW, trH, trD,  trX, trY, 0, S, W);
    this._box(trW, trH, trD, -trX, trY, 0, S, W);

    // Flat turret box
    const turY = h.height + t.height / 2;
    this._box(t.width, t.height, t.depth,  0, turY, 0, S, W);

    // Hatch ring on turret top (square outline)
    this._box(0.7, 0.12, 0.7,  0, turY + t.height / 2 + 0.06, 0, S, W);

    // MG stub — thin box extending from turret front
    this._box(0.12, 0.12, 0.55,  0, turY, t.depth / 2 + 0.28, S, W);

    // Rear ramp hint — slightly raised plate at back
    this._box(h.width * 0.85, h.height * 0.6, 0.18,  0, h.height * 0.3, -h.depth / 2, S, W);
  }

  _box(w, h, d, x, y, z, S, W) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const ms  = new THREE.Mesh(geo, S);
    const mw  = new THREE.Mesh(geo, W);
    ms.position.set(x, y, z);
    mw.position.set(x, y, z);
    this.group.add(ms, mw);
  }

  _applyTransform() {
    this.position.y = this.terrain.getHeightAt(this.position.x, this.position.z);
    this.group.position.copy(this.position);
    const normal  = this.terrain.getNormalAt(this.position.x, this.position.z);
    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const up      = normal.normalize();
    const right   = new THREE.Vector3().crossVectors(up, forward).normalize();
    const fwd     = new THREE.Vector3().crossVectors(right, up).normalize();
    this.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, fwd),
    );
  }

  // ---------------------------------------------------------------------------
  // Waypoint navigation
  // ---------------------------------------------------------------------------

  _pickWaypoint() {
    // Wander: random point 20–70 units from the current position
    const ang = Math.random() * Math.PI * 2;
    const r   = 20 + Math.random() * 50;
    this._waypoint.set(
      this.position.x + Math.sin(ang) * r,
      0,
      this.position.z + Math.cos(ang) * r,
    );
    const dist = Math.sqrt(
      (this._waypoint.x - this.position.x) ** 2 +
      (this._waypoint.z - this.position.z) ** 2,
    );
    this._waypointTime = Math.max(8, dist / APC.moveSpeed + 4);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta, _ctx) {
    if (!this.isAlive) {
      if (this.destructionEffect && !this.destructionEffect.isComplete) {
        this.destructionEffect.update(delta);
      }
      return;
    }

    // Steer toward waypoint
    const dx   = this._waypoint.x - this.position.x;
    const dz   = this._waypoint.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    this._turnToward(Math.atan2(dx, dz), delta);
    this.speed = APC.moveSpeed;

    this._waypointTime -= delta;
    if (dist < 4 || this._waypointTime <= 0) this._pickWaypoint();

    // Stuck detection
    this._stuckTimer += delta;
    if (this._stuckTimer >= 1.0) {
      if (this.position.distanceTo(this._lastPos) < 0.5) this._pickWaypoint();
      this._lastPos.copy(this.position);
      this._stuckTimer = 0;
    }

    // Movement — briefly reverse when blocked to escape obstacles/vehicles
    if (this._reverseTimer > 0) {
      this._reverseTimer -= delta;
      const rx = this.position.x - Math.sin(this.heading) * this.speed * 0.5 * delta;
      const rz = this.position.z - Math.cos(this.heading) * this.speed * 0.5 * delta;
      if (this.movementValidator.canMoveTo(this.position.x, this.position.z, rx, rz, true).allowed) {
        this.position.x = rx;
        this.position.z = rz;
      }
    } else {
      const nx = this.position.x + Math.sin(this.heading) * this.speed * delta;
      const nz = this.position.z + Math.cos(this.heading) * this.speed * delta;
      const check    = this.movementValidator.canMoveTo(this.position.x, this.position.z, nx, nz, true);
      const mineSafe = !this.mineManager || !this.mineManager.isMineNearby(nx, nz);
      const vFree    = !this.movementValidator.isVehicleBlocked(nx, nz, this);
      if (check.allowed && mineSafe && vFree) {
        this.position.x = nx;
        this.position.z = nz;
      } else {
        this._pickWaypoint();
        this._reverseTimer = 0.7;
      }
    }

    // Infantry deploy — once every infantrySpawnInterval seconds, regardless of movement
    if (this._infantrySpawned < APC.maxInfantrySpawns) {
      this._deployTimer -= delta;
      if (this._deployTimer <= 0) {
        this._spawnInfantry();
        this._deployTimer = APC.infantrySpawnInterval;
      }
    }

    this._applyTransform();
  }

  _turnToward(targetHeading, delta) {
    let diff = ((targetHeading - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += Math.sign(diff) * Math.min(Math.abs(diff), APC.turnSpeed * delta);
    this.heading  = ((this.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  _spawnInfantry() {
    if (!this._onSpawnInfantry) return;
    const angle  = this.heading + Math.PI + (Math.random() - 0.5) * 1.2;
    const offset = 3.0 + Math.random() * 2.0;
    const inf = new InfantryUnit(this.scene, {
      position:          { x: this.position.x + Math.sin(angle) * offset,
                           z: this.position.z + Math.cos(angle) * offset },
      terrain:           this.terrain,
      movementValidator: this.movementValidator,
      mineManager:       this.mineManager,
    });
    this._infantrySpawned++;
    this._onSpawnInfantry(inf);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getHitCenter() {
    return new THREE.Vector3(this.position.x, this.position.y + APC.hitYOffset, this.position.z);
  }

  takeHit(damage = 1) {
    if (!this.isAlive) return false;
    this._hp -= damage;
    if (this._hp > 0) return false;
    this.isAlive     = false;
    this.isDestroyed = true;
    if (this.group) this.group.visible = false;
    this.destructionEffect = new DestructionEffect(this.scene, this.position.clone(), APC.color);
    return true;
  }

  reset(pos) {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    this.position.set(pos.x, 0, pos.z);
    this.position.y       = this.terrain.getHeightAt(pos.x, pos.z);
    this.heading          = Math.random() * Math.PI * 2;
    this.speed            = 0;
    this.isAlive          = true;
    this.isDestroyed      = false;
    this._hp              = APC.hp;
    this._stuckTimer      = 0;
    this._reverseTimer    = 0;
    this._deployTimer     = APC.infantrySpawnInterval;
    this._infantrySpawned = 0;
    this._lastPos.copy(this.position);
    this._pickWaypoint();
    if (this.group) this.group.visible = true;
    this._applyTransform();
  }

  dispose() {
    if (this.destructionEffect) { this.destructionEffect.dispose(); this.destructionEffect = null; }
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
      this.group = null;
    }
    if (this._wireMat)  { this._wireMat.dispose();  this._wireMat  = null; }
    if (this._solidMat) { this._solidMat.dispose(); this._solidMat = null; }
    this.scene = null; this.terrain = null; this.movementValidator = null;
    this.mineManager = null; this._onSpawnInfantry = null;
  }
}
