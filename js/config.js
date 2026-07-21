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

/**
 * Root boxes in layout-local px (added to originX / terrainTop).
 * order N → size P_D*2^N, full shatter → (2^N)^2 bolitas.
 */
export const LEVEL_LAYOUT = [
  { order: 7, x: 0, y: 0 },
  { order: 7, x: orderSize(7), y: 100 },
  { order: 7, x: orderSize(7) * 2, y: 200 },
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
export const LASER_RANGE = px2m(400);
export const LASER_FLASH_MS = 100;
export const LASER_COOLDOWN_MS = 50;

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 12;

export const pl = window.planck;
export const Vec2 = pl.Vec2;
