import { LEVEL_COLOR, LEVEL_SIZE, Vec2, px2m } from './config.js';
import { GameObject } from './GameObject.js';

export class Box extends GameObject {
  constructor(world, level, gx, gy, originX, terrainTop) {
    const size = LEVEL_SIZE[level];
    const x = originX + gx * size;
    const y = terrainTop + gy * size;
    super(
      world,
      {
        type: 'static',
        position: Vec2(px2m(x + size / 2), px2m(y + size / 2)),
      },
      'intact'
    );
    this.level = level;
    this.gx = gx;
    this.gy = gy;
    this.x = x;
    this.y = y;
    this.size = size;
    this.createBoxFixture(px2m(size / 2), px2m(size / 2), { friction: 0.9 });
  }

  draw(ctx, view) {
    ctx.fillStyle = LEVEL_COLOR[this.level];
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(this.x, this.y, this.size, this.size);
  }
}
