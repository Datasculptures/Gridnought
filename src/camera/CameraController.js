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

    // Orbit-mode pan offset around the player anchor (arrow keys)
    this.panOffset   = { x: 0, z: 0 };

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

    // Losing pointer lock while pinned (browser Esc) is reported upward —
    // GameManager opens the pause menu; the camera stays in first person
    // so the paused scene keeps its view.
    this._onLockLost = null;
    this._onPointerLockChange = () => {
      if (this.isPinned && document.pointerLockElement !== this._canvas) {
        if (typeof this._onLockLost === 'function') this._onLockLost();
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
    if (!this.isPinned) {
      this.enterFirstPerson(canvas);
    } else {
      this.isPinned = false;
      // Re-centre the overview on the tank when dropping to third person
      this.panOffset.x = 0;
      this.panOffset.z = 0;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  /** GameManager registers its pause handler here. */
  onLockLost(callback) {
    this._onLockLost = callback;
  }

  /** Enters first-person directly (round start, P key). Needs activation. */
  enterFirstPerson(canvas) {
    this._canvas = canvas || this._canvas;
    this.isPinned = true;
    if (this.playerTank) this.playerTank.enterFirstPerson();
    this._canvas?.requestPointerLock?.();
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
      // Chassis-specific eye height + walk sway (the walker rocks with its gait)
      const eyeOff  = tank.getEyeOffset ? tank.getEyeOffset() : 2.35;
      const bob     = tank.getViewBob ? tank.getViewBob() : null;
      const aimYaw  = tank.heading + tank.turretAngle + (bob?.dyaw || 0); // aim world yaw
      const elev    = (tank.getViewElevation ? tank.getViewElevation() : 0) + (bob?.dpitch || 0);

      const sinY = Math.sin(aimYaw);
      const cosY = Math.cos(aimYaw);
      const cosE = Math.cos(elev);
      const sinE = Math.sin(elev);

      // Eye position: a chassis may pin it (the walker's open cockpit, which
      // already bobs with the gait); otherwise sit above the turret, nudged
      // back so the barrel base stays in frame.
      let eyeX, eyeY, eyeZ;
      const anchor = tank.getEyeWorld ? tank.getEyeWorld() : null;
      if (anchor) {
        eyeX = anchor.x; eyeY = anchor.y; eyeZ = anchor.z;
      } else {
        eyeX = tankPos.x - sinY * 1.0;
        eyeY = tankPos.y + eyeOff + (bob?.dy || 0);
        eyeZ = tankPos.z - cosY * 1.0;
      }

      this.camera.position.set(eyeX, eyeY, eyeZ);
      this.camera.lookAt(
        eyeX + sinY * cosE * 20,
        eyeY + sinE * 20,
        eyeZ + cosY * cosE * 20,
      );
      // Subtle roll so the horizon tips with each stride
      if (bob?.droll) this.camera.rotateZ(bob.droll);
      return; // skip spherical orbit update below

    } else {
      // --- Free orbit mode ---
      // The orbit is anchored to the player tank (the only fixed reference
      // in an infinite streaming world); arrow keys pan a bounded offset
      // around it so terrain is always in view.

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

      this.panOffset.x += panX * CAMERA.panSpeed;
      this.panOffset.z += panZ * CAMERA.panSpeed;
      // Clamp the pan so the view can't wander off the loaded chunk ring
      const panR = Math.sqrt(this.panOffset.x ** 2 + this.panOffset.z ** 2);
      if (panR > CAMERA.maxPanRadius) {
        this.panOffset.x *= CAMERA.maxPanRadius / panR;
        this.panOffset.z *= CAMERA.maxPanRadius / panR;
      }

      const anchor = this.playerTank ? this.playerTank.position : { x: 0, z: 0 };
      this.target.x = anchor.x + this.panOffset.x;
      this.target.z = anchor.z + this.panOffset.z;

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
