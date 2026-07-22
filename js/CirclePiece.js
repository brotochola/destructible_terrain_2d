import {
  CAT_BOMB,
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  particleTunables,
  ROCK_PARTICLE_VISUAL,
  SHATTER_BALL_RADIUS,
  Vec2,
  m2px,
  px2m,
} from "./config.js";
import { GameObject } from "./GameObject.js";
import { Particle } from "./Renderer.js";

const PARTICLE_BASE_MASK = CAT_WALL | CAT_INTACT | CAT_CHARACTER | CAT_BOMB;

function particleMask(collide = particleTunables.collide) {
  return collide ? PARTICLE_BASE_MASK | CAT_PARTICLE : PARTICLE_BASE_MASK;
}

const PARTICLE_FIXTURE = {
  density: 1.2,
  friction: 0.6,
  restitution: 0.05,
  filterCategoryBits: CAT_PARTICLE,
  filterMaskBits: PARTICLE_BASE_MASK,
};

function rockScale(texture) {
  const tw = texture.width || 1;
  const th = texture.height || 1;
  return ROCK_PARTICLE_VISUAL / Math.max(tw, th);
}

/**
 * Shatter bolita — Pixi v8 Particle in a per-texture ParticleContainer bucket.
 * @param {import('pixi.js').ParticleContainer[] | null} buckets
 * @param {import('pixi.js').Texture[] | null} textures
 */
export class CirclePiece extends GameObject {
  constructor(world, cx, cy, buckets = null, textures = null) {
    super(
      world,
      {
        type: "dynamic",
        position: Vec2(px2m(cx), px2m(cy)),
        linearDamping: 0.4,
        angularDamping: 0.6,
      },
      "particle",
    );
    this.buckets = buckets;
    this.textures = textures;
    this.bornAt = performance.now();
    this.settleFrames = 0;
    this.pooled = false;
    this.inLayer = false;
    this.texIndex = 0;
    this.bucket = null;
    this._baseScale = 1;

    this.createCircleFixture(px2m(SHATTER_BALL_RADIUS), {
      ...PARTICLE_FIXTURE,
      filterMaskBits: particleMask(),
    });

    if (buckets && textures && textures.length) {
      this.texIndex = (Math.random() * textures.length) | 0;
      this.bucket = buckets[this.texIndex];
      const texture = textures[this.texIndex];
      this._baseScale = rockScale(texture);
      this.gfx = new Particle({
        texture,
        x: cx,
        y: cy,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: this._baseScale,
        scaleY: this._baseScale,
        rotation: 0,
        alpha: 1,
      });
      this.bucket.addParticle(this.gfx);
      this.inLayer = true;
    }
  }

  /** Update particle↔particle bit on live fixture (toggle mid-game). */
  setCollideParticles(on) {
    if (!this.body) return;
    const mask = particleMask(on);
    for (let f = this.body.getFixtureList(); f; f = f.getNext()) {
      f.setFilterMaskBits(mask);
    }
    if (on && this.body.isActive()) this.body.setAwake(true);
  }

  kick(minPx, maxPx) {
    const ang = Math.random() * Math.PI * 2;
    const mag = minPx + Math.random() * (maxPx - minPx);
    this.body.applyLinearImpulse(
      Vec2(Math.cos(ang), Math.sin(ang)).mul(px2m(mag)),
      this.body.getPosition(),
      true,
    );
  }

  _bindTexture(texIndex) {
    if (!this.gfx || !this.buckets || !this.textures) return;
    const next = this.textures[texIndex];
    if (!next) return;
    if (this.texIndex !== texIndex && this.bucket && this.inLayer) {
      this.bucket.removeParticle(this.gfx);
      this.inLayer = false;
    }
    this.texIndex = texIndex;
    this.bucket = this.buckets[texIndex];
    this._baseScale = rockScale(next);
    this.gfx.texture = next;
    this.gfx.scaleX = this._baseScale;
    this.gfx.scaleY = this._baseScale;
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
    if (this.gfx && this.textures && this.textures.length) {
      this._bindTexture((Math.random() * this.textures.length) | 0);
      this.gfx.x = cx;
      this.gfx.y = cy;
      this.gfx.rotation = 0;
      this.gfx.alpha = 1;
      if (this.bucket && !this.inLayer) {
        this.bucket.addParticle(this.gfx);
        this.inLayer = true;
      }
    }
  }

  deactivate() {
    this.pooled = true;
    this.body.setLinearVelocity(Vec2(0, 0));
    this.body.setAngularVelocity(0);
    this.body.setActive(false);
    if (this.gfx && this.bucket && this.inLayer) {
      this.bucket.removeParticle(this.gfx);
      this.inLayer = false;
    }
  }

  destroyGfx() {
    if (!this.gfx) return;
    if (this.bucket && this.inLayer) {
      try {
        this.bucket.removeParticle(this.gfx);
      } catch (_) {
        /* already removed */
      }
      this.inLayer = false;
    }
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
    this.gfx.x = x;
    this.gfx.y = y;
    this.gfx.rotation = this.body.getAngle();
    if (viewBounds) {
      const on =
        x >= viewBounds.x0 &&
        x <= viewBounds.x1 &&
        y >= viewBounds.y0 &&
        y <= viewBounds.y1;
      this.gfx.alpha = on ? 1 : 0;
    } else {
      this.gfx.alpha = 1;
    }
  }
}

/** Reuse CirclePiece bodies + particles instead of create/destroy churn. */
export class ParticlePool {
  /**
   * @param {*} world
   * @param {import('pixi.js').ParticleContainer[] | null} [buckets]
   * @param {import('pixi.js').Texture[] | null} [textures]
   */
  constructor(world, buckets = null, textures = null) {
    this.world = world;
    this.buckets = buckets;
    this.textures = textures;
    this.free = [];
  }

  acquire(cx, cy) {
    const piece = this.free.pop();
    if (piece) {
      piece.reactivate(cx, cy);
      return piece;
    }
    return new CirclePiece(this.world, cx, cy, this.buckets, this.textures);
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
