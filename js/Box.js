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
  m2px,
  orderSize,
  rockMushVisualSize,
  Vec2,
  px2m,
} from "./config.js";
import { GameObject } from "./GameObject.js";
import { Sprite } from "./Renderer.js";

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
   * @param {number} [mushVariant] recipe / pick index
   * @param {number} [texRot] extra sprite rotation (box.png / recipe rot)
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
    rockTexture = null,
    mushVariant = 0,
    texRot = 0,
  ) {
    const size = orderSize(order);
    const isDynamic = order <= DYNAMIC_MAX_ORDER;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const bodyDef = {
      type: isDynamic ? "dynamic" : "static",
      position: Vec2(px2m(cx), px2m(cy)),
      angle,
    };
    if (isDynamic) {
      bodyDef.linearDamping = BOX_LINEAR_DAMPING;
      bodyDef.angularDamping = BOX_ANGULAR_DAMPING;
    }
    super(world, bodyDef, "intact");
    this.order = order;
    this.gx = gx;
    this.gy = gy;
    this.rootId = rootId;
    this.x = x;
    this.y = y;
    this.size = size;
    this.isDynamic = isDynamic;
    this.mushVariant = mushVariant;
    this.texRot = texRot;
    this.createBoxFixture(px2m(size / 2), px2m(size / 2), {
      density: isDynamic ? BOX_DENSITY : 0,
      friction: BOX_FRICTION,
      restitution: BOX_RESTITUTION,
      filterCategoryBits: CAT_INTACT,
      filterMaskBits: INTACT_MASK,
    });

    if (layer && rockTexture) {
      // Visual > collider: overhang hides seams between neighbors.
      const visual = rockMushVisualSize(size);
      this.gfx = new Sprite(rockTexture);
      this.gfx.anchor.set(0.5);
      this.gfx.width = visual;
      this.gfx.height = visual;
      this.gfx.position.set(cx, cy);
      this.gfx.rotation = angle + texRot;
      layer.addChild(this.gfx);
    }
  }

  /** World-px AABB of current pose (axis-aligned; ignores rotation). */
  worldAabbInto(out) {
    if (this.body) {
      const p = this.body.getPosition();
      const hs = this.size / 2;
      out.x = m2px(p.x) - hs;
      out.y = m2px(p.y) - hs;
      out.size = this.size;
    } else {
      out.x = this.x;
      out.y = this.y;
      out.size = this.size;
    }
    return out;
  }

  worldAabb() {
    return this.worldAabbInto({ x: 0, y: 0, size: 0 });
  }

  overlapsBounds(bounds, aabb = null) {
    if (!bounds) return true;
    const a = aabb || this.worldAabbInto(_boxAabbScratch);
    return !(
      a.x + a.size < bounds.x0 ||
      a.x > bounds.x1 ||
      a.y + a.size < bounds.y0 ||
      a.y > bounds.y1
    );
  }

  /**
   * Cull gfx to viewBounds; sync transform if dynamic + awake.
   * Cull physics active state to activeBounds (laser-safe margin).
   */
  syncGfx(viewBounds = null, activeBounds = null) {
    if (!this.gfx || !this.body) return;
    this.syncSim(viewBounds, activeBounds);
    this.syncTransform();
  }

  /** Visibility + body active only. */
  syncSim(viewBounds = null, activeBounds = null) {
    if (!this.gfx || !this.body) return;
    const a = this.worldAabbInto(_boxAabbScratch);

    if (activeBounds) {
      const want = this.overlapsBounds(activeBounds, a);
      if (want) {
        if (!this.body.isActive()) {
          this.body.setActive(true);
          if (this.isDynamic) this.body.setAwake(true);
        }
      } else if (this.body.isActive()) {
        this.body.setActive(false);
      }
    }

    if (viewBounds) {
      this.gfx.visible = this.overlapsBounds(viewBounds, a);
    } else {
      this.gfx.visible = true;
    }
  }

  /** Hide + deactivate (left the query set). */
  forceCullOff() {
    if (this.gfx) this.gfx.visible = false;
    if (this.body && this.body.isActive()) this.body.setActive(false);
  }

  syncTransform() {
    if (!this.isDynamic || !this.gfx || !this.body) return;
    if (!this.body.isAwake()) return;
    const p = this.body.getPosition();
    this.gfx.position.set(m2px(p.x), m2px(p.y));
    this.gfx.rotation = this.body.getAngle() + this.texRot;
  }
}

const _boxAabbScratch = { x: 0, y: 0, size: 0 };
