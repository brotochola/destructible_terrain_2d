import {
  BOX_TOUCH_EPS_PX,
  CULL_CELL_PX,
  CULL_DIRTY_PX,
  LEVEL_LAYOUT,
  MAX_MAMUSHKA_ORDER,
  particleTunables,
  SHATTER_BALL_COUNT,
  SHATTER_KICK_MAX,
  SHATTER_KICK_MIN,
  Vec2,
  m2px,
  originX,
  pl,
  px2m,
  terrainTop,
} from "./config.js";
import { Box } from "./Box.js";
import { CirclePiece, ParticlePool } from "./CirclePiece.js";
import { SpatialHash } from "./SpatialHash.js";
import { pickMush, resolveMushHint } from "./rockMush.js";

function nodeKey(box) {
  return box.rootId + "_" + box.order + "_" + box.gx + "_" + box.gy;
}

function keyAt(rootId, order, gx, gy) {
  return rootId + "_" + order + "_" + gx + "_" + gy;
}

/** Intact box covering cell (order, gx, gy), or null. Walks parents if subdivided away. */
function findCovering(intact, rootId, order, gx, gy) {
  let o = order;
  let x = gx;
  let y = gy;
  while (o <= MAX_MAMUSHKA_ORDER) {
    const box = intact.get(keyAt(rootId, o, x, y));
    if (box) return box;
    x >>= 1;
    y >>= 1;
    o++;
  }
  return null;
}

/**
 * Two child cells of (gx, gy) on the face toward the opposite of (dx, dy).
 * Search east (dx=1) → neighbor's west children, etc.
 */
function edgeChildCoords(gx, gy, dx, dy) {
  const bx = gx * 2;
  const by = gy * 2;
  if (dx === 1)
    return [
      [bx, by],
      [bx, by + 1],
    ];
  if (dx === -1)
    return [
      [bx + 1, by],
      [bx + 1, by + 1],
    ];
  if (dy === 1)
    return [
      [bx, by],
      [bx + 1, by],
    ];
  return [
    [bx, by + 1],
    [bx + 1, by + 1],
  ];
}

/** Intact leaves inside cell (o,gx,gy) that lie on the shared face for search dir (dx,dy). */
function gatherEdgeLeaves(intact, rootId, o, gx, gy, dx, dy) {
  const box = intact.get(keyAt(rootId, o, gx, gy));
  if (box) return [box];
  if (o <= 1) return [];
  const out = [];
  for (const [cx, cy] of edgeChildCoords(gx, gy, dx, dy)) {
    out.push(...gatherEdgeLeaves(intact, rootId, o - 1, cx, cy, dx, dy));
  }
  return out;
}

/**
 * Same-root face neighbors of cell (order, gx, gy) in cardinal (dx, dy).
 * Exact → coarser cover → finer edge leaves.
 */
function faceNeighbors(intact, rootId, order, gx, gy, dx, dy) {
  const ngx = gx + dx;
  const ngy = gy + dy;
  if (ngx < 0 || ngy < 0) return [];

  const cover = findCovering(intact, rootId, order, ngx, ngy);
  if (cover) return [cover];

  if (order <= 1) return [];
  const out = [];
  for (const [cx, cy] of edgeChildCoords(ngx, ngy, dx, dy)) {
    out.push(...gatherEdgeLeaves(intact, rootId, order - 1, cx, cy, dx, dy));
  }
  return out;
}

/** Axis-aligned bounds from current body center (ignores rotation). */
function aabbOf(box) {
  if (box.body) {
    const p = box.body.getPosition();
    const hs = box.size / 2;
    return { x: m2px(p.x) - hs, y: m2px(p.y) - hs, size: box.size };
  }
  return { x: box.x, y: box.y, size: box.size };
}

function boxesTouch(a, b, eps) {
  const A = aabbOf(a);
  const B = aabbOf(b);
  return !(
    A.x + A.size < B.x - eps ||
    B.x + B.size < A.x - eps ||
    A.y + A.size < B.y - eps ||
    B.y + B.size < A.y - eps
  );
}

