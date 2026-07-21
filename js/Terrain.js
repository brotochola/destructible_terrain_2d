import { BIG_N, LEVEL_SIZE, TOP_LEVEL, Vec2, originX, terrainTop } from './config.js';
import { Box } from './Box.js';
import { CirclePiece } from './CirclePiece.js';

function nodeKey(level, gx, gy) {
  return level + '_' + gx + '_' + gy;
}

export class Terrain {
  constructor(world) {
    this.world = world;
    this.intact = new Map();
    this.freeParticles = [];
  }

  createIntactNode(level, gx, gy) {
    const box = new Box(this.world, level, gx, gy, originX, terrainTop);
    this.intact.set(nodeKey(level, gx, gy), box);
    return box;
  }

  initGrid() {
    for (let gx = 0; gx < BIG_N; gx++) {
      for (let gy = 0; gy < BIG_N; gy++) {
        this.createIntactNode(TOP_LEVEL, gx, gy);
      }
    }
  }

  shatterToParticles(node) {
    const s = LEVEL_SIZE[0];
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
    if (!this.intact.has(nodeKey(node.level, node.gx, node.gy))) return;
    node.destroy();
    this.intact.delete(nodeKey(node.level, node.gx, node.gy));

    if (node.level === 1) {
      this.shatterToParticles(node);
      return;
    }

    const childLevel = node.level - 1;
    let impactChild = null;
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        const child = this.createIntactNode(childLevel, node.gx * 2 + dx, node.gy * 2 + dy);
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
  }

  reset() {
    this.clear();
    this.initGrid();
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
