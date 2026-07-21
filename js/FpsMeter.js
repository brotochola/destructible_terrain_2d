/** EMA of section duration in ms (physics / render cost). */
export class MsMeter {
  constructor(smooth = 0.9) {
    this.smooth = smooth;
    this.ms = 0;
  }

  begin() {
    this._t0 = performance.now();
  }

  end() {
    const dt = performance.now() - this._t0;
    this.ms = this.ms === 0 ? dt : this.ms * this.smooth + dt * (1 - this.smooth);
    return this.ms;
  }
}

/** Real display FPS from rAF timestamps (≈60, not 1000/sectionMs). */
export class FrameFps {
  constructor() {
    this.fps = 0;
    this._frames = 0;
    this._windowStart = 0;
  }

  tick(now) {
    if (!this._windowStart) this._windowStart = now;
    this._frames++;
    const elapsed = now - this._windowStart;
    if (elapsed >= 500) {
      this.fps = (this._frames * 1000) / elapsed;
      this._frames = 0;
      this._windowStart = now;
    }
  }
}
