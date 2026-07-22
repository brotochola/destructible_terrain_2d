import { Texture } from "https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.mjs";
import {
  MAX_PACK_ORDER,
  ROCK_BOX_OVERFLOW,
  ROCK_BOX_ROT_VARIANTS,
  ROCK_MUSH_MAX_TEX,
  ROCK_MUSH_MIN_TEX,
  ROCK_MUSH_SEED,
  ROCK_MUSH_VARIANTS,
  orderSize,
  rockMushVisualSize,
} from "./config.js";

const QUARTER = Math.PI / 2;

/** Deterministic PRNG 0..1. */
function mulberry32(seed) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable int hash from rootId (string or number). */
export function hashRootId(rootId) {
  const s = String(rootId);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * Hash-pick mush for roots / coalesce.
 * @param {import('pixi.js').Texture[][]} byOrder
 * @param {number} order
 * @param {number|string} rootId
 * @param {number} [gx]
 * @param {number} [gy]
 * @returns {{ texture: import('pixi.js').Texture, variant: number, texRot: number }}
 */
export function pickMush(byOrder, order, rootId, gx = 0, gy = 0) {
  if (!byOrder) return null;
  let variants = byOrder[order];
  if (!variants || !variants.length) {
    for (let o = order - 1; o >= 1; o--) {
      variants = byOrder[o];
      if (variants && variants.length) break;
    }
  }
  if (!variants || !variants.length) return null;
  const h = hashRootId(rootId + "_" + order + "_" + gx + "_" + gy) >>> 0;
  const variant = h % variants.length;
  const texRot = order === 1 ? (variant % ROCK_BOX_ROT_VARIANTS) * QUARTER : 0;
  return { texture: variants[variant], variant, texRot };
}

/**
 * Resolve mush from parent recipe quadrant (shatter continuity).
 * @param {import('pixi.js').Texture[][]} byOrder
 * @param {number} order
 * @param {{ variant: number, rot: number }} hint
 */
export function resolveMushHint(byOrder, order, hint) {
  if (!byOrder || !hint) return null;
  const variants = byOrder[order];
  if (!variants || !variants.length) return null;
  const variant =
    ((hint.variant % variants.length) + variants.length) % variants.length;
  return { texture: variants[variant], variant, texRot: hint.rot };
}

/** @deprecated use pickMush */
export function pickRockTexture(byOrder, order, rootId, gx = 0, gy = 0) {
  const m = pickMush(byOrder, order, rootId, gx, gy);
  return m ? m.texture : null;
}

/** HTMLImageElement / ImageBitmap / canvas from a loaded Pixi texture. */
function brushDrawable(texture) {
  const src = texture && texture.source;
  let resource = src && src.resource;
  if (resource && resource.tagName == null && resource.source) {
    resource = resource.source;
  }
  if (
    !resource ||
    (typeof resource !== "object" && typeof resource !== "function")
  ) {
    throw new Error("rock mush: brush texture has no drawable resource");
  }
  return resource;
}

function drawCentered(ctx, img, cx, cy, dw, dh, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/**
 * Punch solid black (and near-black) to alpha 0 so stamped clusters overlap
 * without dark grid seams.
 */
function keyBlackToAlpha(img, threshold = 28, soft = 12) {
  const w = img.width || img.naturalWidth || 1;
  const h = img.height || img.naturalHeight || 1;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const softEnd = threshold + soft;
  for (let i = 0; i < d.length; i += 4) {
    const maxc = d[i] > d[i + 1] ? d[i] : d[i + 1];
    const luma = maxc > d[i + 2] ? maxc : d[i + 2];
    if (luma <= threshold) {
      d[i + 3] = 0;
    } else if (luma < softEnd && d[i + 3]) {
      d[i + 3] = ((d[i + 3] * (luma - threshold)) / soft) | 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToTexture(canvas) {
  const texture = Texture.from(canvas);
  texture.source.addressModeU = "clamp-to-edge";
  texture.source.addressModeV = "clamp-to-edge";
  return texture;
}

/** Child-cell centers must stay opaque (parent mid is a 4-way seam). */
function assertQuadCover(ctx, margin, boxWorld, worldToTex) {
  const childBox = boxWorld / 2;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const x = (margin + dx * childBox + childBox / 2) * worldToTex;
      const y = (margin + dy * childBox + childBox / 2) * worldToTex;
      const d = ctx.getImageData(x | 0, y | 0, 1, 1).data;
      if (d[3] < 250) {
        throw new Error(
          `rock mush quad cover failed at (${x | 0},${y | 0}) alpha=${d[3]}`,
        );
      }
    }
  }
}

/**
 * Bake one order-n≥2 variant from 4 child quads.
 * Recipe order: (dx,dy) = (0,0),(1,0),(0,1),(1,1) → index dy*2+dx.
 *
 * @param {boolean} allowChildRot order-1 children may rotate; higher stay rot=0
 *   so mid-order texRot never desyncs collider vs sprite on further shatter.
 * @returns {{ canvas: HTMLCanvasElement, recipe: { variant: number, rot: number }[] }}
 */
function bakeComposite(
  childDrawables,
  childVisualWorld,
  childVariantCount,
  boxWorld,
  visualWorld,
  texSize,
  rng,
  allowChildRot,
) {
  const canvas = document.createElement("canvas");
  canvas.width = texSize;
  canvas.height = texSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  // Transparent canvas — keyed stamps overlap via overflow (seamless).
  ctx.clearRect(0, 0, texSize, texSize);

  const worldToTex = texSize / visualWorld;
  const margin = ROCK_BOX_OVERFLOW;
  const childBox = boxWorld / 2;
  const recipe = [];

  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const variant = (rng() * childVariantCount) | 0;
      const rot = allowChildRot ? ((rng() * 4) | 0) * QUARTER : 0;
      recipe[dy * 2 + dx] = { variant, rot };

      const img = childDrawables[variant];
      const iw = img.width || img.naturalWidth || childVisualWorld;
      const ih = img.height || img.naturalHeight || childVisualWorld;
      const scale = childVisualWorld / Math.max(iw, ih, 1);
      const dw = iw * scale * worldToTex;
      const dh = ih * scale * worldToTex;
      const cx = (margin + dx * childBox + childBox / 2) * worldToTex;
      const cy = (margin + dy * childBox + childBox / 2) * worldToTex;
      drawCentered(ctx, img, cx, cy, dw, dh, rot);
    }
  }

  if (recipe.length !== 4) {
    throw new Error(`rock mush recipe length ${recipe.length}, want 4`);
  }

  assertQuadCover(ctx, margin, boxWorld, worldToTex);
  return { canvas, recipe };
}

/**
 * Hierarchical box.png mush bake.
 * Order 1: shared box.png × 4 rot indices (runtime texRot).
 * Order n≥2: 2×2 of lower order + recipes for shatter continuity.
 *
 * @param {import('pixi.js').Texture} boxTexture
 * @param {{ maxOrder?: number, seed?: number }} [opts]
 * @returns {{ byOrder: import('pixi.js').Texture[][], recipes: { variant: number, rot: number }[][][] }}
 */
export function bakeRockMushTextures(boxTexture, opts = {}) {
  const maxOrder = opts.maxOrder != null ? opts.maxOrder : MAX_PACK_ORDER;
  const seed = opts.seed != null ? opts.seed : ROCK_MUSH_SEED;
  if (!boxTexture) {
    throw new Error("rock mush: need box.png texture");
  }

  const boxImg = keyBlackToAlpha(brushDrawable(boxTexture));
  const boxTexKeyed = canvasToTexture(boxImg);
  /** @type {import('pixi.js').Texture[][]} */
  const byOrder = [];
  /** @type {{ variant: number, rot: number }[][][]} */
  const recipes = [];

  // Order 1: keyed box.png (no black bg); 4 slots = rot variants (texRot at pick).
  const order1 = [];
  for (let i = 0; i < ROCK_BOX_ROT_VARIANTS; i++) {
    order1.push(boxTexKeyed);
  }
  byOrder[1] = order1;

  /** Drawable per variant for the last baked order (order 1 = keyed img ×4). */
  let childDrawables = order1.map(() => boxImg);
  let childVariantCount = ROCK_BOX_ROT_VARIANTS;

  for (let order = 2; order <= maxOrder; order++) {
    const boxWorld = orderSize(order);
    const visualWorld = rockMushVisualSize(boxWorld);
    const childVisualWorld = rockMushVisualSize(orderSize(order - 1));
    const texSize = Math.max(
      ROCK_MUSH_MIN_TEX,
      Math.min(Math.ceil(visualWorld), ROCK_MUSH_MAX_TEX),
    );
    const variants = [];
    const orderRecipes = [];

    for (let v = 0; v < ROCK_MUSH_VARIANTS; v++) {
      const rng = mulberry32(
        seed ^ Math.imul(order, 0x9e3779b9) ^ (v * 0x85ebca6b),
      );
      const { canvas, recipe } = bakeComposite(
        childDrawables,
        childVisualWorld,
        childVariantCount,
        boxWorld,
        visualWorld,
        texSize,
        rng,
        order === 2,
      );
      variants.push(canvasToTexture(canvas));
      orderRecipes.push(recipe);
    }

    byOrder[order] = variants;
    recipes[order] = orderRecipes;

    childDrawables = variants.map(brushDrawable);
    childVariantCount = ROCK_MUSH_VARIANTS;
  }

  if (!recipes[2] || !recipes[2].length || recipes[2][0].length !== 4) {
    throw new Error("rock mush: order-2 recipes missing or not length-4");
  }

  return { byOrder, recipes };
}
