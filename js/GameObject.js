import { m2px, pl } from './config.js';

export class GameObject {
  constructor(world, bodyDef, kind) {
    this.world = world;
    this.kind = kind;
    this.body = world.createBody(bodyDef);
    this.body.setUserData({ kind, gameObject: this });
  }

  createBoxFixture(halfW, halfH, fixtureDef = {}) {
    this.body.createFixture(pl.Box(halfW, halfH), fixtureDef);
  }

  createCircleFixture(radius, fixtureDef = {}) {
    this.body.createFixture(pl.Circle(radius), fixtureDef);
  }

  getPositionPx() {
    const p = this.body.getPosition();
    return { x: m2px(p.x), y: m2px(p.y) };
  }

  destroy() {
    if (!this.body) return;
    this.world.destroyBody(this.body);
    this.body = null;
  }

  draw(_ctx, _view) {
    // subclasses implement
  }
}
