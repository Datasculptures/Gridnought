import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';

const Materials = Object.freeze({
  // Solid black fill behind the terrain grid lines
  terrainSolid: new THREE.MeshBasicMaterial({
    color: 0x000000,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }),
  playerTank: new THREE.MeshBasicMaterial({ color: COLORS.playerTank, wireframe: true }),
  enemyTank: new THREE.MeshBasicMaterial({ color: COLORS.enemyTank, wireframe: true }),
  projectile: new THREE.MeshBasicMaterial({ color: COLORS.projectile, wireframe: true }),
});

export default Materials;
