/**
 * Unified registry for all non-tank entities (infantry, trucks, APCs,
 * jammers, and future unit types).
 *
 * Every registered entity must expose:
 *   kind            string   — 'infantry' | 'truck' | 'apc' | 'jammer' | ...
 *   faction         string   — 'enemy' | 'neutral' | 'friendly'
 *   hitRadius       number   — projectile hit-sphere radius
 *   scoreValue      number   — points awarded on kill
 *   blocksMovement  boolean  — participates in vehicle-vs-vehicle blocking
 *   isAlive         boolean
 *   position        THREE.Vector3
 *   group           THREE.Group|null
 *   getHitCenter()  → THREE.Vector3
 *   takeHit(damage) → boolean (true when destroyed by this hit)
 *   update(delta, ctx)
 *   dispose()
 */
export default class EntityManager {
  constructor() {
    this.entities = [];
    this._onKill  = null;
  }

  add(entity) {
    this.entities.push(entity);
    return entity;
  }

  /** Callback fired with (entity, projectile|null) whenever an entity dies. */
  onKill(callback) {
    this._onKill = callback;
  }

  /** All entities of one kind (alive and dead). */
  byKind(kind) {
    return this.entities.filter(e => e.kind === kind);
  }

  /** Alive entities matching a predicate. */
  alive(predicate = null) {
    return this.entities.filter(e => e.isAlive && (!predicate || predicate(e)));
  }

  /** Alive entities that block vehicle movement. */
  getBlockers() {
    return this.entities.filter(e => e.isAlive && e.blocksMovement);
  }

  /**
   * Updates entities. In normal play update everything; during round-end
   * pass deadOnly=true so only destruction animations advance.
   */
  update(delta, ctx, { deadOnly = false } = {}) {
    for (const e of this.entities) {
      if (deadOnly && e.isAlive) continue;
      e.update(delta, ctx);
    }
  }

  /**
   * Single projectile-vs-entity collision pass.
   * Kills the projectile on any hit; fires onKill when the hit destroys.
   */
  checkProjectileHits(projectiles) {
    for (const proj of projectiles) {
      if (!proj.isAlive) continue;
      const pos = proj.position;
      if (!pos) continue;

      for (const e of this.entities) {
        if (!e.isAlive) continue;
        if (e.projectileTransparent) continue; // e.g. power-ups
        if (proj.owner === e) continue; // no self-hits
        const hc = e.getHitCenter();
        const dx = pos.x - hc.x;
        const dy = pos.y - hc.y;
        const dz = pos.z - hc.z;
        const r  = e.hitRadius;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          proj.kill();
          const destroyed = e.takeHit((proj.weaponType?.damage ?? 1) * (proj.damageMultiplier ?? 1));
          if (destroyed && typeof this._onKill === 'function') {
            try {
              this._onKill(e, proj);
            } catch (err) {
              console.error('EntityManager: onKill callback threw:', err);
            }
          }
          break; // projectile is dead — next projectile
        }
      }
    }
  }

  /** Show/hide alive entities of a faction (jammer flicker effect). */
  setFactionVisibility(faction, visible) {
    for (const e of this.entities) {
      if (e.faction === faction && e.group && e.isAlive) {
        e.group.visible = visible;
      }
    }
  }

  /** Disposes and removes every entity. */
  clear() {
    for (const e of this.entities) e.dispose();
    this.entities = [];
  }

  dispose() {
    this.clear();
    this._onKill = null;
  }
}
