import {
  BOMB_MIN_DIST_PX,
  BOX_TOUCH_EPS_PX,
  CULL_CELL_PX,
  CULL_DIRTY_PX,
  LEVEL_LAYOUT,
  MAT_DIRT,
  MATERIALS,
  MAX_MAMUSHKA_ORDER,
  particleTunables,
  SHATTER_BALL_COUNT,
  SHATTER_KICK_MAX,
  SHATTER_KICK_MIN,
  Vec2,
  WELD_FORCE_PER_STRENGTH,
  WELD_TORQUE_PER_STRENGTH,
  m2px,
  originX,
  pl,
  px2m,
  terrainTop,
} from "./config.js";
import { Box } from "./Box.js";
import { CirclePiece, ParticlePool } from "./CirclePiece.js";
import { SpatialHash } from "./SpatialHash.js";

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
  if (o <= 0) return [];
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

  if (order <= 0) return [];
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

/** True if Planck bodies share any joint. */
function bodiesWelded(bodyA, bodyB) {
  if (!bodyA || !bodyB) return false;
  for (let edge = bodyA.getJointList(); edge; edge = edge.next) {
    if (edge.other === bodyB) return true;
  }
  return false;
}

/**
 * Seal face only while bond holds.
 * Static–static: grid adjacency (no welds). Any dynamic: need live joint.
 */
function shouldSealNeighbor(a, b) {
  if (!a.isDynamic && !b.isDynamic) return true;
  return bodiesWelded(a.body, b.body);
}

