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
  }

  init() {
    this.keys = new Map();
    this.mouse = { x: 0, y: 0 };
    this.mouseButtons = new Map();

    this._onKeyDown = (event) => {
      if (!VALID_KEYS.has(event.code)) return;
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

  isKeyDown(code) {
    return this.keys.get(code) || false;
  }

  getMousePosition() {
    return { x: this.mouse.x, y: this.mouse.y };
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
  }
}
