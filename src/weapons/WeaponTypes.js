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
    range:       24,
    damage:      2,
    penetrating: true,
  }),
});
