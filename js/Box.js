import {
  BOX_ANGULAR_DAMPING,
  BOX_DENSITY,
  BOX_FRICTION,
  BOX_LINEAR_DAMPING,
  BOX_RESTITUTION,
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  DYNAMIC_MAX_ORDER,
  ROCK_TILE_SCALE,
  ROCK_TINT,
  m2px,
  orderSize,
  Vec2,
  px2m,
} from './config.js';
import { GameObject } from './GameObject.js';
import { TilingSprite } from './Renderer.js';

const INTACT_MASK = CAT_WALL | CAT_INTACT | CAT_PARTICLE | CAT_CHARACTER;

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
   * @param {import('pixi.js').Texture | null} [rockTexture]
   */
  constructor(
    world,
    order,
    x,
    y,
    gx,
    gy,
    rootId,
    layer = null,
    angle = 0,
    rockTexture = null
  ) {
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
      filterCategoryBits: CAT_INTACT,
      filterMaskBits: INTACT_MASK,
    });

    if (layer && rockTexture) {
      this.gfx = new TilingSprite({
        texture: rockTexture,
        width: size,
        height: size,
      });
      this.gfx.anchor.set(0.5);
      this.gfx.tileScale.set(ROCK_TILE_SCALE, ROCK_TILE_SCALE);
      // World-locked UVs frozen at spawn — do not update in syncGfx.
      this.gfx.tilePosition.set(-x, -y);
      this.gfx.tint = ROCK_TINT;
      this.gfx.position.set(cx, cy);
      this.gfx.rotation = angle;
      layer.addChild(this.gfx);
    }
  }

  syncGfx() {
    if (!this.isDynamic || !this.gfx || !this.body) return;
    if (!this.body.isAwake()) return;
    const p = this.body.getPosition();
    this.gfx.position.set(m2px(p.x), m2px(p.y));
    this.gfx.rotation = this.body.getAngle();
  }
}
