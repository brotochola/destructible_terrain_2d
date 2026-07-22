export const W = window.innerWidth;
export const H = window.innerHeight;
export const ZOOM = 4;
export const PTM = 10;
export const P_D = 5;

export const px2m = (px) => px / PTM;
export const m2px = (m) => m * PTM;

/** Side length in px for an order-N mamushka (leaf side = P_D when N=0 conceptually; shatter at N=1). */
export function orderSize(n) {
  return P_D * 2 ** n;
}

/** Palette base; higher orders get darker via colorForOrder. */
const ORDER_PALETTE = ["#caa26a", "#8a6d43", "#5f5240", "#3d3a33", "#242220"];

export function colorForOrder(n) {
  const i =
    ((n % ORDER_PALETTE.length) + ORDER_PALETTE.length) % ORDER_PALETTE.length;
  return ORDER_PALETTE[i];
}

/** '#rrggbb' → 0xrrggbb for Pixi. */
export function hexToNum(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

/**
 * Root boxes in layout-local px (added to originX / terrainTop).
 * order N → size P_D*2^N, full shatter → (2^N)^2 bolitas.
 */
export const LEVEL_LAYOUT = [
  { order: 7, x: 0, y: 0 },
  { order: 7, x: orderSize(7), y: 100 },
  { order: 7, x: orderSize(7) * 2, y: 200 },
  { order: 7, x: orderSize(7) * 3, y: 300 },
  { order: 7, x: orderSize(7) * 4, y: 400 },
  { order: 7, x: orderSize(7) * 5, y: 500 },
  { order: 7, x: orderSize(7) * 6, y: 600 },
  { order: 7, x: orderSize(7) * 7, y: 700 },
  { order: 7, x: orderSize(7) * 8, y: 800 },
  { order: 7, x: orderSize(7) * 9, y: 900 },
];

function layoutBounds(layout) {
  let w = 0;
  let h = 0;
  for (const item of layout) {
    const s = orderSize(item.order);
    w = Math.max(w, item.x + s);
    h = Math.max(h, item.y + s);
  }
  return { w, h };
}

export const terrainBounds = layoutBounds(LEVEL_LAYOUT);
export const contentW = Math.max(terrainBounds.w, orderSize(1));
export const contentH = Math.max(terrainBounds.h, orderSize(1));
/** Largest side of content — used for default camera zoom. */
export const contentSize = Math.max(contentW, contentH);

export const PHYS_W = contentW * 3;
export const PHYS_H = contentH * 3;
export const originX = (PHYS_W - contentW) / 2;
export const terrainTop = PHYS_H * 0.22;

export const CHAR_SIZE = P_D * 1.4;
export const WALK_SPEED = px2m(120);
export const JUMP_IMPULSE = px2m(48);
export const FAST_FALL_IMPULSE = px2m(8);
export const LASER_RANGE = px2m(800);
export const LASER_FLASH_MS = 100;
export const LASER_COOLDOWN_MS = 1;

/** Balls spawned when an order-1 box shatters. */
export const SHATTER_BALL_COUNT = 3;
/** Shatter ball radius in px (diameter defaults to leaf size P_D). */
export const SHATTER_BALL_RADIUS = P_D / 3;
/** Impulse magnitude range (px-equivalent) applied to each shatter ball. */
export const SHATTER_KICK_MIN = 0;
export const SHATTER_KICK_MAX = 50;

/** Order ≤ this → dynamic body + WeldJoint to neighbors. */
export const DYNAMIC_MAX_ORDER = 1;
export const BOX_DENSITY = 1.0;
export const BOX_FRICTION = 0.9;
export const BOX_RESTITUTION = 0;
export const BOX_LINEAR_DAMPING = 0.1;
export const BOX_ANGULAR_DAMPING = 0.1;
/** AABB touch tolerance (world px) when finding weld neighbors. */
export const BOX_TOUCH_EPS_PX = 1;

/** Collision categories (Planck / Box2D filter). */
export const CAT_WALL = 0x0001;
export const CAT_INTACT = 0x0002;
export const CAT_PARTICLE = 0x0004;
export const CAT_CHARACTER = 0x0008;

export const MAX_FREE_PARTICLES = 800;
export const PARTICLE_MAX_AGE_MS = 12000;
export const PARTICLE_SETTLE_FRAMES = 90;
export const VIEW_CULL_MARGIN_PX = 120;
export const SOLVER_BUSY_DYNAMIC_COUNT = 200;

export const MIN_ZOOM = 0.33;
export const MAX_ZOOM = 12;

export const pl = window.planck;
export const Vec2 = pl.Vec2;
