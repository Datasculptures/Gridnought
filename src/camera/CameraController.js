import * as THREE from 'three';
import { CAMERA, TERRAIN } from '../utils/constants.js';

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

    // First-person mode — commander's view from the turret cupola,
    // driven by pointer-lock mouse look. Toggled with P.
    this.isPinned    = false;
    this.playerTank  = null;
    this._canvas     = null;

    // Store bound wheel handler so it can be removed in dispose()
    this._onWheel = (event) => {
      if (!this.isPinned) {
        this.distance += Math.sign(event.deltaY) * CAMERA.zoomSpeed;
        this.distance = Math.max(CAMERA.minDistance, Math.min(CAMERA.maxDistance, this.distance));
      }
      // Prevent page scroll only when the canvas is the event target
      if (event.target.tagName === 'CANVAS') {
        event.preventDefault();
      }
    };

    // Leaving pointer lock (Esc) exits first-person mode
    this._onPointerLockChange = () => {
      if (this.isPinned && document.pointerLockElement !== this._canvas) {
        this.isPinned = false;
      }
    };

    window.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  /**
   * Toggles first-person mode. Must be called from within a real user
   * input event (transient activation) so pointer lock is granted.
   * @param {HTMLCanvasElement} canvas
   */
  toggleFirstPerson(canvas) {
    this._canvas = canvas || this._canvas;
    if (!this.isPinned) {
      this.isPinned = true;
      if (this.playerTank) this.playerTank.enterFirstPerson();
      this._canvas?.requestPointerLock?.();
    } else {
      this.isPinned = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  /** Call from GameManager after the player tank is created. */
  setPlayerTank(tank) {
    this.playerTank = tank;
  }

  update(_delta) {
    const input = this.inputManager;

    if (this.isPinned && this.playerTank) {
      // --- First-person commander view: camera at the turret cupola,
      //     looking along the turret's aim direction ---
      const tank    = this.playerTank;
      const tankPos = tank.group.position;
      const aimYaw  = tank.heading + tank.turretAngle; // turret world yaw
      const elev    = tank.getViewElevation ? tank.getViewElevation() : 0;

      const sinY = Math.sin(aimYaw);
      const cosY = Math.cos(aimYaw);
      const cosE = Math.cos(elev);
      const sinE = Math.sin(elev);

      // Eye: above the turret, nudged back so the barrel base stays in frame
      const eyeX = tankPos.x - sinY * 1.0;
      const eyeY = tankPos.y + 2.35;
      const eyeZ = tankPos.z - cosY * 1.0;

      this.camera.position.set(eyeX, eyeY, eyeZ);
      this.camera.lookAt(
        eyeX + sinY * cosE * 20,
        eyeY + sinE * 20,
        eyeZ + cosY * cosE * 20,
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
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (document.pointerLockElement) document.exitPointerLock();
    this.camera       = null;
    this.inputManager = null;
    this.terrain      = null;
    this.playerTank   = null;
    this._canvas      = null;
  }
}
