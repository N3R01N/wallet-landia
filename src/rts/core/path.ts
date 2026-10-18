/**
 * Pathfinding for many units at once: a flow field per destination. One
 * Dijkstra from the goal over the map's open cells (8 ways, no cutting
 * corners past a blocked cell) gives every cell its distance to the goal;
 * a unit anywhere steps towards its lowest neighbour. A group sent to one
 * place shares one field. Fields are kept (the most recent few) until the
 * ground changes (a building placed or destroyed).
 */

import { cellCentre, cellOf, type GameMap } from './map.js';

const KEEP = 24;
const SQRT2 = Math.SQRT2;

export class Paths {
  readonly #map: GameMap;
  readonly #fields = new Map<number, Float64Array>();
  /** Bumped when the ground changes; fields made before are dropped. */
  #version = 0;
  #fieldVersion = 0;

  constructor(map: GameMap) {
    this.#map = map;
  }

  /** The ground changed (a building came or went). */
  invalidate(): void {
    this.#version++;
  }

  /** The open cell nearest a point (the point's own when open), or -1. */
  nearestOpen(x: number, z: number, maxR = 12): number {
    const m = this.#map;
    const c = cellOf(m, x, z);
    if (c >= 0 && m.blocked[c] === 0) return c;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const n = cellOf(m, x + dx, z + dz);
          if (n < 0 || m.blocked[n] !== 0) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** The field to a goal cell (distances; Infinity where it can't be reached). */
  field(goal: number): Float64Array {
    if (this.#fieldVersion !== this.#version) {
      this.#fields.clear();
      this.#fieldVersion = this.#version;
    }
    const kept = this.#fields.get(goal);
    if (kept) {
      // most recently used last
      this.#fields.delete(goal);
      this.#fields.set(goal, kept);
      return kept;
    }
    const f = this.#dijkstra(goal);
    this.#fields.set(goal, f);
    if (this.#fields.size > KEEP) this.#fields.delete(this.#fields.keys().next().value!);
    return f;
  }

  /** The way to go from (x, z) on a field: a unit vector, or null at the goal or with no way. */
  step(field: Float64Array, x: number, z: number): { dx: number; dz: number } | null {
    const m = this.#map;
    const c = cellOf(m, x, z);
    if (c < 0) return null;
    const here = field[c]!;
    if (here === 0) return null;
    const cx = c % m.size;
    const cz = Math.floor(c / m.size);
    let best = -1;
    let bestD = Number.isFinite(here) ? here : Infinity;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= m.size || nz >= m.size) continue;
        const n = nz * m.size + nx;
        if (m.blocked[n] !== 0) continue;
        // no squeezing diagonally between two blocked cells
        if (dx !== 0 && dz !== 0 && (m.blocked[cz * m.size + nx] !== 0 || m.blocked[nz * m.size + cx] !== 0)) continue;
        if (field[n]! < bestD) {
          bestD = field[n]!;
          best = n;
        }
      }
    }
    if (best < 0) return null;
    const p = cellCentre(m, best);
    const vx = p.x - x;
    const vz = p.z - z;
    const len = Math.hypot(vx, vz) || 1;
    return { dx: vx / len, dz: vz / len };
  }

  /** Whether the straight line between two points crosses only open cells. */
  clear(x0: number, z0: number, x1: number, z1: number): boolean {
    const m = this.#map;
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / 0.4);
    for (let i = 1; i < n; i++) {
      const c = cellOf(m, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n);
      if (c < 0 || m.blocked[c] !== 0) return false;
    }
    return true;
  }

  #dijkstra(goal: number): Float64Array {
    const m = this.#map;
    const size = m.size;
    const dist = new Float64Array(size * size).fill(Infinity);
    if (goal < 0) return dist;
    const heap = new MinHeap();
    dist[goal] = 0;
    heap.push(goal, 0);
    while (heap.size > 0) {
      const [c, d] = heap.pop();
      if (d > dist[c]!) continue;
      const cx = c % size;
      const cz = (c - cx) / size;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          const n = nz * size + nx;
          if (m.blocked[n] !== 0) continue;
          if (dx !== 0 && dz !== 0 && (m.blocked[cz * size + nx] !== 0 || m.blocked[nz * size + cx] !== 0)) continue;
          const nd = d + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
          if (nd < dist[n]!) {
            dist[n] = nd;
            heap.push(n, nd);
          }
        }
      }
    }
    return dist;
  }
}

/** A binary min-heap of (cell, priority). */
class MinHeap {
  #cells: number[] = [];
  #pri: number[] = [];

  get size(): number {
    return this.#cells.length;
  }

  push(cell: number, p: number): void {
    const c = this.#cells;
    const q = this.#pri;
    c.push(cell);
    q.push(p);
    let i = c.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent]! <= q[i]!) break;
      [c[i], c[parent]] = [c[parent]!, c[i]!];
      [q[i], q[parent]] = [q[parent]!, q[i]!];
      i = parent;
    }
  }

  pop(): [number, number] {
    const c = this.#cells;
    const q = this.#pri;
    const top: [number, number] = [c[0]!, q[0]!];
    const lastC = c.pop()!;
    const lastQ = q.pop()!;
    if (c.length > 0) {
      c[0] = lastC;
      q[0] = lastQ;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < c.length && q[l]! < q[s]!) s = l;
        if (r < c.length && q[r]! < q[s]!) s = r;
        if (s === i) break;
        [c[i], c[s]] = [c[s]!, c[i]!];
        [q[i], q[s]] = [q[s]!, q[i]!];
        i = s;
      }
    }
    return top;
  }
}
