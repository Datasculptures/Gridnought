import { VALID_KEYS } from '../utils/constants.js';

export default class InputManager {
  constructor() {
    this.keys = null;
    this.mouse = null;
    this.mouseButtons = null;
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onMouseMove = null;
    this._onMouseDown = null;
    this._onMouseUp = null;
    this._onContextMenu = null;
    // Accumulated pointer-lock relative movement since last consume
    this._mouseDelta = { x: 0, y: 0 };
    // code → callback, invoked synchronously inside the DOM keydown event
    // (needed for APIs requiring transient user activation, e.g. pointer lock)
    this._keyPressCallbacks = new Map();
  }

  init() {
    this.keys = new Map();
    this.mouse = { x: 0, y: 0 };
    this.mouseButtons = new Map();

    this._onKeyDown = (event) => {
      // Don't swallow keys while the user types into a form field
      // (e.g. high-score initials entry)
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (!VALID_KEYS.has(event.code)) return;
      // One-shot callbacks fire on the initial press only (not auto-repeat)
      if (!this.keys.get(event.code) && !event.repeat) {
        const cb = this._keyPressCallbacks.get(event.code);
        if (cb) cb();
      }
      this.keys.set(event.code, true);
      event.preventDefault();
    };

    this._onKeyUp = (event) => {
      if (!VALID_KEYS.has(event.code)) return;
      this.keys.set(event.code, false);
    };

    this._onMouseMove = (event) => {
      this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      // Relative movement — meaningful under pointer lock
      this._mouseDelta.x += event.movementX || 0;
      this._mouseDelta.y += event.movementY || 0;
    };

    this._onMouseDown = (event) => {
      this.mouseButtons.set(event.button, true);
    };

    this._onMouseUp = (event) => {
      this.mouseButtons.set(event.button, false);
    };

    this._onContextMenu = (event) => {
      event.preventDefault();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  /**
   * Registers a callback fired synchronously inside the real keydown DOM
   * event for `code` (once per press). Use for actions that need transient
   * user activation, like requesting pointer lock.
   */
  onKeyPress(code, callback) {
    this._keyPressCallbacks.set(code, callback);
  }

  isKeyDown(code) {
    return this.keys.get(code) || false;
  }

  getMousePosition() {
    return { x: this.mouse.x, y: this.mouse.y };
  }

  /** Returns accumulated relative mouse movement and resets the accumulator. */
  consumeMouseDelta() {
    const d = { x: this._mouseDelta.x, y: this._mouseDelta.y };
    this._mouseDelta.x = 0;
    this._mouseDelta.y = 0;
    return d;
  }

  isMouseDown(button) {
    return this.mouseButtons.get(button) || false;
  }

  update(_delta) {
    // No-op — satisfies the system interface
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('contextmenu', this._onContextMenu);

    this.keys.clear();
    this.mouseButtons.clear();
    this.keys = null;
    this.mouse = null;
    this.mouseButtons = null;
    this._keyPressCallbacks.clear();
  }
}
