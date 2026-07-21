import { H, MAX_ZOOM, MIN_ZOOM, W, ZOOM, bigSize, m2px } from './config.js';

export class Camera {
  constructor(cx, cy) {
    this.cx = cx;
    this.cy = cy;
    this.zoom = this.defaultZoom();
  }

  defaultZoom() {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (Math.min(W, H) * 0.92) / (bigSize * ZOOM)));
  }

  clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  viewScale() {
    return ZOOM * this.zoom;
  }

  setZoom(factor) {
    this.zoom = this.clampZoom(this.zoom * factor);
  }

  setZoomAbsolute(z) {
    this.zoom = this.clampZoom(z);
  }

  resetZoom() {
    this.zoom = this.defaultZoom();
  }

  screenToPhys(sx, sy) {
    const vs = this.viewScale();
    return {
      x: this.cx + (sx - W / 2) / vs,
      y: this.cy + (sy - H / 2) / vs,
    };
  }

  follow(character) {
    if (!character || !character.body) return;
    const p = character.body.getPosition();
    this.cx = m2px(p.x);
    this.cy = m2px(p.y);
  }
}
