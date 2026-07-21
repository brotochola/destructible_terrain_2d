export const W = window.innerWidth;
export const H = window.innerHeight;
export const ZOOM = 4;
export const PTM = 10;
export const P_D = 5;
export const LEVEL_SIZE = [P_D, P_D * 2, P_D * 4, P_D * 8, P_D * 16]; // 5,10,20,40,80
export const TOP_LEVEL = LEVEL_SIZE.length - 1;
export const LEVEL_COLOR = ['#caa26a', '#8a6d43', '#5f5240', '#3d3a33', '#242220'];

export const px2m = (px) => px / PTM;
export const m2px = (m) => m * PTM;

export const BIG_N = 4;
export const bigSize = BIG_N * LEVEL_SIZE[TOP_LEVEL];

export const PHYS_W = bigSize * 3;
export const PHYS_H = bigSize * 3;
export const originX = (PHYS_W - bigSize) / 2;
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
