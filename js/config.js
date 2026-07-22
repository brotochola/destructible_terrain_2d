import { findHollowSpawn, generateLevel } from "./procgen.js";

export const W = window.innerWidth;
export const H = window.innerHeight;
export const ZOOM = 4;
export const PTM = 10;
/** Leaf scale; order-0 collider = P_D = 20; order-1 = P_D*2 = 40. */
export const P_D = 20;
export const SHATTER_BALL_RADIUS = P_D / 5;
export const px2m = (px) => px / PTM;
export const m2px = (m) => m * PTM;

/** Side length in px for an order-N mamushka (leaf = order 0; shatter at N=0). */
export function orderSize(n) {
  return P_D * 2 ** n;
}

export const MAT_DIRT = "dirt";
export const MAT_STONE = "stone";
/**
 * Intact materials — texture/tint/physics.
 * Laser HP ≈ ceil(hardness * density): hardness = cut resistance, density = mass to ablate.
 */
export const MATERIALS = {
  [MAT_DIRT]: {
    textureUrl: "assets/rocky.jpg",
    tint: 0xc4a574,
    tileScale: 0.25,
    density: 1.0,
    hardness: 1.0,
  },
  [MAT_STONE]: {
    textureUrl: "assets/rocky2.jpg",
    tint: 0xb0b0b0,
    tileScale: 0.25,
    density: 1.6,
    hardness: 2.5,
  },
};

/** Laser hits to split one intact node (min 1). */
export function laserHpForMaterial(mat) {
  const h = mat && mat.hardness != null ? mat.hardness : 1;
  const d = mat && mat.density != null ? mat.density : 1;
  return Math.max(1, Math.ceil(h * d));
}
/** Fraction of map depth at/below which solid cells become stone. */
export const STONE_DEPTH_FRAC = 0.45;
/** @deprecated use MATERIALS[MAT_DIRT].textureUrl */
export const ROCK_TEXTURE_URL = MATERIALS[MAT_DIRT].textureUrl;
/** @deprecated use MATERIALS[*].tileScale */
export const ROCK_TILE_SCALE = MATERIALS[MAT_DIRT].tileScale;
/** @deprecated use MATERIALS[MAT_DIRT].tint */
export const ROCK_TINT = MATERIALS[MAT_DIRT].tint;
/** Shatter bolita sprites (scaled down to SHATTER_BALL diameter). */
export const ROCK_PARTICLE_URLS = ["assets/rock1.png", "assets/rock2.png"];
/**
 * On-screen shatter ball max side.
 * Collider diam * 1.3 overhang.
 */
export const ROCK_PARTICLE_VISUAL = SHATTER_BALL_RADIUS * 2 * 1.3;

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
export const ROCK_EDGE_STROKE_OUTSET = 2;
export const ROCK_EDGE_STROKE = 0xffffff;
export const ROCK_EDGE_STROKE_WIDTH_FRAC = 2;
export const ROCK_EDGE_STROKE_WIDTH_MAX = 2;
/**
 * Cap cacheAsTexture side (px). Large roots bake soft; shatter → sharper kids.
 * ponytail: ceiling 512² VRAM/box; raise if zoom-in on big chunks looks soft.
 */
export const ROCK_CACHE_MAX_PX = 512;
/**
 * Outset sealed faces so fill overlaps neighbor (hides solver micro-gaps).
 * Exposed faces still chew inward; physics stay AABB.
 */
export const ROCK_FILL_OVERLAP_PX = 1.5;

/** Procedural map size (layout px). */
export const MAP_W = 4000;
export const MAP_H = 1200;
export const MAP_SEED = 9193191;
/** Global edge-noise seed — world-locked so neighboring roots share chew. */
export const ROCK_EDGE_SEED = MAP_SEED ^ 0x51eed;
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
  stoneDepthFrac: STONE_DEPTH_FRAC,
});

/**
 * Root boxes in layout-local px (added to originX / terrainTop).
 * Packed from Perlin occupancy — order N → size P_D*2^N; each has material.
 */
export const LEVEL_LAYOUT = _gen.layout;
export const MAP_OCCUPANCY = _gen.solid;
export const MAP_MATERIALS = _gen.materials;
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
/** Runtime-tunable laser settings (UI mutates fields). */
export const laserTunables = {
  cooldownMs: 111,
  /** Damage per shot against intact HP (see laserHpForMaterial). */
  damage: 1,
};

/** Balls spawned when an order-0 box shatters. */
export const SHATTER_BALL_COUNT = 4;
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
export const CAT_BOMB = 0x0010;

/** Runtime-tunable bomb throw / blast. */
export const bombTunables = {
  cooldownMs: 40,
  fuseMs: 900,
  throwSpeed: px2m(280),
  /** Damage at 1px; damage = power / distSq. */
  power: 8111,
  /** AOE cutoff (px). */
  radiusPx: 220,
  /** Collider / sprite radius (px). */
  radiusBodyPx: 8,
};
/** Floor for distSq so blast center never divides by 0. */
export const BOMB_MIN_DIST_PX = 8;
/** Explosion flash lifetime (ms). */
export const BOMB_FLASH_MS = 120;
/** Radial impulse scale (px-equivalent × damage) for character / soft particle hits. */
export const BOMB_KICK_PER_DAMAGE = 12;

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
