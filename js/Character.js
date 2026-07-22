import {
  CAT_CHARACTER,
  CAT_INTACT,
  CAT_PARTICLE,
  CAT_WALL,
  CHAR_SIZE,
  FAST_FALL_IMPULSE,
  JUMP_IMPULSE,
  W,
  WALK_SPEED,
  H,
  Vec2,
  m2px,
  px2m,
} from './config.js';
import { GameObject } from './GameObject.js';
import { Graphics } from './Renderer.js';

const CHARACTER_MASK = CAT_WALL | CAT_INTACT | CAT_PARTICLE | CAT_CHARACTER;

export class Character extends GameObject {
  constructor(world, x, y, layer = null) {
    super(
      world,
      {
        type: 'dynamic',
        position: Vec2(px2m(x), px2m(y)),
        fixedRotation: true,
        allowSleep: false,
      },
      'character'
    );
    this.groundContacts = 0;
    this.grounded = false;
    this.createBoxFixture(px2m(CHAR_SIZE / 2), px2m(CHAR_SIZE / 2), {
      density: 1.5,
      friction: 0.4,
      restitution: 0,
      filterCategoryBits: CAT_CHARACTER,
      filterMaskBits: CHARACTER_MASK,
    });

    if (layer) {
      this.gfx = new Graphics();
      layer.addChild(this.gfx);
    }
  }

  addGroundContact() {
    this.groundContacts++;
  }

  removeGroundContact() {
    this.groundContacts = Math.max(0, this.groundContacts - 1);
  }

  update(keys) {
    this.grounded = this.groundContacts > 0;
    const v = this.body.getLinearVelocity();
    let vx = 0;
    if (keys.KeyA) vx -= WALK_SPEED;
    if (keys.KeyD) vx += WALK_SPEED;
    this.body.setLinearVelocity(Vec2(vx, v.y));

    if (keys.KeyW && this.grounded) {
      this.body.applyLinearImpulse(Vec2(0, -JUMP_IMPULSE), this.body.getPosition(), true);
      this.grounded = false;
    }
    // Assumption: S = fast-fall (down impulse), no crouch hitbox
    if (keys.KeyS) {
      this.body.applyLinearImpulse(Vec2(0, FAST_FALL_IMPULSE), this.body.getPosition(), true);
    }
  }

  aimAngle(mouseSX, mouseSY, camera, viewScale) {
    const p = this.body.getPosition();
    const cx = m2px(p.x);
    const cy = m2px(p.y);
    const sx = W / 2 + (cx - camera.cx) * viewScale;
    const sy = H / 2 + (cy - camera.cy) * viewScale;
    return Math.atan2(mouseSY - sy, mouseSX - sx);
  }

  syncGfx(view) {
    if (!this.gfx || !this.body) return;
    const { x: cx, y: cy } = this.getPositionPx();
    const half = CHAR_SIZE / 2;
    const ang = this.aimAngle(view.mouseSX, view.mouseSY, view.camera, view.scale);
    const len = CHAR_SIZE * 1.6;
    const lw = 1.5 / view.scale;

    this.gfx.clear();
    this.gfx.rect(cx - half, cy - half, CHAR_SIZE, CHAR_SIZE).fill(0x6ec8ff);
    this.gfx.rect(cx - half, cy - half, CHAR_SIZE, CHAR_SIZE).stroke({
      width: lw,
      color: 0xdff6ff,
    });
    this.gfx.moveTo(cx, cy);
    this.gfx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    this.gfx.stroke({ width: 2 / view.scale, color: 0xff8a5c });
  }
}
