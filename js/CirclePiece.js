import {
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  SHATTER_BALL_RADIUS,
  Vec2,
  m2px,
  px2m,
} from './config.js';
import { GameObject } from './GameObject.js';
import { Sprite } from './Renderer.js';

const PARTICLE_FIXTURE = {
  density: 1.2,
  friction: 0.6,
  restitution: 0.05,
  filterCategoryBits: CAT_PARTICLE,
  filterMaskBits: CAT_WALL | CAT_INTACT | CAT_CHARACTER,
};

const PARTICLE_DIAM = SHATTER_BALL_RADIUS * 2;

function pickTexture(textures) {
  if (!textures || !textures.length) return null;
  return textures[(Math.random() * textures.length) | 0];
}

/** Fit larger rock art into physics diameter, keep aspect ratio. */
function applyRockScale(sprite, texture) {
  const tw = texture.width || 1;
  const th = texture.height || 1;
  const scale = PARTICLE_DIAM / Math.max(tw, th);
  sprite.width = tw * scale;
  sprite.height = th * scale;
}

export class CirclePiece extends GameObject {
  /**
   * @param {*} world
   * @param {number} cx
   * @param {number} cy
   * @param {import('pixi.js').Container | null} [layer]
   * @param {import('pixi.js').Texture[] | null} [textures]
   */
  constructor(world, cx, cy, layer = null, textures = null) {
    super(
      world,
      {
        type: 'dynamic',
        position: Vec2(px2m(cx), px2m(cy)),
        linearDamping: 0.4,
        angularDamping: 0.6,
      },
      'particle'
    );
    this.layer = layer;
    this.textures = textures;
    this.bornAt = performance.now();
    this.settleFrames = 0;
    this.pooled = false;
    this.inLayer = false;

    this.createCircleFixture(px2m(SHATTER_BALL_RADIUS), PARTICLE_FIXTURE);

    const texture = pickTexture(textures);
    if (layer && texture) {
      this.gfx = new Sprite(texture);
      this.gfx.anchor.set(0.5);
      applyRockScale(this.gfx, texture);
      this.gfx.position.set(cx, cy);
      layer.addChild(this.gfx);
      this.inLayer = true;
    }
  }

  kick(minPx, maxPx) {
    const ang = Math.random() * Math.PI * 2;
    const mag = minPx + Math.random() * (maxPx - minPx);
    this.body.applyLinearImpulse(
      Vec2(Math.cos(ang), Math.sin(ang)).mul(px2m(mag)),
      this.body.getPosition(),
      true
    );
  }

  reactivate(cx, cy) {
    this.pooled = false;
    this.bornAt = performance.now();
    this.settleFrames = 0;
    this.body.setActive(true);
    this.body.setTransform(Vec2(px2m(cx), px2m(cy)), 0);
    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.body.setAwake(true);
    if (this.gfx) {
      const texture = pickTexture(this.textures);
      if (texture) {
        this.gfx.texture = texture;
        applyRockScale(this.gfx, texture);
      }
      this.gfx.position.set(cx, cy);
      this.gfx.rotation = 0;
      this.gfx.alpha = 1;
      this.gfx.visible = true;
      if (this.layer && !this.inLayer) {
        this.layer.addChild(this.gfx);
        this.inLayer = true;
      }
    }
  }

  deactivate() {
    this.pooled = true;
    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.body.setActive(false);
    if (this.gfx && this.layer && this.inLayer) {
      this.layer.removeChild(this.gfx);
      this.inLayer = false;
    }
  }

  destroyGfx() {
    if (!this.gfx) return;
    if (this.layer && this.inLayer) {
      try {
        this.layer.removeChild(this.gfx);
      } catch (_) {
        /* already removed */
      }
      this.inLayer = false;
    }
    this.gfx.destroy({ texture: false, textureSource: false });
    this.gfx = null;
  }

  destroy() {
    this.destroyGfx();
    if (!this.body) return;
    this.world.destroyBody(this.body);
    this.body = null;
  }

  syncGfx(viewBounds = null) {
    if (!this.gfx || !this.body || this.pooled) return;
    if (!this.body.isAwake()) return;
    const p = this.body.getPosition();
    const x = m2px(p.x);
    const y = m2px(p.y);
    this.gfx.position.set(x, y);
    this.gfx.rotation = this.body.getAngle();
    if (viewBounds) {
      const onScreen =
        x >= viewBounds.x0 &&
        x <= viewBounds.x1 &&
        y >= viewBounds.y0 &&
        y <= viewBounds.y1;
      this.gfx.visible = onScreen;
    } else {
      this.gfx.visible = true;
    }
  }
}

/** Reuse CirclePiece bodies + rock sprites instead of create/destroy churn. */
export class ParticlePool {
  /**
   * @param {*} world
   * @param {import('pixi.js').Container | null} [layer]
   * @param {import('pixi.js').Texture[] | null} [textures]
   */
  constructor(world, layer = null, textures = null) {
    this.world = world;
    this.layer = layer;
    this.textures = textures;
    this.free = [];
  }

  acquire(cx, cy) {
    const piece = this.free.pop();
    if (piece) {
      piece.reactivate(cx, cy);
      return piece;
    }
    return new CirclePiece(this.world, cx, cy, this.layer, this.textures);
  }

  release(piece) {
    if (!piece || piece.pooled) return;
    piece.deactivate();
    this.free.push(piece);
  }

  destroyAll() {
    for (const piece of this.free) piece.destroy();
    this.free.length = 0;
  }
}
