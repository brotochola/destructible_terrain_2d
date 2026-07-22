import { findHollowSpawn, generateLevel } from "./procgen.js";

export const W = window.innerWidth;
export const H = window.innerHeight;
export const ZOOM = 4;
export const PTM = 10;
/** Leaf scale; order-1 collider = P_D*2 = 40 (matches box.png). */
export const P_D = 20;

export const px2m = (px) => px / PTM;
export const m2px = (m) => m * PTM;

/** Side length in px for an order-N mamushka (leaf side = P_D when N=0 conceptually; shatter at N=1). */
export function orderSize(n) {
  return P_D * 2 ** n;
}

/** Shatter bolita sprites (scaled down to SHATTER_BALL diameter). */
export const ROCK_PARTICLE_URLS = ["assets/rock1.png", "assets/rock2.png"];
/** Hierarchical terrain base (51×53, centered on order-1 40×40). */
export const ROCK_BOX_URL = "assets/box.png";
export const ROCK_BOX_W = 51;
export const ROCK_BOX_H = 53;
/** Cap bake canvas px (large orders Sprite-scale up). */
export const ROCK_MUSH_MAX_TEX = 1024;
/** Floor bake canvas px so small orders keep pebble detail when zoomed. */
export const ROCK_MUSH_MIN_TEX = 64;
/** Distinct mushes per order ≥2; pick via rootId+gx+gy hash. */
export const ROCK_MUSH_VARIANTS = 8;
export const ROCK_MUSH_SEED = 42;
/** Order-1 rot variants (0/90/180/270). */
export const ROCK_BOX_ROT_VARIANTS = 4;

/**
 * World-px past each collider edge — sprite = box + 2*this.
 * Fixed from box.png vs order-1 so neighbor mushes cover seams at every order.
 */
export const ROCK_BOX_OVERFLOW =
  (Math.max(ROCK_BOX_W, ROCK_BOX_H) - orderSize(1)) / 2;

/** Visual overflow (world px) for a collider of `boxSize`. */
export function rockMushOverflow(_boxSize) {
  return ROCK_BOX_OVERFLOW;
}

/** Visual sprite side for a collider of `boxSize` (world px). */
export function rockMushVisualSize(boxSize) {
  return boxSize + 2 * rockMushOverflow(boxSize);
}

/** Procedural map size (layout px). */
export const MAP_W = 3000;
export const MAP_H = 1000;
export const MAP_SEED = 919191;
/** Noise frequency in order-1 cell units (lower = bigger caves). */
export const NOISE_SCALE = 0.06;
export const NOISE_OCTAVES = 2;
export const NOISE_LACUNARITY = 2;
export const NOISE_GAIN = 0.5;
/** Solid when fbm + yBias*depth > threshold. */
export const SOLID_THRESHOLD = 0.15;
/** Extra solid toward bottom (0 = free islands, ~0.4 = slab+caves). */
export const NOISE_Y_BIAS = 0.5;
/** Cap packed root order (order 9 → P_D*2^9 px side). */
export const MAX_PACK_ORDER = 9;

const _gen = generateLevel({
  mapW: MAP_W,
  mapH: MAP_H,
  cellSizePx: orderSize(1),
  seed: MAP_SEED,
  scale: NOISE_SCALE,
  octaves: NOISE_OCTAVES,
  lacunarity: NOISE_LACUNARITY,
  gain: NOISE_GAIN,
  threshold: SOLID_THRESHOLD,
  yBias: NOISE_Y_BIAS,
  maxPackOrder: MAX_PACK_ORDER,
});

/**
 * Root boxes in layout-local px (added to originX / terrainTop).
 * Packed from Perlin occupancy — order N → size P_D*2^N.
 */
export const LEVEL_LAYOUT = _gen.layout;
export const MAP_OCCUPANCY = _gen.solid;
export const MAP_COLS = _gen.cols;
export const MAP_ROWS = _gen.rows;

export const contentW = MAP_W;
export const contentH = MAP_H;
/** Largest side of content — used for default camera zoom. */
export const contentSize = Math.max(contentW, contentH);
/** Ceiling for findCovering / coalesce parent walks. */
export const MAX_MAMUSHKA_ORDER =
  LEVEL_LAYOUT.length > 0
    ? Math.max(...LEVEL_LAYOUT.map((i) => i.order))
    : MAX_PACK_ORDER;

/** Layout-local spawn in a hollow cell near top-center. */
export const SPAWN_LAYOUT = findHollowSpawn(
  MAP_OCCUPANCY,
  MAP_COLS,
  MAP_ROWS,
  orderSize(1),
) ?? { x: contentW / 2, y: orderSize(1) };

export const PHYS_W = contentW * 3;
export const PHYS_H = contentH * 3;
export const originX = (PHYS_W - contentW) / 2;
export const terrainTop = PHYS_H * 0.22;

export const CHAR_SIZE = P_D * 1.4;
export const WALK_SPEED = px2m(120);
/** Up speed on jump (m/s). Velocity-based so mass changes with CHAR_SIZE don't kill jump. */
export const JUMP_SPEED = px2m(220);
export const FAST_FALL_IMPULSE = px2m(8);
export const LASER_RANGE = px2m(800);
export const LASER_FLASH_MS = 100;
export const LASER_COOLDOWN_MS = 1;

/** Balls spawned when an order-1 box shatters. */
export const SHATTER_BALL_COUNT = 9;
/** Shatter ball radius in px (diameter defaults to leaf size P_D). */
export const SHATTER_BALL_RADIUS = P_D / 4;
/** Impulse magnitude range (px-equivalent) applied to each shatter ball. */
export const SHATTER_KICK_MIN = 0;
export const SHATTER_KICK_MAX = 50;

/** Order ≤ this → dynamic body + WeldJoint to neighbors. */
export const DYNAMIC_MAX_ORDER = 2;
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

/** Runtime-tunable particle limits / sleep cull (UI mutates fields). */
export const particleTunables = {
  maxFree: 800,
  /** 0 = no max-age cull. */
  maxAgeMs: 12000,
  /** Frames asleep before settle-cull. 0 = no settle cull. */
  settleFrames: 90,
  /** When true, free particles collide with each other. */
  collide: false,
};
export const VIEW_CULL_MARGIN_PX = 120;
/** Body active if AABB overlaps view expanded by this (≥ LASER_RANGE px). */
export const PHYS_ACTIVE_MARGIN_PX = 900;
/** Re-run intact view/active cull when camera moves more than this (px) or zoom changes. */
export const CULL_DIRTY_PX = 48;
/** Spatial hash cell size for intact cull queries. */
export const CULL_CELL_PX = 256;
export const SOLVER_BUSY_DYNAMIC_COUNT = 200;

export const MIN_ZOOM = 0.033;
export const MAX_ZOOM = 12;

export const pl = window.planck;
export const Vec2 = pl.Vec2;
