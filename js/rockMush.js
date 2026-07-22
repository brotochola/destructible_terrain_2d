import { Texture } from "https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.mjs";
import {
  ROCK_MUSH_BAKE_MAX_ORDER,
  ROCK_MUSH_DENSITY,
  ROCK_MUSH_MIN_TEX,
  ROCK_MUSH_SEED,
  ROCK_PARTICLE_VISUAL,
  orderTexSize,
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

function texList(byOrder, order) {
  if (!byOrder) return null;
  let variants = byOrder[order];
  if (!variants || !variants.length) {
    for (let o = Math.min(order, ROCK_MUSH_BAKE_MAX_ORDER); o >= 1; o--) {
      variants = byOrder[o];
      if (variants && variants.length) break;
    }
  }
  return variants && variants.length ? variants : null;
}

/**
 * Hash-pick mush for roots / coalesce.
 * One texture per order; variety via texRot (0/90/180/270).
 * Order > bake max falls back to largest baked atlas.
 */
export function pickMush(byOrder, order, rootId, gx = 0, gy = 0) {
  const variants = texList(byOrder, order);
  if (!variants) return null;
  const h = hashRootId(rootId + "_" + order + "_" + gx + "_" + gy) >>> 0;
  return {
    texture: variants[0],
    variant: 0,
    texRot: (h % 4) * QUARTER,
  };
}

/**
 * Resolve mush from parent recipe quadrant (shatter continuity).
 * @param {{ variant?: number, rot: number }} hint
 */
export function resolveMushHint(byOrder, order, hint) {
  if (!byOrder || !hint) return null;
  const variants = texList(byOrder, order);
  if (!variants) return null;
  return { texture: variants[0], variant: 0, texRot: hint.rot };
}

/**
 * Synthetic 4-quad recipe when parent has no bake recipes (order > bake max).
 * Index = dy*2+dx.
 */
export function synthesizeRecipe(rootId, order, gx, gy) {
  const recipe = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const h =
        hashRootId(
          rootId + "_r_" + order + "_" + gx + "_" + gy + "_" + dx + "_" + dy,
        ) >>> 0;
      recipe[dy * 2 + dx] = { variant: 0, rot: (h % 4) * QUARTER };
    }
  }
  return recipe;
}

/** @deprecated use pickMush */
export function pickRockTexture(byOrder, order, rootId, gx = 0, gy = 0) {
  const m = pickMush(byOrder, order, rootId, gx, gy);
  return m ? m.texture : null;
}

/** Data URL for UI preview of a baked Pixi texture (canvas-backed). */
export function mushTextureDataURL(texture) {
  const src = texture && texture.source;
  let resource = src && src.resource;
  if (resource && resource.tagName == null && resource.source) {
    resource = resource.source;
  }
  if (resource instanceof HTMLCanvasElement) {
    return resource.toDataURL("image/png");
  }
  if (
    resource &&
    (resource instanceof HTMLImageElement ||
      (typeof ImageBitmap !== "undefined" && resource instanceof ImageBitmap))
  ) {
    const w = resource.width || resource.naturalWidth || texture.width || 1;
    const h = resource.height || resource.naturalHeight || texture.height || 1;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(resource, 0, 0);
    return c.toDataURL("image/png");
  }
  throw new Error("mush preview: texture has no drawable canvas/image");
}

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

function drawCentered(ctx, img, cx, cy, dw, dh, rot, flipX = false) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  if (flipX) ctx.scale(-1, 1);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

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

function trimAlpha(canvas, alphaMin = 16) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    throw new Error("rock mush: brush fully transparent after key");
  }
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = tw;
  out.height = th;
  out.getContext("2d").drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);
  return out;
}

function prepareBrush(texture) {
  return trimAlpha(keyBlackToAlpha(brushDrawable(texture)));
}

function canvasToTexture(canvas) {
  const texture = Texture.from(canvas);
  texture.source.addressModeU = "clamp-to-edge";
  texture.source.addressModeV = "clamp-to-edge";
  return texture;
}

function assertCenterOpaque(ctx, texSize) {
  const mid = texSize / 2;
  const d = ctx.getImageData(mid | 0, mid | 0, 1, 1).data;
  if (d[3] < 250) {
    throw new Error(`rock mush center cover failed alpha=${d[3]}`);
  }
}

function stampRock(ctx, brushes, cx, cy, stampPx, rng) {
  const img = brushes[(rng() * brushes.length) | 0];
  const iw = img.width || img.naturalWidth || 1;
  const ih = img.height || img.naturalHeight || 1;
  const scale = stampPx / Math.max(iw, ih);
  drawCentered(
    ctx,
    img,
    cx,
    cy,
    iw * scale,
    ih * scale,
    rng() * Math.PI * 2,
    rng() < 0.5,
  );
}

/**
 * Order-1: pad work canvas → stamp (centers inset so stamps stay whole) →
 * crop inner tex. Do not center on crop edge — that slices rocks in half.
 */