function weldBoxes(world, a, b) {
  const A = aabbOf(a);
  const B = aabbOf(b);
  const x0 = Math.max(A.x, B.x);
  const y0 = Math.max(A.y, B.y);
  const x1 = Math.min(A.x + A.size, B.x + B.size);
  const y1 = Math.min(A.y + A.size, B.y + B.size);
  const worldPt = Vec2(px2m((x0 + x1) / 2), px2m((y0 + y1) / 2));
  world.createJoint(
    pl.WeldJoint({
      bodyA: a.body,
      bodyB: b.body,
      localAnchorA: a.body.getLocalPoint(worldPt),
      localAnchorB: b.body.getLocalPoint(worldPt),
      referenceAngle: b.body.getAngle() - a.body.getAngle(),
      frequencyHz: 0, // hard angular constraint
      dampingRatio: 0,
    }),
  );
}

/** Snapshot parent body pose before destroy. */
function readPose(node) {
  const p = node.body.getPosition();
  const v = node.body.getLinearVelocity();
  return {
    cx: m2px(p.x),
    cy: m2px(p.y),
    angle: node.body.getAngle(),
    vx: v.x,
    vy: v.y,
    omega: node.body.getAngularVelocity(),
  };
}

/** Child top-left + center from parent pose and quadrant (dx, dy in 0..1). */
function childPlacement(pose, parentSize, dx, dy) {
  const childSize = parentSize / 2;
  const lx = (dx - 0.5) * childSize;
  const ly = (dy - 0.5) * childSize;
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const wcx = pose.cx + lx * cos - ly * sin;
  const wcy = pose.cy + lx * sin + ly * cos;
  return {
    x: wcx - childSize / 2,
    y: wcy - childSize / 2,
    size: childSize,
  };
}

