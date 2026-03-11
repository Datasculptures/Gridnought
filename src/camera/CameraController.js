import * as THREE from 'three';
import { CAMERA, WORLD_SIZE, TERRAIN } from '../utils/constants.js';

export default class CameraController {
  constructor(camera, inputManager, terrain) {
    this.camera       = camera;
    this.inputManager = inputManager;
    this.terrain      = terrain;

    // Target values — the camera smoothly follows these
    this.yaw      = 0;
    this.pitch    = CAMERA.initialPitch;
    this.distance = CAMERA.initialDistance;
    this.target   = new THREE.Vector3(0, 0, 0);

    // Smoothed (current) values
    this.currentYaw      = this.yaw;
    this.currentPitch    = this.pitch;
    this.currentDistance = this.distance;
    this.currentTarget   = this.target.clone();

    // Pin mode — near-FPS camera locked behind the player tank
    this.isPinned    = false;
    this.playerTank  = null;
    this._pWasDown   = false;
    // Smoothed world position used only in pinned mode
    this._pinnedPos  = new THREE.Vector3();
    // Rear distance in pinned mode (zoom-adjustable, range 3–20)
    this._pinnedDist = 6;

    // Store bound wheel handler so it can be removed in dispose()
    this._onWheel = (event) => {
      if (this.isPinned) {
        // In pinned mode zoom adjusts rear distance (small step for FPS feel)
        this._pinnedDist += Math.sign(event.deltaY) * 1;
        this._pinnedDist  = Math.max(3, Math.min(20, this._pinnedDist));
      } else {
        this.distance += Math.sign(event.deltaY) * CAMERA.zoomSpeed;
        this.distance = Math.max(CAMERA.minDistance, Math.min(CAMERA.maxDistance, this.distance));
      }
      // Prevent page scroll only when the canvas is the event target
      if (event.target.tagName === 'CANVAS') {
        event.preventDefault();
      }
    };

    window.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /** Call from GameManager after the player tank is created. */
  setPlayerTank(tank) {
    this.playerTank = tank;
  }

  update(_delta) {
    const input = this.inputManager;

    // --- P key: toggle pin mode (one-shot on key press) ---
    const pDown = input.isKeyDown('KeyP');
    if (pDown && !this._pWasDown) {
      this.isPinned = !this.isPinned;
      if (this.isPinned) {
        // Seed smoothed position to current camera position so the transition
        // has no jump — the lerp will carry it smoothly to the ideal spot.
        this._pinnedPos.copy(this.camera.position);
        this._pinnedDist = 6;
      }
    }
    this._pWasDown = pDown;

    if (this.isPinned && this.playerTank) {
      // --- Pinned near-FPS mode: direct camera control, early return ---
      const tank    = this.playerTank;
      const tankPos = tank.group.position;
      const sin     = Math.sin(tank.heading);
      const cos     = Math.cos(tank.heading);

      // Ideal position: _pinnedDist behind the tank, 2.5 units above its base
      const rearX = tankPos.x - sin * this._pinnedDist;
      const rearZ = tankPos.z - cos * this._pinnedDist;
      const rearY = Math.max(
        tankPos.y + 2.5,
        this.terrain.getHeightAt(rearX, rearZ) + TERRAIN.cameraFloorOffset,
      );

      // Smooth lerp (0.2 α → tight follow that stays behind the tank)
      this._pinnedPos.x += (rearX - this._pinnedPos.x) * 0.2;
      this._pinnedPos.y += (rearY - this._pinnedPos.y) * 0.2;
      this._pinnedPos.z += (rearZ - this._pinnedPos.z) * 0.2;

      this.camera.position.copy(this._pinnedPos);

      // Look at a point 20 units forward at just above turret height
      this.camera.lookAt(
        tankPos.x + sin * 20,
        tankPos.y + 1.5,
        tankPos.z + cos * 20,
      );
      return; // skip spherical orbit update below

    } else {
      // --- Free orbit mode ---

      // Rotation
      if (input.isKeyDown('KeyQ')) this.yaw -= CAMERA.rotateSpeed;
      if (input.isKeyDown('KeyE')) this.yaw += CAMERA.rotateSpeed;

      // Panning (relative to current yaw so "up" moves away from camera)
      let panX = 0;
      let panZ = 0;
      if (input.isKeyDown('ArrowUp'))    { panX += Math.sin(this.yaw);  panZ += Math.cos(this.yaw); }
      if (input.isKeyDown('ArrowDown'))  { panX -= Math.sin(this.yaw);  panZ -= Math.cos(this.yaw); }
      if (input.isKeyDown('ArrowLeft'))  { panX += Math.cos(this.yaw);  panZ -= Math.sin(this.yaw); }
      if (input.isKeyDown('ArrowRight')) { panX -= Math.cos(this.yaw);  panZ += Math.sin(this.yaw); }

      this.target.x += panX * CAMERA.panSpeed;
      this.target.z += panZ * CAMERA.panSpeed;

      // Clamp target to world bounds
      const halfWorld = WORLD_SIZE / 2;
      this.target.x = Math.max(-halfWorld, Math.min(halfWorld, this.target.x));
      this.target.z = Math.max(-halfWorld, Math.min(halfWorld, this.target.z));

      // Keep look-at point on the terrain surface
      this.target.y = this.terrain.getHeightAt(this.target.x, this.target.z);
    }

    // Clamp distance and pitch (applies in both modes — zoom always works)
    this.distance = Math.max(CAMERA.minDistance, Math.min(CAMERA.maxDistance, this.distance));
    this.pitch    = Math.max(CAMERA.minPitch,    Math.min(CAMERA.maxPitch,    this.pitch));

    // --- NaN guard: reset any non-finite values to safe defaults ---
    if (!Number.isFinite(this.yaw))      this.yaw      = 0;
    if (!Number.isFinite(this.pitch))    this.pitch    = CAMERA.initialPitch;
    if (!Number.isFinite(this.distance)) this.distance = CAMERA.initialDistance;
    if (!Number.isFinite(this.target.x)) this.target.x = 0;
    if (!Number.isFinite(this.target.y)) this.target.y = 0;
    if (!Number.isFinite(this.target.z)) this.target.z = 0;

    // --- Smooth interpolation (lerp toward target values each frame) ---
    const alpha = 0.08;
    this.currentYaw      += (this.yaw      - this.currentYaw)      * alpha;
    this.currentPitch    += (this.pitch    - this.currentPitch)    * alpha;
    this.currentDistance += (this.distance - this.currentDistance) * alpha;
    this.currentTarget.lerp(this.target, alpha);

    // --- Spherical coordinates → world position ---
    const sinYaw   = Math.sin(this.currentYaw);
    const cosYaw   = Math.cos(this.currentYaw);
    const sinPitch = Math.sin(this.currentPitch);
    const cosPitch = Math.cos(this.currentPitch);

    let x = this.currentTarget.x + this.currentDistance * sinYaw  * cosPitch;
    let y = this.currentTarget.y + this.currentDistance * sinPitch;
    let z = this.currentTarget.z + this.currentDistance * cosYaw  * cosPitch;

    // --- Terrain floor: push camera above surface if it would clip through ---
    const floorY = this.terrain.getHeightAt(x, z) + TERRAIN.cameraFloorOffset;
    if (y < floorY) y = floorY;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.currentTarget);
  }

  dispose() {
    window.removeEventListener('wheel', this._onWheel);
    this.camera       = null;
    this.inputManager = null;
    this.terrain      = null;
    this.playerTank   = null;
  }
}
