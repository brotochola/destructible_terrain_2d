import {
  Application,
  Assets,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Sprite,
  Texture,
  TilingSprite,
} from 'https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.mjs';
import {
  H,
  MATERIALS,
  ROCK_PARTICLE_URLS,
  W,
  m2px,
} from './config.js';

const DEBUG_COLORS = {
  wall: 0x888888,
  intactStatic: 0x66aaff,
  intactDynamic: 0xffaa66,
  particle: 0xff6666,
  character: 0x66ff66,
  bomb: 0xff5533,
  other: 0xaaaaaa,
  joint: 0xffff00,
};

export class Renderer {
  constructor() {
    this.app = null;
    this.world = null;
    this.boxes = null;
    this.particles = null;
    this.particleTextures = null;
    this.particleBuckets = null;
    /** @type {Record<string, import('pixi.js').Texture>} */
    this.rockTextures = {};
    this.fx = null;
    this.actors = null;
    this.laserGfx = null;
    this.debugGfx = null;
    this.canvas = null;
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      width: W,
      height: H,
      background: 0x0e1620,
      antialias: false,
      resolution: 1,
      autoDensity: true,
    });
    this.app.ticker.stop();

    this.canvas = this.app.canvas;
    this.canvas.id = 'c';
    document.body.appendChild(this.canvas);

    this.particleTextures = await Promise.all(
      ROCK_PARTICLE_URLS.map((url) => Assets.load(url))
    );
    const urls = [...new Set(Object.values(MATERIALS).map((m) => m.textureUrl))];
    const loaded = await Promise.all(urls.map((url) => Assets.load(url)));
    const byUrl = Object.fromEntries(urls.map((url, i) => [url, loaded[i]]));
    this.rockTextures = {};
    for (const [id, mat] of Object.entries(MATERIALS)) {
      this.rockTextures[id] = byUrl[mat.textureUrl];
    }

    this.world = new Container();
    this.boxes = new Container();
    // One ParticleContainer per rock texture (shared TextureSource required).
    this.particles = new Container();
    this.particleBuckets = this.particleTextures.map(
      (texture) =>
        new ParticleContainer({
          texture,
          dynamicProperties: {
            position: true,
            rotation: true,
            scale: true,
            color: true,
          },
        }),
    );
    for (const bucket of this.particleBuckets) {
      this.particles.addChild(bucket);
    }
    this.fx = new Container();
    this.actors = new Container();
    this.debugGfx = new Graphics();
    this.world.addChild(
      this.boxes,
      this.particles,
      this.fx,
      this.actors,
      this.debugGfx,
    );
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

  /** Blast rings on same fx layer (call after drawLasers — does not clear). */
  drawExplosions(explosions, viewScale) {
    if (!explosions || !explosions.length) return;
    const g = this.laserGfx;
    const lw = 2.5 / viewScale;
    for (const e of explosions) {
      g.circle(e.x, e.y, e.r);
      g.stroke({ width: lw, color: 0xffaa33, alpha: 0.55 });
      g.circle(e.x, e.y, e.r * 0.45);
      g.fill({ color: 0xff6622, alpha: 0.2 });
    }
  }

  clearDebug() {
    this.debugGfx.clear();
  }

  /** Hide boxes/particles/fx/actors; debugGfx stays. */
  setSpritesVisible(visible) {
    this.boxes.visible = visible;
    this.particles.visible = visible;
    this.fx.visible = visible;
    this.actors.visible = visible;
  }

  /**
   * Overlay Planck fixtures + joints in world px.
   * @returns {number} joint count
   */
  drawDebug(physWorld, viewScale) {
    const g = this.debugGfx;
    g.clear();
    const lw = 1.25 / viewScale;
    const jointR = 2.5 / viewScale;

    for (let body = physWorld.getBodyList(); body; body = body.getNext()) {
      const data = body.getUserData();
      const kind = data && data.kind;
      let color = DEBUG_COLORS.other;
      if (kind === 'wall') color = DEBUG_COLORS.wall;
      else if (kind === 'particle') color = DEBUG_COLORS.particle;
      else if (kind === 'character') color = DEBUG_COLORS.character;
      else if (kind === 'bomb') color = DEBUG_COLORS.bomb;
      else if (kind === 'intact') {
        color = body.isDynamic()
          ? DEBUG_COLORS.intactDynamic
          : DEBUG_COLORS.intactStatic;
      }

      for (let fix = body.getFixtureList(); fix; fix = fix.getNext()) {
        const shape = fix.getShape();
        const type = shape.getType();
        if (type === 'circle') {
          const center =
            typeof shape.getCenter === 'function'
              ? shape.getCenter()
              : shape.m_p || { x: 0, y: 0 };
          const c = body.getWorldPoint(center);
          g.circle(m2px(c.x), m2px(c.y), m2px(shape.getRadius()));
          g.stroke({ width: lw, color, alpha: 0.9 });
          continue;
        }

        // Polygon/box: prefer local verts (rotated), else AABB envelope.
        const verts = shape.m_vertices;
        const n = shape.m_count | 0;
        if (verts && n >= 2) {
          const v0 = body.getWorldPoint(verts[0]);
          g.moveTo(m2px(v0.x), m2px(v0.y));
          for (let i = 1; i < n; i++) {
            const v = body.getWorldPoint(verts[i]);
            g.lineTo(m2px(v.x), m2px(v.y));
          }
          g.closePath();
          g.stroke({ width: lw, color, alpha: 0.9 });
        } else {
          const aabb = fix.getAABB(0);
          if (!aabb) continue;
          const x0 = m2px(aabb.lowerBound.x);
          const y0 = m2px(aabb.lowerBound.y);
          const x1 = m2px(aabb.upperBound.x);
          const y1 = m2px(aabb.upperBound.y);
          g.rect(x0, y0, x1 - x0, y1 - y0);
          g.stroke({ width: lw, color, alpha: 0.9 });
        }
      }
    }

    let joints = 0;
    for (let joint = physWorld.getJointList(); joint; joint = joint.getNext()) {
      joints++;
      const a = joint.getAnchorA();
      const b = joint.getAnchorB();
      const ax = m2px(a.x);
      const ay = m2px(a.y);
      const bx = m2px(b.x);
      const by = m2px(b.y);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke({ width: lw, color: DEBUG_COLORS.joint, alpha: 0.95 });
      g.circle(ax, ay, jointR);
      g.circle(bx, by, jointR);
      g.fill({ color: DEBUG_COLORS.joint, alpha: 0.95 });
    }
    return joints;
  }

  render() {
    this.app.render();
  }
}

export { Graphics, Container, Particle, ParticleContainer, Sprite, Texture, TilingSprite };
