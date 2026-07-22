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
  ROCK_EDGE_AMP,
  ROCK_EDGE_SAMPLES_PER_STEP,
  ROCK_EDGE_STEP,
  ROCK_EDGE_STROKE,
  ROCK_EDGE_STROKE_WIDTH_FRAC,
  ROCK_EDGE_STROKE_WIDTH_MAX,
  ROCK_TILE_SCALE,
  ROCK_TINT,
  m2px,
  orderSize,
  Vec2,
  px2m,
} from './config.js';
import { GameObject } from './GameObject.js';
import { Container, Graphics, TilingSprite } from './Renderer.js';

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

/** Stable for whole mamushka tree — not order/gx/gy. */
function seedFromRootId(rootId) {
  const s = String(rootId);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function soft01(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Soft inset from layout-space position.
 * Bilinear + smoothstep between hash cells — correlated along edge, stable on split.
 */
function edgeInset(edgeSeed, layoutX, layoutY) {
  const gx = layoutX / ROCK_EDGE_STEP;
  const gy = layoutY / ROCK_EDGE_STEP;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = soft01(gx - x0);
  const fy = soft01(gy - y0);
  const v00 = hash01(edgeSeed, x0, y0);
  const v10 = hash01(edgeSeed, x0 + 1, y0);
  const v01 = hash01(edgeSeed, x0, y0 + 1);
  const v11 = hash01(edgeSeed, x0 + 1, y0 + 1);
  const v0 = v00 + (v10 - v00) * fx;
  const v1 = v01 + (v11 - v01) * fx;
  const v = v0 + (v1 - v0) * fy;
  return ROCK_EDGE_AMP * (0.25 + 0.75 * v);
}

function edgeSegCount(size) {
  const per = Math.max(1, ROCK_EDGE_SAMPLES_PER_STEP | 0);
  return Math.max(4, Math.ceil((size / ROCK_EDGE_STEP) * per));
}

/**
 * Local-space soft outline. Shared faces flush; exposed faces use
 * layout-space noise so parent outer edges match child outer edges.
 */
function buildRockOutline(size, exposed, edgeSeed, layoutX, layoutY) {
  const half = size / 2;
  const segs = edgeSegCount(size);

  const edges = [
    { open: exposed.top, x0: -half, y0: -half, x1: half, y1: -half, ix: 0, iy: 1 },
    { open: exposed.right, x0: half, y0: -half, x1: half, y1: half, ix: -1, iy: 0 },
    { open: exposed.bottom, x0: half, y0: half, x1: -half, y1: half, ix: 0, iy: -1 },
    { open: exposed.left, x0: -half, y0: half, x1: -half, y1: -half, ix: 1, iy: 0 },
  ];

  const pts = [];
  for (const e of edges) {
    const n = e.open ? segs : 1;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let x = e.x0 + (e.x1 - e.x0) * t;
      let y = e.y0 + (e.y1 - e.y0) * t;
      if (e.open) {
        const lx = layoutX + x + half;
        const ly = layoutY + y + half;
        const inset = edgeInset(edgeSeed, lx, ly);
        x += e.ix * inset;
        y += e.iy * inset;
      }
      pts.push(x, y);
    }
  }
  return pts;
}

function sampleExposedEdge(e, segs, edgeSeed, layoutX, layoutY, half) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let x = e.x0 + (e.x1 - e.x0) * t;
    let y = e.y0 + (e.y1 - e.y0) * t;
    const inset = edgeInset(edgeSeed, layoutX + x + half, layoutY + y + half);
    x += e.ix * inset;
    y += e.iy * inset;
    out.push(x, y);
  }
  return out;
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
    visual = null
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

    // Layout/UV frozen at spawn (or inherited from parent on break).
    this.layoutX = visual && visual.layoutX != null ? visual.layoutX : x;
    this.layoutY = visual && visual.layoutY != null ? visual.layoutY : y;
    this.tilePosX =
      visual && visual.tilePosX != null ? visual.tilePosX : -this.layoutX;
    this.tilePosY =
      visual && visual.tilePosY != null ? visual.tilePosY : -this.layoutY;
    this.edgeSeed =
      visual && visual.edgeSeed != null
        ? visual.edgeSeed
        : seedFromRootId(rootId);

    this.fill = null;
    this.edgeMask = null;
    this.edgeStroke = null;

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
      this.edgeStroke.eventMode = 'none';

      this.gfx.addChild(this.fill, this.edgeMask, this.edgeStroke);
      this.fill.mask = this.edgeMask;
      layer.addChild(this.gfx);

      this.applyRockSilhouette({ top: true, right: true, bottom: true, left: true });
    }
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

  /**
   * @param {{ top: boolean, right: boolean, bottom: boolean, left: boolean }} exposed
   */
  applyRockSilhouette(exposed) {
    if (!this.fill || !this.edgeMask || !this.edgeStroke) return;
    const pts = buildRockOutline(
      this.size,
      exposed,
      this.edgeSeed,
      this.layoutX,
      this.layoutY
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
      ROCK_EDGE_STROKE_WIDTH_MAX
    );
    const half = this.size / 2;
    const segs = edgeSegCount(this.size);
    const edges = [
      { open: exposed.top, x0: -half, y0: -half, x1: half, y1: -half, ix: 0, iy: 1 },
      { open: exposed.right, x0: half, y0: -half, x1: half, y1: half, ix: -1, iy: 0 },
      { open: exposed.bottom, x0: half, y0: half, x1: -half, y1: half, ix: 0, iy: -1 },
      { open: exposed.left, x0: -half, y0: half, x1: -half, y1: -half, ix: 1, iy: 0 },
    ];
    const strokeOpts = {
      width: Math.max(0.75, sw),
      color: ROCK_EDGE_STROKE,
      alpha: 0.85,
      join: 'round',
      cap: 'round',
    };
    for (const e of edges) {
      if (!e.open) continue;
      const ep = sampleExposedEdge(
        e,
        segs,
        this.edgeSeed,
        this.layoutX,
        this.layoutY,
        half
      );
      stroke.moveTo(ep[0], ep[1]);
      for (let i = 2; i < ep.length; i += 2) stroke.lineTo(ep[i], ep[i + 1]);
      stroke.stroke(strokeOpts);
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
