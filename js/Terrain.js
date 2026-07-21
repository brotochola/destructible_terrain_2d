import {
  BOX_TOUCH_EPS_PX,
  LEVEL_LAYOUT,
  SHATTER_BALL_COUNT,
  SHATTER_KICK_MAX,
  SHATTER_KICK_MIN,
  Vec2,
  m2px,
  orderSize,
  originX,
  pl,
  px2m,
  terrainTop,
} from './config.js';
import { Box } from './Box.js';
import { CirclePiece } from './CirclePiece.js';

function nodeKey(box) {
  return box.rootId + '_' + box.order + '_' + box.gx + '_' + box.gy;
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

export class Terrain {
  /**
   * @param {*} world Planck world
   * @param {{ boxes: import('pixi.js').Container, particles: import('pixi.js').Container }} layers
   */
  constructor(world, layers = null) {
    this.world = world;
    this.boxLayer = layers && layers.boxes;
    this.particleLayer = layers && layers.particles;
    this.intact = new Map();
    this.freeParticles = [];
    this._nextRootId = 0;
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
      for (const other of this.intact.values()) {
        if (other === box) continue;
        if (!boxesTouch(box, other, BOX_TOUCH_EPS_PX)) continue;
        weldBoxes(this.world, box, other);
      }
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
      const piece = new CirclePiece(this.world, cx, cy, this.particleLayer);
      this.freeParticles.push(piece);
      piece.kick(SHATTER_KICK_MIN, SHATTER_KICK_MAX);
    }
  }

  breakNode(node, ix, iy) {
    if (!this.intact.has(nodeKey(node))) return;

    const pose = readPose(node);
    let impactDx = 0;
    let impactDy = 0;
    if (ix !== undefined && iy !== undefined) {
      const local = node.body.getLocalPoint(Vec2(px2m(ix), px2m(iy)));
      impactDx = local.x >= 0 ? 1 : 0;
      impactDy = local.y >= 0 ? 1 : 0;
    }

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
    let impactChild = null;
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const place = childPlacement(pose, node.size, dx, dy);
        const child = this.createNode(
          childOrder,
          place.x,
          place.y,
          node.gx * 2 + dx,
          node.gy * 2 + dy,
          node.rootId,
          pose.angle,
          velocity
        );
        if (dx === impactDx && dy === impactDy) impactChild = child;
      }
    }
    if (impactChild && ix !== undefined) this.breakNode(impactChild, ix, iy);
  }

  deleteParticle(pieceOrBody) {
    const piece =
      pieceOrBody instanceof CirclePiece
        ? pieceOrBody
        : this.freeParticles.find((p) => p.body === pieceOrBody);
    if (!piece) return;
    const idx = this.freeParticles.indexOf(piece);
    if (idx < 0) return;
    piece.destroy();
    this.freeParticles.splice(idx, 1);
  }

  clear() {
    for (const node of this.intact.values()) node.destroy();
    this.intact.clear();
    for (const piece of this.freeParticles) piece.destroy();
    this.freeParticles.length = 0;
    this._nextRootId = 0;
  }

  reset() {
    this.clear();
    this.initFromLayout();
  }

  syncGfx() {
    for (const node of this.intact.values()) {
      if (node.isDynamic) node.syncGfx();
    }
    for (const piece of this.freeParticles) {
      piece.syncGfx();
    }
  }
}
