import {
  BOX_ANGULAR_DAMPING,
  BOX_DENSITY,
  BOX_FRICTION,
  BOX_LINEAR_DAMPING,
  BOX_RESTITUTION,
  DYNAMIC_MAX_ORDER,
  colorForOrder,
  hexToNum,
  m2px,
  orderSize,
  Vec2,
  px2m,
} from './config.js';
import { GameObject } from './GameObject.js';
import { Graphics } from './Renderer.js';

export class Box extends GameObject {
  /**
   * @param {number} order mamushka depth
   * @param {number} x world px top-left
   * @param {number} y world px top-left
   * @param {number} gx grid index within root
   * @param {number} gy grid index within root
   * @param {number|string} rootId unique per root mamushka
   * @param {import('pixi.js').Container} [layer]
   * @param {number} [angle] body angle radians
   */
  constructor(world, order, x, y, gx, gy, rootId, layer = null, angle = 0) {
    const size = orderSize(order);
    const isDynamic = order <= DYNAMIC_MAX_ORDER;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const bodyDef = {
      type: isDynamic ? 'dynamic' : 'static',
      position: Vec2(px2m(cx), px2m(cy)),
      angle,
    };
    if (isDynamic) {
      bodyDef.linearDamping = BOX_LINEAR_DAMPING;
      bodyDef.angularDamping = BOX_ANGULAR_DAMPING;
    }
    super(world, bodyDef, 'intact');
    this.order = order;
    this.gx = gx;
    this.gy = gy;
    this.rootId = rootId;
    this.x = x;
    this.y = y;
    this.size = size;
    this.isDynamic = isDynamic;
    this.createBoxFixture(px2m(size / 2), px2m(size / 2), {
      density: isDynamic ? BOX_DENSITY : 0,
      friction: BOX_FRICTION,
      restitution: BOX_RESTITUTION,
    });

    if (layer) {
      this.gfx = new Graphics()
        .rect(-size / 2, -size / 2, size, size)
        .fill(hexToNum(colorForOrder(order)))
        .stroke({ width: 0.5, color: 0x000000, alpha: 0.35 });
      this.gfx.position.set(cx, cy);
      this.gfx.rotation = angle;
      layer.addChild(this.gfx);
    }
  }

  syncGfx() {
    if (!this.isDynamic || !this.gfx || !this.body) return;
    const p = this.body.getPosition();
    this.gfx.position.set(m2px(p.x), m2px(p.y));
    this.gfx.rotation = this.body.getAngle();
  }
}