const NEIGHBOR_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export class Terrain {
  /**
   * @param {*} world Planck world
   * @param {{ boxes: import('pixi.js').Container, particles: import('pixi.js').Container, particleBuckets?: import('pixi.js').ParticleContainer[], particleTextures?: import('pixi.js').Texture[], rockTexturesByOrder?: import('pixi.js').Texture[][], rockMushRecipes?: { variant: number, rot: number }[][][] }} layers
   */
  constructor(world, layers = null) {
    this.world = world;
    this.boxLayer = layers && layers.boxes;
    this.particleLayer = layers && layers.particles;
    this.particleBuckets = (layers && layers.particleBuckets) || null;
    this.particleTextures = layers && layers.particleTextures;
    this.rockTexturesByOrder = layers && layers.rockTexturesByOrder;
    this.rockMushRecipes = layers && layers.rockMushRecipes;
    this.intact = new Map();
    this.dynamicIntact = new Set();
    this.freeParticles = [];
    this.particlePool = new ParticlePool(
      world,
      this.particleBuckets,
      this.particleTextures,
    );
    this._nextRootId = 0;
    this._coalesceCursor = 0;
    this.cullHash = new SpatialHash(CULL_CELL_PX);
    /** @type {Set<import('./Box.js').Box>} */
    this._cullOn = new Set();
    this._cullQueryScratch = new Set();
    this._cullCamX = NaN;
    this._cullCamY = NaN;
    this._cullCamVs = NaN;
  }

  dynamicCount() {
    return this.dynamicIntact.size + this.freeParticles.length;
  }

  weldToNeighbors(box) {
    for (const [dx, dy] of NEIGHBOR_DIRS) {
      for (const other of faceNeighbors(
        this.intact,
        box.rootId,
        box.order,
        box.gx,
        box.gy,
        dx,
        dy,
      )) {
        if (other === box) continue;
        if (!box.isDynamic && !other.isDynamic) continue;
        weldBoxes(this.world, box, other);
      }
    }
    // Cross-root layout seams (gx/gy not shared across rootId).
    for (const other of this.intact.values()) {
      if (other === box || other.rootId === box.rootId) continue;
      if (!box.isDynamic && !other.isDynamic) continue;
      if (!boxesTouch(box, other, BOX_TOUCH_EPS_PX)) continue;
      weldBoxes(this.world, box, other);
    }
  }

  /**
   * @param {number} order
   * @param {number} x
   * @param {number} y
   * @param {number} gx
   * @param {number} gy
   * @param {number|string} rootId
   * @param {number} [angle]
   * @param {{ vx: number, vy: number, omega: number } | null} [velocity]
   * @param {{ variant: number, rot: number } | null} [mushHint] from parent recipe on break
   */
  createNode(
    order,
    x,
    y,
    gx,
    gy,
    rootId,
    angle = 0,
    velocity = null,
    mushHint = null,
  ) {
    const mush = mushHint
      ? resolveMushHint(this.rockTexturesByOrder, order, mushHint)
      : pickMush(this.rockTexturesByOrder, order, rootId, gx, gy);
    if (this.boxLayer && (!mush || !mush.texture)) {
      throw new Error(
        `rock mush texture missing for order ${order} (bake / pick failed)`,
      );
    }
    const box = new Box(
      this.world,
      order,
      x,
      y,
      gx,
      gy,
      rootId,
      this.boxLayer,
      angle,
      mush ? mush.texture : null,
      mush ? mush.variant : 0,
      mush ? mush.texRot : 0,
    );
    if (velocity && box.isDynamic && box.body) {
      box.body.setLinearVelocity(Vec2(velocity.vx, velocity.vy));
      box.body.setAngularVelocity(velocity.omega);
    }
    this.intact.set(nodeKey(box), box);
    if (box.isDynamic) this.dynamicIntact.add(box);
    this.cullHash.insert(box);
    this.weldToNeighbors(box);
    return box;
  }

  addRoot({ order, x, y }) {
    const rootId = this._nextRootId++;
    return this.createNode(order, originX + x, terrainTop + y, 0, 0, rootId);
  }

  initFromLayout() {
    for (const item of LEVEL_LAYOUT) {
      this.addRoot(item);
    }
  }

  enforceParticleCap() {
    while (this.freeParticles.length > particleTunables.maxFree) {
      const oldest = this.freeParticles.shift();
      this.particlePool.release(oldest);
    }
  }

  /** Apply particle↔particle collide bit to live + pooled pieces. */
  setParticleCollide(on) {
    for (const piece of this.freeParticles) piece.setCollideParticles(on);
    for (const piece of this.particlePool.free) piece.setCollideParticles(on);
  }

  shatterToParticles(node, pose) {
    const n = Math.max(1, SHATTER_BALL_COUNT | 0);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = node.size / cols;
    const cellH = node.size / rows;
    const cos = Math.cos(pose.angle);
    const sin = Math.sin(pose.angle);
    const half = node.size / 2;

    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      const lx = -half + (col + 0.5) * cellW;
      const ly = -half + (row + 0.5) * cellH;
      const cx = pose.cx + lx * cos - ly * sin;
      const cy = pose.cy + lx * sin + ly * cos;
      const piece = this.particlePool.acquire(cx, cy);
      this.freeParticles.push(piece);
      piece.kick(SHATTER_KICK_MIN, SHATTER_KICK_MAX);
    }
    this.enforceParticleCap();
  }

  breakNode(node, ix, iy) {
    if (!this.intact.has(nodeKey(node))) return;

    const pose = readPose(node);

    this.dynamicIntact.delete(node);
    this.cullHash.remove(node);
    this._cullOn.delete(node);
    const parentSize = node.size;
    const parentGx = node.gx;
    const parentGy = node.gy;
    const parentOrder = node.order;
    const parentMushVariant = node.mushVariant;
    const rootId = node.rootId;
    const shatter = parentOrder === 1;
    node.destroy();
    this.intact.delete(nodeKey(node));

    if (shatter) {
      this.shatterToParticles({ size: parentSize }, pose);
      return;
    }

    const childOrder = parentOrder - 1;
    const velocity = {
      vx: pose.vx,
      vy: pose.vy,
      omega: pose.omega,
    };
    const parentRecipes =
      this.rockMushRecipes && this.rockMushRecipes[parentOrder];
    const parentRecipe =
      parentRecipes && parentRecipes[parentMushVariant];
    // One subdivision level per laser hit (no recurse to leaf).
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const place = childPlacement(pose, parentSize, dx, dy);
        const mushHint =
          parentRecipe && parentRecipe[dy * 2 + dx]
            ? parentRecipe[dy * 2 + dx]
            : null;
        this.createNode(
          childOrder,
          place.x,
          place.y,
          parentGx * 2 + dx,
          parentGy * 2 + dy,
          rootId,
          pose.angle,
          velocity,
          mushHint,
        );
      }
    }
  }

  /**
   * If 4 static siblings form a full parent quad and sit off-camera, merge into
   * one parent node (same filled area, fewer fixtures).
   */
  tryCoalesceSiblingGroup(a) {
    if (!a || a.isDynamic || a.gx % 2 !== 0 || a.gy % 2 !== 0) return false;
    const { rootId, order, gx, gy } = a;
    const b = this.intact.get(keyAt(rootId, order, gx + 1, gy));
    const c = this.intact.get(keyAt(rootId, order, gx, gy + 1));
    const d = this.intact.get(keyAt(rootId, order, gx + 1, gy + 1));
    if (!b || !c || !d) return false;
    if (b.isDynamic || c.isDynamic || d.isDynamic) return false;
    // Static mamushka cells stay axis-aligned; skip if any drifted somehow.
    if (
      a.body.getAngle() ||
      b.body.getAngle() ||
      c.body.getAngle() ||
      d.body.getAngle()
    ) {
      return false;
    }

    const parentOrder = order + 1;
    const parentGx = gx >> 1;
    const parentGy = gy >> 1;
    const parentX = a.x;
    const parentY = a.y;

    for (const sib of [a, b, c, d]) {
      this.dynamicIntact.delete(sib);
      this.cullHash.remove(sib);
      this._cullOn.delete(sib);
      this.intact.delete(nodeKey(sib));
      sib.destroy();
    }

    this.createNode(
      parentOrder,
      parentX,
      parentY,
      parentGx,
      parentGy,
      rootId,
      0,
      null,
    );
    return true;
  }

  /** Scan a few intact nodes per call; only coalesce quads fully outside view. */
  coalesceQuiet(viewBounds, budget = 4) {
    if (!viewBounds || this.intact.size < 4) return;

    const candidates = [];
    let idx = 0;
    const start = this._coalesceCursor;
    const maxScan = 32;

    for (const box of this.intact.values()) {
      if (idx++ < start) continue;
      if (!box.isDynamic && (box.gx & 1) === 0 && (box.gy & 1) === 0) {
        const parentSize = box.size * 2;
        const x0 = box.x;
        const y0 = box.y;
        const overlapsView = !(
          x0 + parentSize < viewBounds.x0 ||
          x0 > viewBounds.x1 ||
          y0 + parentSize < viewBounds.y0 ||
          y0 > viewBounds.y1
        );
        if (!overlapsView) candidates.push(box);
      }
      if (candidates.length >= budget || idx - start >= maxScan) break;
    }

    this._coalesceCursor = idx >= this.intact.size ? 0 : idx;

    for (const box of candidates) {
      if (this.intact.has(nodeKey(box))) this.tryCoalesceSiblingGroup(box);
    }
  }

  deleteParticle(pieceOrBody) {
    const piece =
      pieceOrBody instanceof CirclePiece
        ? pieceOrBody
        : this.freeParticles.find((p) => p.body === pieceOrBody);
    if (!piece) return;
    const idx = this.freeParticles.indexOf(piece);
    if (idx < 0) return;
    this.freeParticles.splice(idx, 1);
    this.particlePool.release(piece);
  }

  /** Despawn aged / settled particles; release into pool. */
  cullParticles(now) {
    for (let i = this.freeParticles.length - 1; i >= 0; i--) {
      const piece = this.freeParticles[i];
      if (piece.body && !piece.body.isAwake()) piece.settleFrames++;
      else piece.settleFrames = 0;

      const aged =
        particleTunables.maxAgeMs > 0 &&
        now - piece.bornAt >= particleTunables.maxAgeMs;
      const settled =
        particleTunables.settleFrames > 0 &&
        piece.settleFrames >= particleTunables.settleFrames;
      if (!aged && !settled) continue;
      this.freeParticles.splice(i, 1);
      this.particlePool.release(piece);
    }
  }

  clear() {
    for (const node of this.intact.values()) node.destroy();
    this.intact.clear();
    this.dynamicIntact.clear();
    this.cullHash.clear();
    this._cullOn.clear();
    this._cullCamX = NaN;
    this._cullCamY = NaN;
    this._cullCamVs = NaN;
    for (const piece of this.freeParticles) piece.destroy();
    this.freeParticles.length = 0;
    this.particlePool.destroyAll();
    this._nextRootId = 0;
  }

  reset() {
    this.clear();
    this.initFromLayout();
  }

  _cullDirty(viewBounds, activeBounds) {
    if (!viewBounds) return true;
    const cx = (viewBounds.x0 + viewBounds.x1) * 0.5;
    const cy = (viewBounds.y0 + viewBounds.y1) * 0.5;
    const span = viewBounds.x1 - viewBounds.x0;
    if (
      !(Math.abs(cx - this._cullCamX) < CULL_DIRTY_PX) ||
      !(Math.abs(cy - this._cullCamY) < CULL_DIRTY_PX) ||
      !(Math.abs(span - this._cullCamVs) < 1)
    ) {
      this._cullCamX = cx;
      this._cullCamY = cy;
      this._cullCamVs = span;
      return true;
    }
    return false;
  }

  syncGfx(viewBounds = null, activeBounds = null) {
    // Always sync awake dynamics (pose + hash cell).
    for (const node of this.dynamicIntact) {
      if (!node.body || !node.body.isAwake()) continue;
      node.syncTransform();
      this.cullHash.update(node);
    }

    const dirty = this._cullDirty(viewBounds, activeBounds);
    if (dirty) {
      const next = this._cullQueryScratch;
      next.clear();
      if (activeBounds) {
        this.cullHash.queryInto(activeBounds, next);
      } else {
        for (const node of this.intact.values()) next.add(node);
      }
      for (const node of next) {
        node.syncSim(viewBounds, activeBounds);
      }
      for (const node of this._cullOn) {
        if (!next.has(node)) node.forceCullOff();
      }
      // Swap sets without allocating.
      const prev = this._cullOn;
      this._cullOn = next;
      this._cullQueryScratch = prev;
      prev.clear();
    } else {
      // Camera steady — only re-cull moving dynamics near edges.
      for (const node of this.dynamicIntact) {
        node.syncSim(viewBounds, activeBounds);
        if (
          (node.gfx && node.gfx.visible) ||
          (node.body && node.body.isActive())
        ) {
          this._cullOn.add(node);
        } else {
          this._cullOn.delete(node);
        }
      }
    }

    for (const piece of this.freeParticles) {
      piece.syncGfx(viewBounds);
    }
    const buckets = this.particleBuckets;
    if (buckets) {
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        if (typeof b.update === "function") b.update();
      }
    } else if (
      this.particleLayer &&
      typeof this.particleLayer.update === "function"
    ) {
      this.particleLayer.update();
    }
  }
}
