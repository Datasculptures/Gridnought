/**
 * Weapon type definitions.
 *
 * penetrating: true  → damages armoured targets (tanks).
 * penetrating: false → only damages unarmoured targets (infantry, drones).
 * range: world-units; projectile is killed when it has travelled this distance.
 */
export const WeaponType = Object.freeze({
  LIGHT_MG: Object.freeze({
    id:          'LIGHT_MG',
    label:       'Light Machine Gun',
    range:       12,
    damage:      1,
    penetrating: false,
  }),
  HEAVY_MG: Object.freeze({
    id:          'HEAVY_MG',
    label:       'Heavy Machine Gun',
    range:       24,
    damage:      1,
    penetrating: false,
  }),
  // Infantry small-arms — chips away at tank armor, slowly
  INFANTRY_MG: Object.freeze({
    id:          'INFANTRY_MG',
    label:       'Infantry Machine Gun',
    range:       12,
    damage:      0.4,
    penetrating: true,
  }),
  // Air-dropped bomb — heavy area damage on impact
  BOMB: Object.freeze({
    id:          'BOMB',
    label:       'Aerial Bomb',
    range:       null,
    damage:      3,
    penetrating: true,
  }),
  LIGHT_CANNON: Object.freeze({
    id:          'LIGHT_CANNON',
    label:       'Light Cannon',
    range:       24,
    damage:      2,
    penetrating: true,
  }),
  HEAVY_CANNON: Object.freeze({
    id:          'HEAVY_CANNON',
    label:       'Heavy Cannon',
    range:       null,   // no range cap — killed by terrain hit, map edge, or maxFlightTime
    damage:      2,
    penetrating: true,
  }),
});
