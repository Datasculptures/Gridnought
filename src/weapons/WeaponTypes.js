/**
 * Weapon type definitions.
 *
 * penetrating: true  → damages armoured targets (tanks).
 * penetrating: false → only damages unarmoured targets (infantry, drones).
 * mg: true           → small-arms fire. Vehicles and aircraft soak a fixed
 *   number of these before going down (see mgHitsToKill), so no plane or
 *   armoured vehicle can be swatted out of the sky with a single burst.
 * range: world-units; projectile is killed when it has travelled this distance.
 */
export const WeaponType = Object.freeze({
  LIGHT_MG: Object.freeze({
    id:          'LIGHT_MG',
    label:       'Light Machine Gun',
    range:       12,
    damage:      1,
    penetrating: false,
    mg:          true,
  }),
  HEAVY_MG: Object.freeze({
    id:          'HEAVY_MG',
    label:       'Heavy Machine Gun',
    range:       24,
    damage:      1,
    penetrating: false,
    mg:          true,
  }),
  // Infantry small-arms — chips away at tank armor, slowly
  INFANTRY_MG: Object.freeze({
    id:          'INFANTRY_MG',
    label:       'Infantry Machine Gun',
    range:       12,
    damage:      0.4,
    penetrating: true,
    mg:          true,
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
  // Emplacement gun — turret defenses; matches the tank main gun's reach
  EMPLACEMENT_CANNON: Object.freeze({
    id:          'EMPLACEMENT_CANNON',
    label:       'Emplacement Cannon',
    range:       95,
    damage:      2,
    penetrating: true,
  }),
  HEAVY_CANNON: Object.freeze({
    id:          'HEAVY_CANNON',
    label:       'Heavy Cannon',
    range:       95,    // long but finite — player, enemy tanks, and turrets all share it
    damage:      2,
    penetrating: true,
  }),
  // Player-selectable ammunition (number keys 1-3)
  PLAYER_MG: Object.freeze({
    id:          'PLAYER_MG',
    label:       'Machine Gun',
    range:       45,
    damage:      0.5,
    penetrating: true,
    mg:          true,
  }),
  AP_SHELL: Object.freeze({
    id:          'AP_SHELL',
    label:       'AP Shell',
    range:       95,
    damage:      4,     // double a regular shell
    penetrating: true,
  }),
});
