/**
 * Synthesised retro sound via WebAudio — no audio assets, all oscillators
 * and filtered noise, matching the wireframe aesthetic.
 *
 * The AudioContext can only start after a user gesture; init() installs
 * one-time listeners that resume it on the first click or keypress.
 *
 * Positional sounds attenuate by distance to a listener position that
 * GameManager updates each frame (the player tank).
 */
const HEARING_RANGE = 140; // world units beyond which sounds are inaudible

export default class SoundManager {
  constructor() {
    this.ctx      = null;
    this.master   = null;
    this.enabled  = true;
    this.listener = { x: 0, z: 0 };

    // Engine hum nodes (created lazily)
    this._engineOsc  = null;
    this._engineGain = null;

    this._unlockHandler = null;
  }

  init() {
    this._unlockHandler = () => {
      this._ensureContext();
    };
    window.addEventListener('pointerdown', this._unlockHandler);
    window.addEventListener('keydown', this._unlockHandler);
  }

  _ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setListenerPosition(x, z) {
    this.listener.x = x;
    this.listener.z = z;
  }

  /** Volume multiplier from distance to the listener (1 near, 0 far). */
  _attenuate(pos) {
    if (!pos) return 1;
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const d  = Math.sqrt(dx * dx + dz * dz);
    return Math.max(0, 1 - d / HEARING_RANGE);
  }

  _ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  /** Short buffer of white noise (shared). */
  _noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 1.0;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  _playNoise({ duration, filterFrom, filterTo, volume }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + duration);
  }

  _playTone({ type = 'square', from, to, duration, volume }) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  // ---------------------------------------------------------------------------
  // Game sounds
  // ---------------------------------------------------------------------------

  /** Main cannon: low thump + noise crack. */
  fire(pos) {
    if (!this._ready()) return;
    const v = this._attenuate(pos);
    if (v <= 0) return;
    this._playTone({ type: 'triangle', from: 120, to: 38, duration: 0.28, volume: 0.7 * v });
    this._playNoise({ duration: 0.18, filterFrom: 2400, filterTo: 300, volume: 0.4 * v });
  }

  /** Machine gun tick. */
  mg(pos) {
    if (!this._ready()) return;
    const v = this._attenuate(pos);
    if (v <= 0) return;
    this._playNoise({ duration: 0.06, filterFrom: 3600, filterTo: 900, volume: 0.25 * v });
  }

  /** Armor clank — non-fatal hit. */
  clank(pos) {
    if (!this._ready()) return;
    const v = this._attenuate(pos);
    if (v <= 0) return;
    this._playTone({ type: 'square', from: 820, to: 240, duration: 0.10, volume: 0.30 * v });
  }

  /** Vehicle/infantry destruction. */
  explosion(pos) {
    if (!this._ready()) return;
    const v = this._attenuate(pos);
    if (v <= 0) return;
    this._playNoise({ duration: 0.65, filterFrom: 1600, filterTo: 60, volume: 0.8 * v });
    this._playTone({ type: 'triangle', from: 90, to: 25, duration: 0.55, volume: 0.5 * v });
  }

  /** Power-up collect: rising blips. */
  pickup() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    [440, 660, 880].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.18, t + i * 0.07 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.07);
      osc.connect(gain).connect(this.master);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.08);
    });
  }

  /**
   * Engine hum — call every frame with normalised speed [0,1].
   * Pass 0 when not playing to fade the engine out.
   */
  engine(speedFrac) {
    if (!this._ready()) return;
    if (!this._engineOsc) {
      this._engineOsc = this.ctx.createOscillator();
      this._engineOsc.type = 'sawtooth';
      this._engineOsc.frequency.value = 50;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      this._engineGain = this.ctx.createGain();
      this._engineGain.gain.value = 0;
      this._engineOsc.connect(filter).connect(this._engineGain).connect(this.master);
      this._engineOsc.start();
    }
    const target = speedFrac > 0.01 ? 0.05 + speedFrac * 0.06 : 0.015;
    // Smooth toward targets to avoid zipper noise
    const g = this._engineGain.gain;
    g.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    this._engineOsc.frequency.setTargetAtTime(48 + speedFrac * 42, this.ctx.currentTime, 0.15);
  }

  engineOff() {
    if (this._engineGain && this.ctx) {
      this._engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  update(_delta) {}

  dispose() {
    window.removeEventListener('pointerdown', this._unlockHandler);
    window.removeEventListener('keydown', this._unlockHandler);
    if (this._engineOsc) {
      try { this._engineOsc.stop(); } catch (_e) { /* already stopped */ }
      this._engineOsc = null;
      this._engineGain = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
