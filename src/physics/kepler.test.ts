// References are independent of the engine: the classical Kepler equations (elliptic, hyperbolic, Barker's for
// the parabola) solved by plain bisection.
import { describe, expect, it } from 'vitest';
import { createKeplerEngine, keplerPropagate, stumpff, UnsupportedSetup } from './kepler.ts';
import { dist, len, vec } from './vec.ts';
import type { Vec2 } from './vec.ts';

const MU = 4 * Math.PI ** 2;

function bisect(f: (x: number) => number, lo: number, hi: number): number {
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// each starts at periapsis on +x, moving in +y
const orbits: { name: string; r0: Vec2; v0: Vec2; at: (t: number) => Vec2 }[] = [
  (() => {
    const q = 1, e = 0.6, a = q / (1 - e), n = Math.sqrt(MU / a ** 3);
    return {
      name: 'ellipse (e = 0.6)', r0: vec(q, 0), v0: vec(0, Math.sqrt(MU * (1 + e) / q)),
      at: (t: number) => {
        const M = n * t, Mr = M - 2 * Math.PI * Math.floor(M / (2 * Math.PI));
        const E = bisect((E) => E - e * Math.sin(E) - Mr, 0, 2 * Math.PI);
        return vec(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E));
      },
    };
  })(),
  (() => {
    const q = 1, e = 1.5, A = q / (e - 1), n = Math.sqrt(MU / A ** 3);
    return {
      name: 'hyperbola (e = 1.5)', r0: vec(q, 0), v0: vec(0, Math.sqrt(MU * (1 + e) / q)),
      at: (t: number) => {
        const F = bisect((F) => e * Math.sinh(F) - F - n * t, -50, 50);
        return vec(A * (e - Math.cosh(F)), A * Math.sqrt(e * e - 1) * Math.sinh(F));
      },
    };
  })(),
  (() => {
    const q = 1, p = 2 * q;
    return {
      name: 'parabola (e = 1)', r0: vec(q, 0), v0: vec(0, Math.sqrt(2 * MU / q)),
      at: (t: number) => {
        const D = bisect((D) => 0.5 * Math.sqrt(p ** 3 / MU) * (D + D ** 3 / 3) - t, -1e3, 1e3);
        return vec(q * (1 - D * D), 2 * q * D);
      },
    };
  })(),
];

describe.each(orbits)('$name', ({ r0, v0, at }) => {
  it.each([0.01, 0.3, 1, 2.7, 10])('matches the textbook position after %f yr', (t) => {
    const { pos } = keplerPropagate(MU, r0, v0, t);
    expect(dist(pos, at(t)) / Math.max(1, len(at(t)))).toBeLessThan(1e-10);
  });

  it('runs backwards as exactly as forwards', () => {
    const { pos } = keplerPropagate(MU, r0, v0, -1.3);
    expect(dist(pos, at(-1.3)) / Math.max(1, len(pos))).toBeLessThan(1e-10);
  });

  it('keeps energy and angular momentum to machine precision', () => {
    const energy = (r: Vec2, v: Vec2) => (v.x ** 2 + v.y ** 2) / 2 - MU / len(r);
    const h = (r: Vec2, v: Vec2) => r.x * v.y - r.y * v.x;
    for (const t of [0.123, 4.56, 78.9]) {
      const s = keplerPropagate(MU, r0, v0, t);
      expect(Math.abs(energy(s.pos, s.vel) - energy(r0, v0))).toBeLessThan(1e-9 * Math.max(1, Math.abs(energy(r0, v0))));
      expect(Math.abs(h(s.pos, s.vel) - h(r0, v0)) / h(r0, v0)).toBeLessThan(1e-11);
    }
  });

  it('one long jump equals two short ones', () => {
    const a = keplerPropagate(MU, r0, v0, 0.7);
    const b = keplerPropagate(MU, a.pos, a.vel, 1.9);
    const c = keplerPropagate(MU, r0, v0, 2.6);
    expect(dist(b.pos, c.pos) / Math.max(1, len(c.pos))).toBeLessThan(1e-11);
  });
});

describe('kepler engine', () => {
  const engine = createKeplerEngine({ attractors: [{ mu: MU, position: () => vec(0, 0) }] });
  const circular = { t: 0, pos: vec(1, 0), vel: vec(0, 2 * Math.PI) };

  it('a circular orbit is back at its start after a million years', () => {
    const s = engine.advance(circular, 1e6);
    expect(dist(s.pos, circular.pos)).toBeLessThan(1e-8);
  });

  it('works around an attractor that is not at the origin', () => {
    const off = createKeplerEngine({ attractors: [{ mu: MU, position: () => vec(5, -3) }] });
    const s = off.advance({ t: 0, pos: vec(6, -3), vel: vec(0, 2 * Math.PI) }, 0.25);
    expect(dist(s.pos, vec(5, -2))).toBeLessThan(1e-12);
  });

  it('refuses what it cannot solve exactly', () => {
    const fixed = { mu: MU, position: () => vec(0, 0) };
    expect(() => createKeplerEngine({ attractors: [fixed, fixed] })).toThrow(UnsupportedSetup);
    expect(() => createKeplerEngine({ attractors: [] })).toThrow(UnsupportedSetup);
    expect(() => createKeplerEngine({ attractors: [{ mu: MU, position: (t) => vec(t, 0) }] })).toThrow(UnsupportedSetup);
  });

  it('Stumpff functions join smoothly where the series takes over', () => {
    for (const z of [0.01, -0.01]) {
      const inside = stumpff(z * (1 - 1e-9)), outside = stumpff(z * (1 + 1e-9));
      expect(Math.abs(inside.c - outside.c)).toBeLessThan(1e-12);
      expect(Math.abs(inside.s - outside.s)).toBeLessThan(1e-12);
    }
    expect(stumpff(0)).toEqual({ c: 0.5, s: 1 / 6 });
  });
});
