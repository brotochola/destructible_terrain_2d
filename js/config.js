import { findHollowSpawn, generateLevel } from "./procgen.js";

export const W = window.innerWidth;
export const H = window.innerHeight;
export const ZOOM = 4;
export const PTM = 10;
/** Leaf scale; order-1 collider = P_D*2 = 40. */
export const P_D = 20;
export const SHATTER_BALL_RADIUS = P_D / 4;
export const px2m = (px) => px / PTM;
export const m2px = (m) => m * PTM;

/** Side length in px for an order-N mamushka (leaf side = P_D when N=0 conceptually; shatter at N=1). */
export function orderSize(n) {
  return P_D * 2 ** n;
}

/** Shatter bolita sprites (scaled down to SHATTER_BALL diameter). */
export const ROCK_PARTICLE_URLS = ["assets/rock1.png", "assets/rock2.png"];
/** Shatter ball radius in px. */

/**
 * On-screen rock sprite max side (CirclePiece + order-1 mush stamps).
 * Collider diam * 1.3 overhang.
 */
export const ROCK_PARTICLE_VISUAL = SHATTER_BALL_RADIUS * 2 * 1.3;
/**
 * Order-1 world visual side (px) — sprite size in game, independent of bake res.
 * Overflow / ratio stay tied to this so doubling bake tex does not enlarge sprites.
 */
export const ROCK_MUSH_WORLD_VISUAL = 64;
/** Order-1 bake tex side (px). Higher orders = this * 2^(n-1). */
export const ROCK_MUSH_MIN_TEX = 128;
/** Highest order with its own baked atlas (128→2048). */
export const ROCK_MUSH_BAKE_MAX_ORDER = 4;
export const ROCK_MUSH_SEED = 1212;
/** Stamp density for order-1 cluster bake. */
export const ROCK_MUSH_DENSITY = 1;

/** Texture side for baked order n (1..BAKE_MAX): 128, 256, … 2048. */
export function orderTexSize(n) {
  return ROCK_MUSH_MIN_TEX * 2 ** (n - 1);
}

/** Visual / collider scale for order-1 (world neighbors + baked into order-2 atlas). */
export const ROCK_MUSH_VISUAL_RATIO = 1.2; //ROCK_MUSH_WORLD_VISUAL / orderSize(1);

/** Visual overflow (world px) for a collider of `boxSize`. */
export function rockMushOverflow(boxSize, order = 1) {
  return (rockMushVisualSize(boxSize, order) - boxSize) / 2;
}

/** Visual sprite side. Order-1 uses ratio; order≥2 = collider (ratio baked into atlas). */
export function rockMushVisualSize(boxSize, order = 1) {
  if (order <= 1) return boxSize * ROCK_MUSH_VISUAL_RATIO;
  return boxSize;
}

/** Procedural map size (layout px). */
export const MAP_W = 4000;
export const MAP_H = 1200;
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
export const LASER_COOLDOWN_MS = 111;

/** Balls spawned when an order-1 box shatters. */
export const SHATTER_BALL_COUNT = 9;
/** Impulse magnitude range (px-equivalent) applied to each shatter ball. */
export const SHATTER_KICK_MIN = 20;
export const SHATTER_KICK_MAX = 80;

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
  collide: true,
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
