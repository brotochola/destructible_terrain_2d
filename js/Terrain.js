import {
  LEVEL_LAYOUT,
  SHATTER_BALL_COUNT,
  SHATTER_KICK_MAX,
  SHATTER_KICK_MIN,
  orderSize,
  originX,
  terrainTop,
} from './config.js';
import { Box } from './Box.js';
import { CirclePiece } from './CirclePiece.js';

function nodeKey(box) {
  return box.rootId + '_' + box.order + '_' + box.gx + '_' + box.gy;
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

  createNode(order, x, y, gx, gy, rootId) {
    const box = new Box(this.world, order, x, y, gx, gy, rootId, this.boxLayer);
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
    const n = Math.max(1, SHATTER_BALL_COUNT | 0);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cellW = node.size / cols;
    const cellH = node.size / rows;

    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      const cx = node.x + (col + 0.5) * cellW;
      const cy = node.y + (row + 0.5) * cellH;
      const piece = new CirclePiece(this.world, cx, cy, this.particleLayer);
      this.freeParticles.push(piece);
      piece.kick(SHATTER_KICK_MIN, SHATTER_KICK_MAX);
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

  syncGfx() {
    for (const piece of this.freeParticles) {
      piece.syncGfx();
    }
  }
}
