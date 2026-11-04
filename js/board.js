// Board geometry: 4 rows × 7 columns of pointy-top hexes. Odd rows are shifted half a hex to the right,
// like the in-game board. Positions are numbered 0–27, row by row.

export const ROWS = 4;
export const COLS = 7;
export const SIZE = ROWS * COLS;

export function neighbors(pos) {
  const r = Math.floor(pos / COLS);
  const c = pos % COLS;
  const out = [];
  if (c > 0) out.push(pos - 1);
  if (c < COLS - 1) out.push(pos + 1);
  const dcs = r % 2 === 0 ? [-1, 0] : [0, 1];
  for (const dr of [-1, 1]) {
    const rr = r + dr;
    if (rr < 0 || rr >= ROWS) continue;
    for (const dc of dcs) {
      const cc = c + dc;
      if (cc >= 0 && cc < COLS) out.push(rr * COLS + cc);
    }
  }
  return out;
}

export function firstFree(taken) {
  // fill from the back row (bottom) of the middle outward is a matter of taste; top-left first is predictable
  for (let p = 0; p < SIZE; p++) if (!taken.has(p)) return p;
  return -1;
}
