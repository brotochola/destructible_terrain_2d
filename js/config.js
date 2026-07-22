import { findHollowSpawn, generateLevel } from "./procgen.js";

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

/** Shared bedrock texture (world-locked tile UVs on each intact box). */
export const ROCK_TEXTURE_URL = "assets/rocky.jpg";
/** TilingSprite tileScale — lower = denser stones / more repeats. */
export const ROCK_TILE_SCALE = 0.25;
/** Multiply tint on grayscale rock (warm dirt). */
export const ROCK_TINT = 0xc4a574;
/** Shatter bolita sprites (scaled down to SHATTER_BALL diameter). */
export const ROCK_PARTICLE_URLS = ["assets/rock1.png", "assets/rock2.png"];
/** Exposed-edge rocky silhouette (visual only; physics stay AABB). */
/** World/layout px inset amplitude — fixed so splits keep same chew. */
export const ROCK_EDGE_AMP = 2.5;
/** Second octave amp (finer detail, less repetitive waves). */
export const ROCK_EDGE_AMP2 = 1.1;
/** Noise cell size (layout px); bilinear across cells = soft waves. */
export const ROCK_EDGE_STEP = 6;
/** Vertices per noise cell along an edge (denser = rounder polyline). */
export const ROCK_EDGE_SAMPLES_PER_STEP = 3;
/** Push stroke slightly into the void so ceilings/floors both read. */
export const ROCK_EDGE_STROKE_OUTSET = 0.45;
export const ROCK_EDGE_STROKE = 0x2e1702;
export const ROCK_EDGE_STROKE_WIDTH_FRAC = 0.02;
export const ROCK_EDGE_STROKE_WIDTH_MAX = 2;

/** Procedural map size (layout px). */
export const MAP_W = 5000;
export const MAP_H = 2000;
export const MAP_SEED = 42;
/** Noise frequency in order-1 cell units (lower = bigger caves). */
export const NOISE_SCALE = 0.015;
export const NOISE_OCTAVES = 2;
export const NOISE_LACUNARITY = 2;
export const NOISE_GAIN = 0.5;
/** Solid when fbm + yBias*depth > threshold. */
export const SOLID_THRESHOLD = 0.15;
/** Extra solid toward bottom (0 = free islands, ~0.4 = slab+caves). */
export const NOISE_Y_BIAS = 0.5;
/** Cap packed root order (order 9 → 2560 px side). */
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
export const DYNAMIC_MAX_ORDER = 3;
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
/** Body active if AABB overlaps view expanded by this (≥ LASER_RANGE px). */
export const PHYS_ACTIVE_MARGIN_PX = 900;
export const SOLVER_BUSY_DYNAMIC_COUNT = 200;

export const MIN_ZOOM = 0.033;
export const MAX_ZOOM = 12;

export const pl = window.planck;
export const Vec2 = pl.Vec2;
