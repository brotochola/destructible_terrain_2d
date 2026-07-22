import {
  CAT_BOMB,
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  Vec2,
  bombTunables,
  px2m,
} from "./config.js";
import { GameObject } from "./GameObject.js";
import { Graphics } from "./Renderer.js";

const BOMB_MASK =
  CAT_WALL | CAT_INTACT | CAT_PARTICLE | CAT_CHARACTER | CAT_BOMB;

export class Bomb extends GameObject {
  /**
   * @param {number} x world px
   * @param {number} y world px
   * @param {number} vx m/s
   * @param {number} vy m/s
   * @param {import('pixi.js').Container | null} layer
   * @param {number} [fuseMs]
   */
  constructor(world, x, y, vx, vy, layer = null, fuseMs = bombTunables.fuseMs) {
    super(
      world,
      {
        type: "dynamic",
        position: Vec2(px2m(x), px2m(y)),
        bullet: true,
        linearDamping: 0.05,
        angularDamping: 0.2,
      },
      "bomb",
    );
    this.spawnedAt = performance.now();
    this.fuseMs = fuseMs;
    const r = px2m(bombTunables.radiusBodyPx);
    this.createCircleFixture(r, {
      density: 0.8,
      friction: 0.4,
      restitution: 0.25,
      filterCategoryBits: CAT_BOMB,
      filterMaskBits: BOMB_MASK,
    });
    this.body.setLinearVelocity(Vec2(vx, vy));

    if (layer) {
      this.gfx = new Graphics();
      this._redraw(1);
      layer.addChild(this.gfx);
    }
  }

  _redraw(viewScale) {
    const r = bombTunables.radiusBodyPx;
    this.gfx.clear();
    this.gfx.circle(0, 0, r).fill(0x1a1a1a);
    this.gfx.circle(0, 0, r).stroke({
      width: 1.5 / viewScale,
      color: 0xff5533,
    });
    this.gfx.circle(r * 0.35, -r * 0.35, r * 0.22).fill(0xffcc66);
    this._viewScale = viewScale;
  }

  /** @returns {boolean} true when fuse expired */
  expired(now) {
    return now - this.spawnedAt >= this.fuseMs;
  }

  syncGfx(viewScale) {
    if (!this.gfx || !this.body) return;
    const { x, y } = this.getPositionPx();
    this.gfx.position.set(x, y);
    if (Math.abs(viewScale - (this._viewScale || 0)) > 0.001) {
      this._redraw(viewScale);
    }
  }
}
