import {
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

export class Character extends GameObject {
  constructor(world, x, y) {
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
    });
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

  draw(ctx, view) {
    const { x: cx, y: cy } = this.getPositionPx();
    ctx.fillStyle = '#6ec8ff';
    ctx.fillRect(cx - CHAR_SIZE / 2, cy - CHAR_SIZE / 2, CHAR_SIZE, CHAR_SIZE);
    ctx.strokeStyle = '#dff6ff';
    ctx.lineWidth = 1.5 / view.scale;
    ctx.strokeRect(cx - CHAR_SIZE / 2, cy - CHAR_SIZE / 2, CHAR_SIZE, CHAR_SIZE);

    const ang = this.aimAngle(view.mouseSX, view.mouseSY, view.camera, view.scale);
    const len = CHAR_SIZE * 1.6;
    ctx.strokeStyle = '#ff8a5c';
    ctx.lineWidth = 2 / view.scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.stroke();
  }
}