function bakeOrder1Cluster(brushes, rng) {
  const finalSize = orderTexSize(1);
  const stampPx = ROCK_PARTICLE_VISUAL * 3;
  const pad = Math.ceil(stampPx / 2);
  const work = finalSize + 2 * pad;
  const canvas = document.createElement("canvas");
  canvas.width = work;
  canvas.height = work;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, work, work);

  const stampR = stampPx / 2;
  const inner0 = pad;
  const c0 = inner0 + stampR;
  const c1 = inner0 + finalSize - stampR;

  function clampC(v) {
    return Math.max(c0, Math.min(c1, v));
  }

  stampRock(ctx, brushes, work / 2, work / 2, stampPx, rng);

  const rim = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.5, 0],
    [0.5, 1],
    [0, 0.5],
    [1, 0.5],
    [0.25, 0],
    [0.75, 0],
    [0.25, 1],
    [0.75, 1],
    [0, 0.25],
    [0, 0.75],
    [1, 0.25],
    [1, 0.75],
  ];
  for (const [ux, uy] of rim) {
    stampRock(
      ctx,
      brushes,
      clampC(c0 + ux * (c1 - c0)),
      clampC(c0 + uy * (c1 - c0)),
      stampPx,
      rng,
    );
  }

  const n = Math.max(
    8,
    Math.ceil(
      ((finalSize * finalSize) / (stampPx * stampPx)) * ROCK_MUSH_DENSITY,
    ),
  );
  for (let i = 0; i < n; i++) {
    stampRock(
      ctx,
      brushes,
      c0 + rng() * (c1 - c0),
      c0 + rng() * (c1 - c0),
      stampPx,
      rng,
    );
  }

  const fitted = document.createElement("canvas");
  fitted.width = finalSize;
  fitted.height = finalSize;
  fitted
    .getContext("2d")
    .drawImage(
      canvas,
      pad,
      pad,
      finalSize,
      finalSize,
      0,
      0,
      finalSize,
      finalSize,
    );
  return fitted;
}

/**
 * 2× child composite at 1:1 (keeps whole rocks). Fill + seam with stamps so
 * quads do not leave a black cross. Scaling quads by VISUAL_RATIO knife-cuts
 * outer rocks when clipped to atlas.
 * Recipe: [{ variant:0, rot }, ×4] index dy*2+dx.
 */
function bakeComposite(childCanvas, brushes, rng) {
  const childSize = childCanvas.width;
  const texSize = childSize * 2;
  const canvas = document.createElement("canvas");
  canvas.width = texSize;
  canvas.height = texSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, texSize, texSize);

  const recipe = [];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const rot = ((rng() * 4) | 0) * QUARTER;
      recipe[dy * 2 + dx] = { variant: 0, rot };
      const cx = dx * childSize + childSize / 2;
      const cy = dy * childSize + childSize / 2;
      drawCentered(ctx, childCanvas, cx, cy, childSize, childSize, rot);
    }
  }

  if (recipe.length !== 4) {
    throw new Error(`rock mush recipe length ${recipe.length}, want 4`);
  }

  // Same particle size as order-1 bake, scaled if child tex is larger than order-1.
  const stampPx =
    ROCK_PARTICLE_VISUAL * 3 * (childSize / orderTexSize(1));
  const stampR = stampPx / 2;
  const step = stampPx * 0.55;
  const seam0 = stampR;
  const seam1 = texSize - stampR;
  for (let y = seam0; y <= seam1 + 1e-6; y += step) {
    stampRock(ctx, brushes, childSize, y, stampPx, rng);
  }
  for (let x = seam0; x <= seam1 + 1e-6; x += step) {
    stampRock(ctx, brushes, x, childSize, stampPx, rng);
  }

  // Any opaque pixel in each quad (child mid / seams often transparent).
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const x0 = (dx * childSize + childSize * 0.2) | 0;
      const y0 = (dy * childSize + childSize * 0.2) | 0;
      const w = Math.max(1, (childSize * 0.6) | 0);
      const data = ctx.getImageData(x0, y0, w, w).data;
      let ok = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] >= 250) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        throw new Error(`rock mush quad cover failed at quad (${dx},${dy})`);
      }
    }
  }

  return { canvas, recipe };
}

/**
 * Hierarchical mush bake: one tex per order 1..maxOrder.
 * Sizes: 128, 256, … 2048. Recipes store quadrant rots for shatter.
 *
 * @param {import('pixi.js').Texture[]} particleTextures
 * @param {{ maxOrder?: number, seed?: number }} [opts]
 * @returns {{ byOrder: import('pixi.js').Texture[][], recipes: { variant: number, rot: number }[][][] }}
 */
export function bakeRockMushTextures(particleTextures, opts = {}) {
  const maxOrder =
    opts.maxOrder != null ? opts.maxOrder : ROCK_MUSH_BAKE_MAX_ORDER;
  const seed = opts.seed != null ? opts.seed : ROCK_MUSH_SEED;
  if (!particleTextures || !particleTextures.length) {
    throw new Error("rock mush: need rock particle textures");
  }
  if (orderTexSize(1) !== ROCK_MUSH_MIN_TEX) {
    throw new Error("rock mush: orderTexSize(1) must equal ROCK_MUSH_MIN_TEX");
  }

  const brushes = particleTextures.map(prepareBrush);

  /** @type {import('pixi.js').Texture[][]} */
  const byOrder = [];
  /** @type {{ variant: number, rot: number }[][][]} */
  const recipes = [];

  const rng1 = mulberry32(seed ^ 0x9e3779b9);
  const canvas1 = bakeOrder1Cluster(brushes, rng1);
  byOrder[1] = [canvasToTexture(canvas1)];

  let childCanvas = canvas1;

  for (let order = 2; order <= maxOrder; order++) {
    const want = orderTexSize(order);
    const rng = mulberry32(seed ^ Math.imul(order, 0x9e3779b9));
    const { canvas, recipe } = bakeComposite(childCanvas, brushes, rng);
    if (canvas.width !== want || canvas.height !== want) {
      throw new Error(
        `rock mush order ${order}: got ${canvas.width}px, want ${want}`,
      );
    }
    byOrder[order] = [canvasToTexture(canvas)];
    // recipes[order][variant=0] = recipe
    recipes[order] = [recipe];
    childCanvas = canvas;
  }

  if (!recipes[2] || !recipes[2][0] || recipes[2][0].length !== 4) {
    throw new Error("rock mush: order-2 recipes missing or not length-4");
  }

  return { byOrder, recipes };
}
