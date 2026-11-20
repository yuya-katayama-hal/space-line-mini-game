import { describe, expect, it } from 'vitest';
import { BIN, KINDS, OBSTACLES, POUCH, SURFACES, binFootprint, binWalls, inPouch, initialStones, pouchWalls, souvenirSummary } from './layout.ts';
import { createStones, MOON_G } from './stones.ts';

describe('stall layout', () => {
  const specs = initialStones();
  const stones = createStones({ gravity: MOON_G, restitution: 0, surfaces: SURFACES, stones: specs }).stones();

  it('fills each bin with its own kind, inside the bin', () => {
    KINDS.forEach((k, i) => {
      const mine = stones.filter((s) => specs[s.id].kind === i);
      expect(mine).toHaveLength(k.count);
      const fp = binFootprint(i);
      for (const s of mine) {
        expect(s.pos.x).toBeGreaterThanOrEqual(fp.minX);
        expect(s.pos.x).toBeLessThanOrEqual(fp.maxX);
        expect(s.pos.z).toBeGreaterThanOrEqual(fp.minZ);
        expect(s.pos.z).toBeLessThanOrEqual(fp.maxZ);
      }
    });
  });

  it('no stone starts inside a bin wall', () => {
    const gap = (v: number, min: number, max: number) => Math.max(min - v, 0, v - max);
    for (const s of stones) {
      for (const w of OBSTACLES) {
        const d = Math.hypot(gap(s.pos.x, w.min.x, w.max.x), gap(s.pos.y, w.min.y, w.max.y), gap(s.pos.z, w.min.z, w.max.z));
        expect(d).toBeGreaterThanOrEqual(s.radius - 1e-9);
      }
    }
  });

  it('heaps stay low, like poured stones, not stacked towers', () => {
    for (const s of stones) expect(s.pos.y).toBeLessThan(BIN.floor + 4 * s.radius);
  });

  it('is the same for every visitor', () => {
    expect(initialStones()).toEqual(specs);
  });

  it('puts the pouch beside the last bin, at the same depth, so carrying there is a sideways move', () => {
    const last = binWalls(KINDS.length - 1), pouch = pouchWalls();
    const lastRight = Math.max(...last.map((w) => w.max.x)), pouchLeft = Math.min(...pouch.map((w) => w.min.x));
    expect(pouchLeft).toBeGreaterThan(lastRight);
    expect(POUCH.footprint.minZ).toBeLessThan(BIN.z);
    expect(POUCH.footprint.maxZ).toBeGreaterThan(BIN.z);
  });

  it('keeps the row of bins and the pouch centred', () => {
    const left = binFootprint(0).minX, right = POUCH.footprint.maxX;
    expect(left + right).toBeCloseTo(0, 9);
  });
});

describe('what counts as in the pouch', () => {
  const r = 0.04;
  const fp = POUCH.footprint;
  const mid = { x: (fp.minX + fp.maxX) / 2, z: (fp.minZ + fp.maxZ) / 2 };
  const stone = (x: number, y: number, z: number, status: 'resting' | 'falling' | 'held' = 'resting') =>
    ({ pos: { x, y, z }, radius: r, status });

  it('a stone resting on the pouch floor', () => {
    expect(inPouch(stone(mid.x, POUCH.floor + r, mid.z))).toBe(true);
  });
  it('not one resting on the rim, on top of a wall', () => {
    expect(inPouch(stone(fp.minX, POUCH.wall + r, mid.z))).toBe(false);
  });
  it('not one sitting above the rim on other stones', () => {
    expect(inPouch(stone(mid.x, POUCH.wall + r + 0.01, mid.z))).toBe(false);
  });
  it('one still falling or bouncing inside, below the rim', () => {
    expect(inPouch(stone(mid.x, POUCH.floor + r, mid.z, 'falling'))).toBe(true);
    expect(inPouch(stone(mid.x, POUCH.wall, mid.z, 'falling'))).toBe(true);
  });
  it('not one flying over the pouch above the rim, or held over it', () => {
    expect(inPouch(stone(mid.x, POUCH.wall + r + 0.05, mid.z, 'falling'))).toBe(false);
    expect(inPouch(stone(mid.x, POUCH.floor + r, mid.z, 'held'))).toBe(false);
  });
  it('not one resting outside the walls', () => {
    expect(inPouch(stone(fp.maxX + 2 * r, r, mid.z))).toBe(false);
  });
});

describe('the souvenir summary', () => {
  const [highland, basalt, , breccia] = [0, 1, 2, 3];

  it('groups stones of the same kind, in bin order, with counts above one', () => {
    expect(souvenirSummary([breccia, basalt, basalt, breccia, highland, basalt])).toEqual({
      ja: `${KINDS[highland].name}、${KINDS[basalt].name} ×3、${KINDS[breccia].name} ×2`,
      en: `${KINDS[highland].nameEn}, ${KINDS[basalt].nameEn} ×3, ${KINDS[breccia].nameEn} ×2`,
      count: 6,
    });
  });

  it('is empty when nothing was taken', () => {
    expect(souvenirSummary([])).toEqual({ ja: '', en: '', count: 0 });
  });
});
