import { LEVEL_LAYOUT, P_D, Vec2, orderSize, originX, terrainTop } from './config.js';
import { Box } from './Box.js';
import { CirclePiece } from './CirclePiece.js';

function nodeKey(box) {
  return box.rootId + '_' + box.order + '_' + box.gx + '_' + box.gy;
}

export class Terrain {
  constructor(world) {
    this.world = world;
    this.intact = new Map();
    this.freeParticles = [];
    this._nextRootId = 0;
  }

  createNode(order, x, y, gx, gy, rootId) {
    const box = new Box(this.world, order, x, y, gx, gy, rootId);
    this.intact.set(nodeKey(box), box);
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

  shatterToParticles(node) {
    const s = P_D;
    const centers = [
      Vec2(node.x + s * 0.5, node.y + s * 0.5),
      Vec2(node.x + s * 1.5, node.y + s * 0.5),
      Vec2(node.x + s * 0.5, node.y + s * 1.5),
      Vec2(node.x + s * 1.5, node.y + s * 1.5),
    ];
    for (const c of centers) {
      const piece = new CirclePiece(this.world, c.x, c.y);
      this.freeParticles.push(piece);
      piece.kick(25, 70);
    }
  }

  breakNode(node, ix, iy) {
    if (!this.intact.has(nodeKey(node))) return;
    node.destroy();
    this.intact.delete(nodeKey(node));

    if (node.order === 1) {
      this.shatterToParticles(node);
      return;
    }

    const childOrder = node.order - 1;
    const childSize = orderSize(childOrder);
    let impactChild = null;
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const child = this.createNode(
          childOrder,
          node.x + dx * childSize,
          node.y + dy * childSize,
          node.gx * 2 + dx,
          node.gy * 2 + dy,
          node.rootId
        );
        if (
          ix !== undefined &&
          ix >= child.x &&
          ix < child.x + child.size &&
          iy >= child.y &&
          iy < child.y + child.size
        ) {
          impactChild = child;
        }
      }
    }
    if (impactChild) this.breakNode(impactChild, ix, iy);
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

  draw(ctx, view) {
    for (const node of this.intact.values()) {
      node.draw(ctx, view);
    }
    ctx.fillStyle = '#e0b26a';
    for (const piece of this.freeParticles) {
      piece.draw(ctx, view);
    }
  }
}
