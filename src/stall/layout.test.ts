import { describe, expect, it } from 'vitest';
import { BIN, KINDS, SURFACES, binFootprint, initialStones } from './layout.ts';
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

  it('heaps stay low, like poured stones, not stacked towers', () => {
    for (const s of stones) expect(s.pos.y).toBeLessThan(BIN.floor + 4 * s.radius);
  });

  it('is the same for every visitor', () => {
    expect(initialStones()).toEqual(specs);
  });
});
