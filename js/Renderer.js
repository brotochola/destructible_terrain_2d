import {
  Application,
  Container,
  Graphics,
} from 'https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.mjs';
import { H, W } from './config.js';

export class Renderer {
  constructor() {
    this.app = null;
    this.world = null;
    this.boxes = null;
    this.particles = null;
    this.fx = null;
    this.actors = null;
    this.laserGfx = null;
    this.canvas = null;
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      width: W,
      height: H,
      background: 0x0e1620,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.app.ticker.stop();

    this.canvas = this.app.canvas;
    this.canvas.id = 'c';
    document.body.appendChild(this.canvas);

    this.world = new Container();
    this.boxes = new Container();
    this.particles = new Container();
    this.fx = new Container();
    this.actors = new Container();
    this.world.addChild(this.boxes, this.particles, this.fx, this.actors);
    this.app.stage.addChild(this.world);

    this.laserGfx = new Graphics();
    this.fx.addChild(this.laserGfx);
  }

  applyCamera(camera) {
    const vs = camera.viewScale();
    this.world.position.set(W / 2, H / 2);
    this.world.scale.set(vs, vs);
    this.world.pivot.set(camera.cx, camera.cy);
  }

  clearLasers() {
    this.laserGfx.clear();
  }

  drawLasers(lasers, viewScale) {
    const g = this.laserGfx;
    g.clear();
    if (!lasers.length) return;
    for (const L of lasers) {
      g.moveTo(L.x0, L.y0);
      g.lineTo(L.x1, L.y1);
      g.stroke({ width: 4 / viewScale, color: 0x7ef9ff, alpha: 0.35 });
      g.moveTo(L.x0, L.y0);
      g.lineTo(L.x1, L.y1);
      g.stroke({ width: 1.5 / viewScale, color: 0x7ef9ff, alpha: 1 });
    }
  }

  render() {
    this.app.render();
  }
}

export { Graphics, Container };
