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
  ROCK_CACHE_MAX_PX,
  ROCK_EDGE_AMP,
  ROCK_EDGE_AMP2,
  ROCK_EDGE_SAMPLES_PER_STEP,
  ROCK_EDGE_SEED,
  ROCK_EDGE_STEP,
  ROCK_EDGE_STROKE,
  ROCK_EDGE_STROKE_OUTSET,
  ROCK_EDGE_STROKE_WIDTH_FRAC,
  ROCK_EDGE_STROKE_WIDTH_MAX,
  ROCK_TILE_SCALE,
  ROCK_TINT,
  m2px,
  orderSize,
  Vec2,
  px2m,
} from "./config.js";
import { GameObject } from "./GameObject.js";
import { Container, Graphics, TilingSprite } from "./Renderer.js";

const INTACT_MASK = CAT_WALL | CAT_INTACT | CAT_PARTICLE | CAT_CHARACTER;

/** Deterministic 0..1 from integer seeds. */
function hash01(a, b, c = 0) {
  let h =
    (Math.imul(a | 0, 374761393) +
      Math.imul(b | 0, 668265263) +
      Math.imul(c | 0, 2147483647)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function soft01(t) {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise at layout cell scale. */
function valueNoise2(seed, layoutX, layoutY, step) {
  const gx = layoutX / step;
  const gy = layoutY / step;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = soft01(gx - x0);
  const fy = soft01(gy - y0);
  const v00 = hash01(seed, x0, y0);
  const v10 = hash01(seed, x0 + 1, y0);
  const v01 = hash01(seed, x0, y0 + 1);
  const v11 = hash01(seed, x0 + 1, y0 + 1);
  const v0 = v00 + (v10 - v00) * fx;
  const v1 = v01 + (v11 - v01) * fx;
  return v0 + (v1 - v0) * fy;
}

/**
 * Soft inset from layout-space position (2 octaves).
 * Axis salt so floors/ceilings ≠ copy of walls. Stable across splits.
 */
function edgeInset(edgeSeed, layoutX, layoutY, axisSalt = 0) {
  const seed = (edgeSeed ^ Math.imul(axisSalt, 0x9e3779b9)) | 0;
  const n1 = valueNoise2(seed, layoutX, layoutY, ROCK_EDGE_STEP);
  const n2 = valueNoise2(seed ^ 0x85ebca6b, layoutX, layoutY, ROCK_EDGE_STEP / 3);
  return (
    ROCK_EDGE_AMP * (0.25 + 0.75 * n1) + ROCK_EDGE_AMP2 * (0.25 + 0.75 * n2)
  );
}

function edgeSegCount(size) {
  const per = Math.max(1, ROCK_EDGE_SAMPLES_PER_STEP | 0);
  // Cap: large roots still read as rock without building huge polylines.
  return Math.min(96, Math.max(4, Math.ceil((size / ROCK_EDGE_STEP) * per)));
}

/** axisSalt: 1 = horizontal edge, 2 = vertical edge. */
function axisSaltForEdge(e) {
  return e.iy !== 0 ? 1 : 2;
}

/** Layout-along coordinate at parametric t on edge (0→1 along draw direction). */
function alongAtT(e, t, layoutX, layoutY, size) {
  if (e.iy === 1) return layoutX + t * size; // top L→R
  if (e.ix === -1) return layoutY + t * size; // right T→B
  if (e.iy === -1) return layoutX + (1 - t) * size; // bottom R→L
  return layoutY + (1 - t) * size; // left B→T
}

function tForAlong(e, along, layoutX, layoutY, size) {
  if (size <= 0) return 0;
  if (e.iy === 1) return (along - layoutX) / size;
  if (e.ix === -1) return (along - layoutY) / size;
  if (e.iy === -1) return 1 - (along - layoutX) / size;
  return 1 - (along - layoutY) / size;
}

function inGaps(along, gaps, eps = 0.5) {
  if (!gaps || !gaps.length) return false;
  for (const g of gaps) {
    if (along >= g.a0 - eps && along <= g.a1 + eps) return true;
  }
  return false;
}

function edgeDefs(half) {
  return [
    { key: "top", x0: -half, y0: -half, x1: half, y1: -half, ix: 0, iy: 1 },
    { key: "right", x0: half, y0: -half, x1: half, y1: half, ix: -1, iy: 0 },
    { key: "bottom", x0: half, y0: half, x1: -half, y1: half, ix: 0, iy: -1 },
    { key: "left", x0: -half, y0: half, x1: -half, y1: -half, ix: 1, iy: 0 },
  ];
}

/**
 * Local-space soft outline. Jag only on uncovered face gaps (flush elsewhere).
 */
function buildRockOutline(size, faceGaps, edgeSeed, layoutX, layoutY) {
  const half = size / 2;
  const segs = edgeSegCount(size);
  const pts = [];

  for (const e of edgeDefs(half)) {
    const gaps = faceGaps[e.key] || [];
    const open = gaps.length > 0;
    const n = open ? segs : 1;
    const salt = axisSaltForEdge(e);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let x = e.x0 + (e.x1 - e.x0) * t;
      let y = e.y0 + (e.y1 - e.y0) * t;
      if (open) {
        const along = alongAtT(e, t, layoutX, layoutY, size);
        if (inGaps(along, gaps)) {
          const lx = layoutX + x + half;
          const ly = layoutY + y + half;
          const inset = edgeInset(edgeSeed, lx, ly, salt);
          x += e.ix * inset;
          y += e.iy * inset;
        }
      }
      pts.push(x, y);
    }
  }
  return pts;
}

/** Stroke one uncovered gap; t0/t1 in edge param space. */
function sampleEdgeSpan(e, t0, t1, segs, edgeSeed, layoutX, layoutY, half, size) {
  const out = [];
  const salt = axisSaltForEdge(e);
  const outset = ROCK_EDGE_STROKE_OUTSET;
  const span = Math.max(t1 - t0, 1e-6);
  const n = Math.max(2, Math.ceil(segs * span));
  for (let i = 0; i <= n; i++) {
    const t = t0 + (i / n) * span;
    let x = e.x0 + (e.x1 - e.x0) * t;
    let y = e.y0 + (e.y1 - e.y0) * t;
    const inset = edgeInset(
      edgeSeed,
      layoutX + x + half,
      layoutY + y + half,
      salt,
    );
    const along = inset - outset;
    x += e.ix * along;
    y += e.iy * along;
    out.push(x, y);
  }
  return out;
}

function cacheResolution(size) {
  return Math.min(1, ROCK_CACHE_MAX_PX / Math.max(1, size));
}

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
   * @param {{ tilePosX?: number, tilePosY?: number, layoutX?: number, layoutY?: number, edgeSeed?: number } | null} [visual]
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
    visual = null,
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

    // Layout/UV frozen at spawn (or inherited from parent on break).
    this.layoutX = visual && visual.layoutX != null ? visual.layoutX : x;
    this.layoutY = visual && visual.layoutY != null ? visual.layoutY : y;
    this.tilePosX =
      visual && visual.tilePosX != null ? visual.tilePosX : -this.layoutX;
    this.tilePosY =
      visual && visual.tilePosY != null ? visual.tilePosY : -this.layoutY;
    this.edgeSeed =
      visual && visual.edgeSeed != null ? visual.edgeSeed : ROCK_EDGE_SEED;

    this.fill = null;
    this.edgeMask = null;
    this.edgeStroke = null;
    this._cached = false;

    if (layer && rockTexture) {
      this.gfx = new Container();
      this.gfx.position.set(cx, cy);
      this.gfx.rotation = angle;

      this.fill = new TilingSprite({
        texture: rockTexture,
        width: size,
        height: size,
      });
      this.fill.anchor.set(0.5);
      this.fill.tileScale.set(ROCK_TILE_SCALE, ROCK_TILE_SCALE);
      this.fill.tilePosition.set(this.tilePosX, this.tilePosY);
      this.fill.tint = ROCK_TINT;

      this.edgeMask = new Graphics();
      this.edgeStroke = new Graphics();
      this.edgeStroke.eventMode = "none";
      this.edgeMask.eventMode = "none";

      // Fill+mask in own layer so mask stencil applies without covering stroke.
      // Do NOT set mask.renderable=false — Pixi skips color when used as .mask,
      // but renderable=false also skips stencil → invisible fill (stroke-only bug).
      const fillLayer = new Container();
      fillLayer.addChild(this.fill, this.edgeMask);
      this.fill.mask = this.edgeMask;
      this.gfx.addChild(fillLayer, this.edgeStroke);
      layer.addChild(this.gfx);
    }

    this.createBoxFixture(px2m(size / 2), px2m(size / 2), {
      density: isDynamic ? BOX_DENSITY : 0,
      friction: BOX_FRICTION,
      restitution: BOX_RESTITUTION,
      filterCategoryBits: CAT_INTACT,
      filterMaskBits: INTACT_MASK,
    });
  }

  /** Visual payload for mamushka children / coalesce parent. */
  visualInherit(dx, dy) {
    const childSize = this.size / 2;
    return {
      tilePosX: this.tilePosX - dx * childSize,
      tilePosY: this.tilePosY - dy * childSize,
      layoutX: this.layoutX + dx * childSize,
      layoutY: this.layoutY + dy * childSize,
      edgeSeed: this.edgeSeed,
    };
  }

  /** Parent visual when coalescing 4 siblings (top-left = this). */
  visualAsParent() {
    return {
      tilePosX: this.tilePosX,
      tilePosY: this.tilePosY,
      layoutX: this.layoutX,
      layoutY: this.layoutY,
      edgeSeed: this.edgeSeed,
    };
  }

  /** Flatten fill+mask+stroke → one quad (rebuild only on silhouette change). */
  _bakeVisual() {
    if (!this.gfx) return;
    // Mask must stay renderable during bake or stencil is empty → invisible fill.
    const opts = {
      resolution: cacheResolution(this.size),
      antialias: false,
    };
    if (this._cached && typeof this.gfx.updateCacheTexture === "function") {
      this.gfx.updateCacheTexture();
      return;
    }
    this.gfx.cacheAsTexture(opts);
    this._cached = true;
  }

  /**
   * @param {{ top: {a0:number,a1:number}[], right: {a0:number,a1:number}[], bottom: {a0:number,a1:number}[], left: {a0:number,a1:number}[] }} faceGaps
   */
  applyRockSilhouette(faceGaps) {
    if (!this.fill || !this.edgeMask || !this.edgeStroke) return;
    const gaps = {
      top: faceGaps.top || [],
      right: faceGaps.right || [],
      bottom: faceGaps.bottom || [],
      left: faceGaps.left || [],
    };
    const pts = buildRockOutline(
      this.size,
      gaps,
      this.edgeSeed,
      this.layoutX,
      this.layoutY,
    );
    if (pts.length < 6) return;

    const mask = this.edgeMask;
    mask.clear();
    mask.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) mask.lineTo(pts[i], pts[i + 1]);
    mask.closePath();
    mask.fill(0xffffff);

    const stroke = this.edgeStroke;
    stroke.clear();
    const sw = Math.min(
      this.size * ROCK_EDGE_STROKE_WIDTH_FRAC,
      ROCK_EDGE_STROKE_WIDTH_MAX,
    );
    const half = this.size / 2;
    const segs = edgeSegCount(this.size);
    const strokeOpts = {
      width: Math.max(0.75, sw),
      color: ROCK_EDGE_STROKE,
      alpha: 0.85,
      join: "round",
      cap: "round",
    };

    for (const e of edgeDefs(half)) {
      const face = gaps[e.key];
      if (!face.length) continue;
      for (const g of face) {
        let t0 = tForAlong(e, g.a0, this.layoutX, this.layoutY, this.size);
        let t1 = tForAlong(e, g.a1, this.layoutX, this.layoutY, this.size);
        if (t0 > t1) {
          const tmp = t0;
          t0 = t1;
          t1 = tmp;
        }
        t0 = Math.max(0, Math.min(1, t0));
        t1 = Math.max(0, Math.min(1, t1));
        if (t1 - t0 < 0.02) continue;
        const ep = sampleEdgeSpan(
          e,
          t0,
          t1,
          segs,
          this.edgeSeed,
          this.layoutX,
          this.layoutY,
          half,
          this.size,
        );
        if (ep.length < 4) continue;
        stroke.moveTo(ep[0], ep[1]);
        for (let i = 2; i < ep.length; i += 2) stroke.lineTo(ep[i], ep[i + 1]);
        stroke.stroke(strokeOpts);
      }
    }

    this._bakeVisual();
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

  syncGfx(viewBounds = null, activeBounds = null) {
    if (!this.gfx || !this.body) return;
    this.syncSim(viewBounds, activeBounds);
    this.syncTransform();
  }

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

  forceCullOff() {
    if (this.gfx) this.gfx.visible = false;
    if (this.body && this.body.isActive()) this.body.setActive(false);
  }

  syncTransform() {
    if (!this.isDynamic || !this.gfx || !this.body) return;
    if (!this.body.isAwake()) return;
    const p = this.body.getPosition();
    this.gfx.position.set(m2px(p.x), m2px(p.y));
    this.gfx.rotation = this.body.getAngle();
  }
}

const _boxAabbScratch = { x: 0, y: 0, size: 0 };
