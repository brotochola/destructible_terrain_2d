import { colorForOrder, orderSize, Vec2, px2m } from './config.js';
import { GameObject } from './GameObject.js';

export class Box extends GameObject {
  /**
   * @param {number} order mamushka depth
   * @param {number} x world px top-left
   * @param {number} y world px top-left
   * @param {number} gx grid index within root
   * @param {number} gy grid index within root
   * @param {number|string} rootId unique per root mamushka
   */
  constructor(world, order, x, y, gx, gy, rootId) {
    const size = orderSize(order);
    super(
      world,
      {
        type: 'static',
        position: Vec2(px2m(x + size / 2), px2m(y + size / 2)),
      },
      'intact'
    );
    this.order = order;
    this.gx = gx;
    this.gy = gy;
    this.rootId = rootId;
    this.x = x;
    this.y = y;
    this.size = size;
    this.createBoxFixture(px2m(size / 2), px2m(size / 2), { friction: 0.9 });
  }

  draw(ctx, view) {
    ctx.fillStyle = colorForOrder(this.order);
    ctx.fillRect(this.x, this.y, this.size, this.size);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(this.x, this.y, this.size, this.size);
  }
}
