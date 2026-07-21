import { P_D, Vec2, m2px, px2m } from './config.js';
import { GameObject } from './GameObject.js';

export class CirclePiece extends GameObject {
  constructor(world, cx, cy) {
    super(
      world,
      {
        type: 'dynamic',
        position: Vec2(px2m(cx), px2m(cy)),
        linearDamping: 0.4,
        angularDamping: 0.6,
      },
      'particle'
    );
    this.createCircleFixture(px2m(P_D / 2), {
      density: 1.2,
      friction: 0.6,
      restitution: 0.05,
    });
  }

  kick(minPx, maxPx) {
    const ang = Math.random() * Math.PI * 2;
    const mag = minPx + Math.random() * (maxPx - minPx);
    this.body.applyLinearImpulse(
      Vec2(Math.cos(ang), Math.sin(ang)).mul(px2m(mag)),
      this.body.getPosition(),
      true
    );
  }

  draw(ctx, _view) {
    const p = this.body.getPosition();
    ctx.beginPath();
    ctx.arc(m2px(p.x), m2px(p.y), P_D / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
