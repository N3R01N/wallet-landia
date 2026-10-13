/**
 * How a hero walks round the furniture in a house's room: a path on a fine
 * grid over the floor (A* search), round the solid things (their footprints,
 * grown by the hero's own width). Pure: metres in, metres out.
 */

export interface Footprint {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Point {
  x: number;
  z: number;
}

const CELL = 0.1;
/** Half a hero's width: the path keeps this far from the furniture. */
const CLEARANCE = 0.25;

/** The shortest walk from `from` to `to` that keeps out of `solids` and inside `floor`, as points to walk through. */
export function walkPath(from: Point, to: Point, solids: readonly Footprint[], floor: Footprint): Point[] {
  const cols = Math.round((floor.x1 - floor.x0) / CELL);
  const rows = Math.round((floor.z1 - floor.z0) / CELL);
  const at = (cx: number, cz: number): Point => ({ x: floor.x0 + (cx + 0.5) * CELL, z: floor.z0 + (cz + 0.5) * CELL });
  const cellOf = (p: Point): { cx: number; cz: number } => ({
    cx: Math.min(cols - 1, Math.max(0, Math.floor((p.x - floor.x0) / CELL))),
    cz: Math.min(rows - 1, Math.max(0, Math.floor((p.z - floor.z0) / CELL))),
  });
  const blockedCell = (cx: number, cz: number): boolean => {
    const p = at(cx, cz);
    return solids.some((s) => p.x > s.x0 - CLEARANCE && p.x < s.x1 + CLEARANCE && p.z > s.z0 - CLEARANCE && p.z < s.z1 + CLEARANCE);
  };
  const free = (cx: number, cz: number): boolean => cx >= 0 && cz >= 0 && cx < cols && cz < rows && !blockedCell(cx, cz);

  let start = cellOf(from);
  let goal = cellOf(to);
  // a spot inside furniture (or the wall) is walked to from the nearest free cell beside it
  const nearest = (c: { cx: number; cz: number }): { cx: number; cz: number } => {
    if (free(c.cx, c.cz)) return c;
    for (let r = 1; r < 40; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(c.cx + dx, c.cz + dz)) return { cx: c.cx + dx, cz: c.cz + dz };
        }
      }
    }
    return c;
  };
  start = nearest(start);
  goal = nearest(goal);
  if (start.cx === goal.cx && start.cz === goal.cz) return [to];

  // A*: 8 directions, straight steps cost 1, diagonals √2
  const key = (cx: number, cz: number): number => cz * cols + cx;
  const h = (cx: number, cz: number): number => Math.hypot(cx - goal.cx, cz - goal.cz);
  const g = new Map<number, number>([[key(start.cx, start.cz), 0]]);
  const came = new Map<number, number>();
  const open: { k: number; f: number }[] = [{ k: key(start.cx, start.cz), f: h(start.cx, start.cz) }];
  const closed = new Set<number>();
  const goalKey = key(goal.cx, goal.cz);
  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!.k;
    if (cur === goalKey) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    const cx = cur % cols;
    const cz = Math.floor(cur / cols);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!free(nx, nz)) continue;
        const nk = key(nx, nz);
        if (closed.has(nk)) continue;
        const ng = (g.get(cur) ?? 0) + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, cur);
          open.push({ k: nk, f: ng + h(nx, nz) });
        }
      }
    }
  }
  if (!came.has(goalKey)) return [to]; // no way round: stand where they can

  const cells: Point[] = [];
  for (let k: number | undefined = goalKey; k !== undefined; k = came.get(k)) cells.push(at(k % cols, Math.floor(k / cols)));
  cells.reverse();
  // the way they walk: only where it turns
  const path: Point[] = [];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    const c = cells[i + 1]!;
    if ((b.x - a.x) * (c.z - b.z) !== (b.z - a.z) * (c.x - b.x)) path.push(b);
  }
  path.push(to);
  return path;
}
