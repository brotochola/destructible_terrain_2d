/**
 * Seeded Perlin FBM → order-1 occupancy mask → mamushka quadtree pack.
 * Finest intact box is order 1 (side = leaf * 2).
 */

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPermutation(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + t * (b - a);
}

function grad(hash, x, y) {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/** Classic 2D Perlin in roughly [-1, 1]. */
export function perlin2(perm, x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[X + perm[Y]];
  const ab = perm[X + perm[Y + 1]];
  const ba = perm[X + 1 + perm[Y]];
  const bb = perm[X + 1 + perm[Y + 1]];
  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v,
  );
}

export function fbm2(perm, x, y, octaves, lacunarity, gain) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2(perm, x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Build Uint8 occupancy (1 = solid) at order-1 cell resolution.
 * cellSizePx = orderSize(1).
 */
export function buildOccupancy({
  cols,
  rows,
  seed,
  scale,
  octaves,
  lacunarity,
  gain,
  threshold,
  yBias,
}) {
  const perm = buildPermutation(seed);
  const solid = new Uint8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    const ny = (gy + 0.5) * scale;
    // 0 at top → 1 at bottom; adds rock toward floor.
    const depth = rows > 1 ? gy / (rows - 1) : 1;
    for (let gx = 0; gx < cols; gx++) {
      const nx = (gx + 0.5) * scale;
      const n = fbm2(perm, nx, ny, octaves, lacunarity, gain);
      const v = n + yBias * depth;
      solid[gy * cols + gx] = v > threshold ? 1 : 0;
    }
  }
  return solid;
}

/** 3x3 majority — kills 1-cell speckles so quadtree merges more. */
export function smoothOccupancy(solid, cols, rows, passes = 1) {
  let cur = solid;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cols * rows);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = gx + dx;
            const y = gy + dy;
            if (x < 0 || y < 0 || x >= cols || y >= rows) {
              // Outside map counts as hollow (no inflate past edge).
              continue;
            }
            n += cur[y * cols + x];
          }
        }
        next[gy * cols + gx] = n >= 5 ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

function regionState(solid, cols, rows, gx, gy, side) {
  let anySolid = false;
  let anyHollow = false;
  for (let y = gy; y < gy + side; y++) {
    if (y < 0 || y >= rows) {
      anyHollow = true;
      continue;
    }
    for (let x = gx; x < gx + side; x++) {
      if (x < 0 || x >= cols || !solid[y * cols + x]) {
        anyHollow = true;
        if (anySolid) return "mixed";
      } else {
        anySolid = true;
        if (anyHollow) return "mixed";
      }
    }
  }
  if (!anySolid) return "hollow";
  if (!anyHollow) return "solid";
  return "mixed";
}

function packSquare(
  out,
  solid,
  cols,
  rows,
  gx,
  gy,
  sideCells,
  cellSizePx,
  maxPackOrder,
) {
  if (sideCells < 1) return;
  const state = regionState(solid, cols, rows, gx, gy, sideCells);
  if (state === "hollow") return;

  const order = 1 + Math.log2(sideCells);
  if (state === "solid" && order === (order | 0) && order <= maxPackOrder) {
    out.push({
      order,
      x: gx * cellSizePx,
      y: gy * cellSizePx,
    });
    return;
  }

  if (sideCells === 1) {
    if (state === "solid") {
      out.push({ order: 1, x: gx * cellSizePx, y: gy * cellSizePx });
    }
    return;
  }

  // Hit max pack order while mixed/solid-too-big: force split.
  const half = sideCells >> 1;
  packSquare(out, solid, cols, rows, gx, gy, half, cellSizePx, maxPackOrder);
  packSquare(
    out,
    solid,
    cols,
    rows,
    gx + half,
    gy,
    half,
    cellSizePx,
    maxPackOrder,
  );
  packSquare(
    out,
    solid,
    cols,
    rows,
    gx,
    gy + half,
    half,
    cellSizePx,
    maxPackOrder,
  );
  packSquare(
    out,
    solid,
    cols,
    rows,
    gx + half,
    gy + half,
    half,
    cellSizePx,
    maxPackOrder,
  );
}

/**
 * Cover rectangle with power-of-2 squares (corner greedy), pack each.
 * Right strip + below strip — no gaps / double-cover.
 */