/** True if AABB overlaps circle (closest point on box to center within radius). */
function aabbOverlapsCircle(box, cx, cy, rSq) {
  const a = aabbOf(box);
  const qx = Math.max(a.x, Math.min(cx, a.x + a.size));
  const qy = Math.max(a.y, Math.min(cy, a.y + a.size));
  const dx = qx - cx;
  const dy = qy - cy;
  return dx * dx + dy * dy <= rSq;
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

/**
 * True if B sits flush on A's cardinal face (dx,dy) with tangential overlap.
 * Stricter than "somewhere on that side" — corner grazers don't fake-seal.
 */
function sharesCardinalFace(A, B, dx, dy, eps) {
  if (dx === 1) {
    if (Math.abs(B.x - (A.x + A.size)) > eps) return false;
    return !(B.y + B.size < A.y + eps || A.y + A.size < B.y + eps);
  }
  if (dx === -1) {
    if (Math.abs(B.x + B.size - A.x) > eps) return false;
    return !(B.y + B.size < A.y + eps || A.y + A.size < B.y + eps);
  }
  if (dy === 1) {
    if (Math.abs(B.y - (A.y + A.size)) > eps) return false;
    return !(B.x + B.size < A.x + eps || A.x + A.size < B.x + eps);
  }
  if (dy === -1) {
    if (Math.abs(B.y + B.size - A.y) > eps) return false;
    return !(B.x + B.size < A.x + eps || A.x + A.size < B.x + eps);
  }
  return false;
}

/** Interval along shared face (layout px). Horizontal faces → X; vertical → Y. */
function edgeAlongInterval(box, dx, dy) {
  if (dx !== 0) {
    return { a0: box.layoutY, a1: box.layoutY + box.size };
  }
  return { a0: box.layoutX, a1: box.layoutX + box.size };
}

function mergeIntervals(intervals, eps) {
  if (!intervals.length) return [];
  const sorted = intervals.slice().sort((u, v) => u.a0 - v.a0);
  const out = [{ a0: sorted[0].a0, a1: sorted[0].a1 }];
  for (let i = 1; i < sorted.length; i++) {
    const iv = sorted[i];
    const last = out[out.length - 1];
    if (iv.a0 <= last.a1 + eps) last.a1 = Math.max(last.a1, iv.a1);
    else out.push({ a0: iv.a0, a1: iv.a1 });
  }
  return out;
}

/** Gaps on [a0,a1] not covered by `covered` intervals. */
function uncoveredGaps(a0, a1, covered, eps) {
  const merged = mergeIntervals(covered, eps);
  const gaps = [];
  let cur = a0;
  for (const iv of merged) {
    const lo = Math.max(iv.a0, a0);
    const hi = Math.min(iv.a1, a1);
    if (hi <= lo + eps) continue;
    if (lo > cur + eps) gaps.push({ a0: cur, a1: Math.min(lo, a1) });
    cur = Math.max(cur, hi);
  }
  if (cur < a1 - eps) gaps.push({ a0: cur, a1: a1 });
  return gaps;
}

function weldBoxes(world, a, b) {
  const A = aabbOf(a);
  const B = aabbOf(b);
  const x0 = Math.max(A.x, B.x);
  const y0 = Math.max(A.y, B.y);
  const x1 = Math.min(A.x + A.size, B.x + B.size);
  const y1 = Math.min(A.y + A.size, B.y + B.size);
  const contactLenM = px2m(Math.max(x1 - x0, y1 - y0, 0));
  const mat = MATERIALS[a.materialId] || MATERIALS[MAT_DIRT];
  const strength = mat.strength != null ? mat.strength : 1;
  const maxForce = strength * contactLenM * WELD_FORCE_PER_STRENGTH;
  const maxTorque = strength * contactLenM * WELD_TORQUE_PER_STRENGTH;
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
      userData: { breakable: true, maxForce, maxTorque },
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
   * @param {{ boxes: import('pixi.js').Container, particles: import('pixi.js').Container, particleBuckets?: import('pixi.js').ParticleContainer[], particleTextures?: import('pixi.js').Texture[], rockTextures?: Record<string, import('pixi.js').Texture> }} layers
   */
  constructor(world, layers = null) {
    this.world = world;
    this.boxLayer = layers && layers.boxes;
    this.particleLayer = layers && layers.particles;
    this.particleBuckets = (layers && layers.particleBuckets) || null;
    this.particleTextures = layers && layers.particleTextures;
    this.rockTextures = (layers && layers.rockTextures) || {};
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
    this._touchScratch = new Set();
    this._cullCamX = NaN;
    this._cullCamY = NaN;
    this._cullCamVs = NaN;
    /** @type {any[]} */
    this._brokenWelds = [];
  }

  dynamicCount() {
    return this.dynamicIntact.size + this.freeParticles.length;
  }

  /**
   * Snap welds whose reaction force/torque exceeds material strength.
   * Call after world.step (never mid-step).
   * @param {number} dt
   */
  cullBrokenWelds(dt) {
    if (!(dt > 0)) return;
    const invDt = 1 / dt;
    const broken = this._brokenWelds;
    broken.length = 0;
    for (let joint = this.world.getJointList(); joint; joint = joint.getNext()) {
      const data = joint.getUserData();
      if (!data || !data.breakable) continue;
      const force = joint.getReactionForce(invDt);
      const torque = joint.getReactionTorque(invDt);
      const maxF = data.maxForce;
      const maxT = data.maxTorque;
      const f2 = force.x * force.x + force.y * force.y;
      if (f2 > maxF * maxF || Math.abs(torque) > maxT) {
        broken.push(joint);
      }
    }
    if (!broken.length) return;

    const refresh = new Set();
    for (let i = 0; i < broken.length; i++) {
      const joint = broken[i];
      for (const body of [joint.getBodyA(), joint.getBodyB()]) {
        const ud = body && body.getUserData();
        const box = ud && ud.gameObject;
        if (box && box.applyRockSilhouette) refresh.add(box);
      }
      this.world.destroyJoint(joint);
    }
    for (const box of refresh) {
      if (this.intact.has(nodeKey(box))) this.refreshRockEdges(box);
    }
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
        if (other.materialId !== box.materialId) continue;
        if (!box.isDynamic && !other.isDynamic) continue;
        weldBoxes(this.world, box, other);
      }
    }
    this.forCrossRootTouching(box, (other) => {
      if (other.materialId !== box.materialId) return;
      if (!box.isDynamic && !other.isDynamic) return;
      weldBoxes(this.world, box, other);
    });
  }

  /** Nearby intact from other roots (spatial hash; not full scan). */
  forCrossRootTouching(box, fn) {
    const A = aabbOf(box);
    const eps = BOX_TOUCH_EPS_PX;
    const near = this.cullHash.queryInto(
      {
        x0: A.x - eps,
        y0: A.y - eps,
        x1: A.x + A.size + eps,
        y1: A.y + A.size + eps,
      },
      this._touchScratch,
    );
    for (const other of near) {
      if (other === box || other.rootId === box.rootId) continue;
      if (!boxesTouch(box, other, eps)) continue;
      fn(other);
    }
  }

  /**
   * Uncovered intervals on a face → stroke/chew there.
   * Empty = neighbor covers this side (seal, no stroke).
   * Rule: covering intact neighbor? seal (or subtract their span). Else draw.
   * Different material → uncovered (jag like void).
   * Dynamic pairs only seal while a weld still exists.
   */
  getFaceGaps(box, dx, dy) {
    const target = edgeAlongInterval(box, dx, dy);
    const eps = BOX_TOUCH_EPS_PX;
    const covered = [];

    for (const n of faceNeighbors(
      this.intact,
      box.rootId,
      box.order,
      box.gx,
      box.gy,
      dx,
      dy,
    )) {
      if (n.materialId !== box.materialId) continue;
      if (!shouldSealNeighbor(box, n)) continue;
      // Equal or larger neighbor occupies the whole adjacent cell → full seal.
      if (n.order >= box.order) return [];
      covered.push(edgeAlongInterval(n, dx, dy));
    }

    const A = aabbOf(box);
    const cross = [];
    this.forCrossRootTouching(box, (other) => cross.push(other));
    for (const other of cross) {
      if (other.materialId !== box.materialId) continue;
      if (!sharesCardinalFace(A, aabbOf(other), dx, dy, eps)) continue;
      if (!shouldSealNeighbor(box, other)) continue;
      if (other.order >= box.order) return [];
      covered.push(edgeAlongInterval(other, dx, dy));
    }

    return uncoveredGaps(target.a0, target.a1, covered, eps);
  }

  refreshRockEdges(box) {
    if (!box || !box.applyRockSilhouette) return;
    box.applyRockSilhouette({
      right: this.getFaceGaps(box, 1, 0),
      left: this.getFaceGaps(box, -1, 0),
      bottom: this.getFaceGaps(box, 0, 1),
      top: this.getFaceGaps(box, 0, -1),
    });
  }

  refreshNeighborRockEdges(box) {
    for (const [dx, dy] of NEIGHBOR_DIRS) {
      for (const n of faceNeighbors(
        this.intact,
        box.rootId,
        box.order,
        box.gx,
        box.gy,
        dx,
        dy,
      )) {
        this.refreshRockEdges(n);
      }
    }
    const cross = [];
    this.forCrossRootTouching(box, (other) => cross.push(other));
    for (const other of cross) this.refreshRockEdges(other);
  }

  /** Neighbors that share a face — refresh after this node is removed. */
  collectTouching(box) {
    const out = [];
    const seen = new Set();
    for (const [dx, dy] of NEIGHBOR_DIRS) {
      for (const n of faceNeighbors(
        this.intact,
        box.rootId,
        box.order,
        box.gx,
        box.gy,
        dx,
        dy,
      )) {
        if (n === box || seen.has(n)) continue;
        seen.add(n);
        out.push(n);
      }
    }
    this.forCrossRootTouching(box, (other) => {
      if (seen.has(other)) return;
      seen.add(other);
      out.push(other);
    });
    return out;
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
   * @param {{ tilePosX?: number, tilePosY?: number, layoutX?: number, layoutY?: number, edgeSeed?: number } | null} [visual]
   * @param {{ deferEdges?: boolean, materialId?: string }} [opts] skip silhouette until caller refreshes (multi-spawn)
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
    visual = null,
    opts = null,
  ) {
    const materialId =
      (opts && opts.materialId) ||
      MAT_DIRT;
    if (this.boxLayer && !this.rockTextures[materialId]) {
      throw new Error("rock texture missing for material " + materialId);
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
      this.rockTextures,
      visual,
      materialId,
    );
    if (velocity && box.isDynamic && box.body) {
      box.body.setLinearVelocity(Vec2(velocity.vx, velocity.vy));
      box.body.setAngularVelocity(velocity.omega);
    }
    this.intact.set(nodeKey(box), box);
    if (box.isDynamic) this.dynamicIntact.add(box);
    this.cullHash.insert(box);
    this.weldToNeighbors(box);
    if (!(opts && opts.deferEdges)) {
      this.refreshRockEdges(box);
      this.refreshNeighborRockEdges(box);
    }
    return box;
  }

  addRoot({ order, x, y, material }) {
    const rootId = this._nextRootId++;
    const materialId =
      material && MATERIALS[material] ? material : MAT_DIRT;
    return this.createNode(
      order,
      originX + x,
      terrainTop + y,
      0,
      0,
      rootId,
      0,
      null,
      null,
      { materialId },
    );
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

  /**
   * Apply laser (or other) damage. Splits/shatters when hp ≤ 0.
   * @returns {boolean} true if node broke
   */
  hitNode(node, ix, iy, damage = 1) {
    if (!node || !this.intact.has(nodeKey(node))) return false;
    const dmg = Math.max(0, damage);
    if (dmg <= 0) return false;
    node.hp = (node.hp != null ? node.hp : node.maxHp || 1) - dmg;
    if (node.hp > 0) return false;
    this.breakNode(node, ix, iy);
    return true;
  }

  breakNode(node, ix, iy) {
    if (!this.intact.has(nodeKey(node))) return [];

    const pose = readPose(node);
    const around = this.collectTouching(node);

    this.dynamicIntact.delete(node);
    this.cullHash.remove(node);
    this._cullOn.delete(node);
    const parentSize = node.size;
    const parentGx = node.gx;
    const parentGy = node.gy;
    const parentOrder = node.order;
    const rootId = node.rootId;
    const parentMaterialId = node.materialId || MAT_DIRT;
    const parentVisual = {
      tilePosX: node.tilePosX,
      tilePosY: node.tilePosY,
      layoutX: node.layoutX,
      layoutY: node.layoutY,
      edgeSeed: node.edgeSeed,
    };
    const shatter = parentOrder === 0;
    node.destroy();
    this.intact.delete(nodeKey(node));

    if (shatter) {
      this.shatterToParticles({ size: parentSize }, pose);
      for (const n of around) {
        if (this.intact.has(nodeKey(n))) this.refreshRockEdges(n);
      }
      return [];
    }

    const childOrder = parentOrder - 1;
    const childSize = parentSize / 2;
    const velocity = {
      vx: pose.vx,
      vy: pose.vy,
      omega: pose.omega,
    };
    const kids = [];
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const place = childPlacement(pose, parentSize, dx, dy);
        const visual = {
          tilePosX: parentVisual.tilePosX - dx * childSize,
          tilePosY: parentVisual.tilePosY - dy * childSize,
          layoutX: parentVisual.layoutX + dx * childSize,
          layoutY: parentVisual.layoutY + dy * childSize,
          edgeSeed: parentVisual.edgeSeed,
        };
        kids.push(
          this.createNode(
            childOrder,
            place.x,
            place.y,
            parentGx * 2 + dx,
            parentGy * 2 + dy,
            rootId,
            pose.angle,
            velocity,
            visual,
            { deferEdges: true, materialId: parentMaterialId },
          ),
        );
      }
    }
    // All siblings exist + welded — bake silhouettes once (no stale full-perimeter cache).
    for (const kid of kids) this.refreshRockEdges(kid);
    for (const n of around) {
      if (this.intact.has(nodeKey(n))) this.refreshRockEdges(n);
    }
    return kids;
  }

  /**
   * Circular blast carve: subdivide overlapping non-leaves, damage leaves with
   * power / distSq until crater forms.
   */
  blastCarve(cx, cy, radiusPx, power) {
    const rSq = radiusPx * radiusPx;
    const minSq = BOMB_MIN_DIST_PX * BOMB_MIN_DIST_PX;
    const queue = [];
    const found = this.cullHash.query({
      x0: cx - radiusPx,
      y0: cy - radiusPx,
      x1: cx + radiusPx,
      y1: cy + radiusPx,
    });
    for (const node of found) queue.push(node);

    while (queue.length) {
      const node = queue.pop();
      if (!node || !this.intact.has(nodeKey(node))) continue;
      if (!aabbOverlapsCircle(node, cx, cy, rSq)) continue;

      if (node.order > 0) {
        const kids = this.breakNode(node, cx, cy);
        for (let i = 0; i < kids.length; i++) queue.push(kids[i]);
        continue;
      }

      const p = node.getPositionPx();
      const dx = p.x - cx;
      const dy = p.y - cy;
      const rawSq = dx * dx + dy * dy;
      const distSq = rawSq < minSq ? minSq : rawSq;
      this.hitNode(node, cx, cy, power / distSq);
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
    const visual = a.visualAsParent();
    const materialId = a.materialId || MAT_DIRT;

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
      visual,
      { materialId },
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
      const prev = this._cullOn;
      this._cullOn = next;
      this._cullQueryScratch = prev;
      prev.clear();
    } else {
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
