import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  return scene;
}
