/** Uniform grid for AABB queries. Boxes stored in every overlapping cell. */

/** Pack cell coords into one Map key (no string). Cells in [-32768, 32767]. */
function cellKey(cx, cy) {
  return ((cx + 0x8000) << 16) | ((cy + 0x8000) & 0xffff);
}

const _aabb = { x: 0, y: 0, size: 0 };

export class SpatialHash {
  /**
   * @param {number} cellSize world px
   */
  constructor(cellSize) {
    this.cellSize = Math.max(1, cellSize);
    /** @type {Map<number, Set<*>>} */
    this.cells = new Map();
    /** @type {Map<*, number[]>} */
    this.itemKeys = new Map();
    /** Reused by queryInto — caller must finish before next queryInto. */
    this._queryScratch = new Set();
  }

  clear() {
    this.cells.clear();
    this.itemKeys.clear();
    this._queryScratch.clear();
  }

  /**
   * @param {{ x: number, y: number, size: number }} aabb
   * @param {(key: number) => void} fn
   */
  _forCells(aabb, fn) {
    const s = this.cellSize;
    const x0 = Math.floor(aabb.x / s);
    const y0 = Math.floor(aabb.y / s);
    const x1 = Math.floor((aabb.x + aabb.size) / s);
    const y1 = Math.floor((aabb.y + aabb.size) / s);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        fn(cellKey(cx, cy));
      }
    }
  }

  _readAabb(item) {
    if (typeof item.worldAabbInto === "function") {
      return item.worldAabbInto(_aabb);
    }
    const a = item.worldAabb();
    _aabb.x = a.x;
    _aabb.y = a.y;
    _aabb.size = a.size;
    return _aabb;
  }

  /**
   * @param {{ worldAabb?: Function, worldAabbInto?: Function }} item
   */
  insert(item) {
    this.remove(item);
    const keys = [];
    this._forCells(this._readAabb(item), (key) => {
      let set = this.cells.get(key);
      if (!set) {
        set = new Set();
        this.cells.set(key, set);
      }
      set.add(item);
      keys.push(key);
    });
    this.itemKeys.set(item, keys);
  }

  remove(item) {
    const keys = this.itemKeys.get(item);
    if (!keys) return;
    for (let i = 0; i < keys.length; i++) {
      const set = this.cells.get(keys[i]);
      if (!set) continue;
      set.delete(item);
      if (set.size === 0) this.cells.delete(keys[i]);
    }
    this.itemKeys.delete(item);
  }

  /**
   * Rehash only when cell membership changed (avoids churn for statics / small moves).
   */
  update(item) {
    const prev = this.itemKeys.get(item);
    if (!prev) {
      this.insert(item);
      return;
    }
    const next = [];
    this._forCells(this._readAabb(item), (key) => next.push(key));
    if (prev.length === next.length) {
      let same = true;
      for (let i = 0; i < prev.length; i++) {
        if (prev[i] !== next[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.insert(item);
  }

  /**
   * Fill `out` (cleared first). Prefer this over query() to avoid Set alloc.
   * @param {{ x0: number, y0: number, x1: number, y1: number }} bounds
   * @param {Set<*>} out
   * @returns {Set<*>}
   */
  queryInto(bounds, out) {
    out.clear();
    const s = this.cellSize;
    const x0 = Math.floor(bounds.x0 / s);
    const y0 = Math.floor(bounds.y0 / s);
    const x1 = Math.floor(bounds.x1 / s);
    const y1 = Math.floor(bounds.y1 / s);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(cellKey(cx, cy));
        if (!set) continue;
        for (const item of set) out.add(item);
      }
    }
    return out;
  }

  /**
   * @param {{ x0: number, y0: number, x1: number, y1: number }} bounds
   * @returns {Set<*>} scratch set — valid until next query/queryInto on this hash
   */
  query(bounds) {
    return this.queryInto(bounds, this._queryScratch);
  }
}