function packRect(
  out,
  solid,
  cols,
  rows,
  gx,
  gy,
  w,
  h,
  cellSizePx,
  maxPackOrder,
) {
  if (w <= 0 || h <= 0) return;
  const maxSide = 2 ** Math.max(0, maxPackOrder - 1);
  let side = 1;
  const maxFit = Math.min(w, h, maxSide);
  while (side * 2 <= maxFit) side *= 2;
  packSquare(out, solid, cols, rows, gx, gy, side, cellSizePx, maxPackOrder);
  packRect(
    out,
    solid,
    cols,
    rows,
    gx + side,
    gy,
    w - side,
    side,
    cellSizePx,
    maxPackOrder,
  );
  packRect(
    out,
    solid,
    cols,
    rows,
    gx,
    gy + side,
    w,
    h - side,
    cellSizePx,
    maxPackOrder,
  );
}

export function packOccupancy(solid, cols, rows, cellSizePx, maxPackOrder) {
  const out = [];
  packRect(
    out,
    solid,
    cols,
    rows,
    0,
    0,
    cols,
    rows,
    cellSizePx,
    maxPackOrder,
  );
  return out;
}

/**
 * Find hollow order-1 cell near top-center for character spawn.
 * Returns layout-local px of cell center, or null if map fully solid.
 */
export function findHollowSpawn(solid, cols, rows, cellSizePx) {
  const cx = (cols / 2) | 0;
  const maxR = Math.max(cols, rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let r = 0; r <= maxR; r++) {
      for (const dx of r === 0 ? [0] : [-r, r]) {
        const gx = cx + dx;
        if (gx < 0 || gx >= cols) continue;
        if (!solid[gy * cols + gx]) {
          return {
            x: (gx + 0.5) * cellSizePx,
            y: (gy + 0.5) * cellSizePx,
          };
        }
      }
    }
  }
  return null;
}

/**
 * @returns {{ layout: {order,x,y}[], solid: Uint8Array, cols: number, rows: number, cellSizePx: number }}
 */
export function generateLevel(opts) {
  const {
    mapW,
    mapH,
    cellSizePx,
    seed,
    scale,
    octaves = 4,
    lacunarity = 2,
    gain = 0.5,
    threshold,
    yBias = 0.35,
    maxPackOrder = 9,
  } = opts;

  const cols = Math.max(1, Math.floor(mapW / cellSizePx));
  const rows = Math.max(1, Math.floor(mapH / cellSizePx));
  const raw = buildOccupancy({
    cols,
    rows,
    seed,
    scale,
    octaves,
    lacunarity,
    gain,
    threshold,
    yBias,
  });
  const solid = smoothOccupancy(raw, cols, rows, 2);
  const layout = packOccupancy(solid, cols, rows, cellSizePx, maxPackOrder);
  return { layout, solid, cols, rows, cellSizePx };
}

/** ponytail: fails if pack misses solid or double-covers. Run: node js/procgen.js */
function selfCheck() {
  const cell = 10;
  const { layout, solid, cols, rows } = generateLevel({
    mapW: 320,
    mapH: 160,
    cellSizePx: cell,
    seed: 7,
    scale: 0.04,
    octaves: 2,
    threshold: 0.1,
    yBias: 0.4,
    maxPackOrder: 6,
  });
  const cover = new Uint8Array(cols * rows);
  for (const item of layout) {
    const side = 2 ** (item.order - 1);
    const gx0 = Math.round(item.x / cell);
    const gy0 = Math.round(item.y / cell);
    for (let dy = 0; dy < side; dy++) {
      for (let dx = 0; dx < side; dx++) {
        const i = (gy0 + dy) * cols + (gx0 + dx);
        if (cover[i]) throw new Error("double cover at " + (gx0 + dx) + "," + (gy0 + dy));
        cover[i] = 1;
        if (!solid[i]) throw new Error("pack over hollow at " + (gx0 + dx) + "," + (gy0 + dy));
      }
    }
  }
  for (let i = 0; i < solid.length; i++) {
    if (solid[i] && !cover[i]) throw new Error("missed solid cell " + i);
  }
  console.log("procgen self-check ok — roots", layout.length);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  import.meta.url.replace(/\\/g, "/").endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) selfCheck();
