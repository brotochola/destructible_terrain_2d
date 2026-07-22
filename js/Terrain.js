import {
  BOX_TOUCH_EPS_PX,
  LEVEL_LAYOUT,
  MAX_FREE_PARTICLES,
  PARTICLE_MAX_AGE_MS,
  PARTICLE_SETTLE_FRAMES,
  SHATTER_BALL_COUNT,
  SHATTER_KICK_MAX,
  SHATTER_KICK_MIN,
  Vec2,
  m2px,
  originX,
  pl,
  px2m,
  terrainTop,
} from './config.js';
import { Box } from './Box.js';
import { CirclePiece, ParticlePool } from './CirclePiece.js';

function nodeKey(box) {
  return box.rootId + '_' + box.order + '_' + box.gx + '_' + box.gy;
}

function keyAt(rootId, order, gx, gy) {
  return rootId + '_' + order + '_' + gx + '_' + gy;
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
    })
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
   * @param {{ boxes: import('pixi.js').Container, particles: import('pixi.js').Container }} layers
   */
  constructor(world, layers = null) {
    this.world = world;
    this.boxLayer = layers && layers.boxes;
    this.particleLayer = layers && layers.particles;
    this.particleTexture = layers && layers.particleTexture;
    this.intact = new Map();
    this.dynamicIntact = new Set();
    this.freeParticles = [];
    this.particlePool = new ParticlePool(
      world,
      this.particleLayer,
      this.particleTexture
    );
    this._nextRootId = 0;
    this._coalesceCursor = 0;
  }

  dynamicCount() {
    return this.dynamicIntact.size + this.freeParticles.length;
  }

  weldToNeighbors(box) {
    for (const [dx, dy] of NEIGHBOR_DIRS) {
      const other = this.intact.get(keyAt(box.rootId, box.order, box.gx + dx, box.gy + dy));
      if (!other || !other.isDynamic || other === box) continue;
      weldBoxes(this.world, box, other);
    }
    // Cross-order / odd edges: only scan other dynamics (small set).
    for (const other of this.dynamicIntact) {
      if (other === box) continue;
      if (other.rootId === box.rootId && other.order === box.order) continue;
      if (!boxesTouch(box, other, BOX_TOUCH_EPS_PX)) continue;
      weldBoxes(this.world, box, other);
    }
  }

  createNode(order, x, y, gx, gy, rootId, angle = 0, velocity = null) {
    const box = new Box(
      this.world,
      order,
      x,
      y,
      gx,
      gy,
      rootId,
      this.boxLayer,
      angle
    );
    if (velocity && box.isDynamic && box.body) {
      box.body.setLinearVelocity(Vec2(velocity.vx, velocity.vy));
      box.body.setAngularVelocity(velocity.omega);
    }
    this.intact.set(nodeKey(box), box);
    if (box.isDynamic) {
      this.dynamicIntact.add(box);
      this.weldToNeighbors(box);
    }
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
    while (this.freeParticles.length > MAX_FREE_PARTICLES) {
      const oldest = this.freeParticles.shift();
      this.particlePool.release(oldest);
    }
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
    node.destroy();
    this.intact.delete(nodeKey(node));

    if (node.order === 1) {
      this.shatterToParticles(node, pose);
      return;
    }

    const childOrder = node.order - 1;
    const velocity = {
      vx: pose.vx,
      vy: pose.vy,
      omega: pose.omega,
    };
    // One subdivision level per laser hit (no recurse to leaf).
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const place = childPlacement(pose, node.size, dx, dy);
        this.createNode(
          childOrder,
          place.x,
          place.y,
          node.gx * 2 + dx,
          node.gy * 2 + dy,
          node.rootId,
          pose.angle,
          velocity
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
    if (a.body.getAngle() || b.body.getAngle() || c.body.getAngle() || d.body.getAngle()) {
      return false;
    }

    const parentOrder = order + 1;
    const parentGx = gx >> 1;
    const parentGy = gy >> 1;
    const parentX = a.x;
    const parentY = a.y;

    for (const sib of [a, b, c, d]) {
      this.dynamicIntact.delete(sib);
      this.intact.delete(nodeKey(sib));
      sib.destroy();
    }

    this.createNode(parentOrder, parentX, parentY, parentGx, parentGy, rootId, 0);
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
      if (
        !box.isDynamic &&
        (box.gx & 1) === 0 &&
        (box.gy & 1) === 0
      ) {
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

      const aged = now - piece.bornAt >= PARTICLE_MAX_AGE_MS;
      const settled = piece.settleFrames >= PARTICLE_SETTLE_FRAMES;
      if (!aged && !settled) continue;
      this.freeParticles.splice(i, 1);
      this.particlePool.release(piece);
    }
  }

  clear() {
    for (const node of this.intact.values()) node.destroy();
    this.intact.clear();
    this.dynamicIntact.clear();
    for (const piece of this.freeParticles) piece.destroy();
    this.freeParticles.length = 0;
    this.particlePool.destroyAll();
    this._nextRootId = 0;
  }

  reset() {
    this.clear();
    this.initFromLayout();
  }

  syncGfx(viewBounds = null) {
    for (const node of this.dynamicIntact) {
      node.syncGfx();
    }
    for (const piece of this.freeParticles) {
      piece.syncGfx(viewBounds);
    }
    if (this.particleLayer && typeof this.particleLayer.update === 'function') {
      this.particleLayer.update();
    }
  }
}
