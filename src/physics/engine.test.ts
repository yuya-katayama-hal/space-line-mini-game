// Runs once per registered engine.
import { describe, expect, it } from 'vitest';
import { ENGINES, UnsupportedSetup, len, sub, vec } from './index.ts';
import type { Attractor, State } from './index.ts';

const GM = 4 * Math.PI ** 2; // AU^3/yr^2: a circular orbit at 1 AU takes 1 year
const sun: Attractor = { mu: GM, position: () => vec(0, 0) };
const circular: State = { t: 0, pos: vec(1, 0), vel: vec(0, 2 * Math.PI) };
const energy = (s: State) => len(s.vel) ** 2 / 2 - GM / len(s.pos);

describe.each(Object.entries(ENGINES))('engine "%s"', (_, create) => {
  const engine = create({ attractors: [sun], maxStep: 0.0005 });

  it('pulls toward the attractor with G·M / r²', () => {
    const a = engine.accelerationAt(vec(2, 0), 0);
    expect(a.x).toBeCloseTo(-GM / 4, 3);
    expect(a.y).toBeCloseTo(0, 9);
  });

  it('a circular orbit comes back to its start after one period, ten times over', () => {
    let s = circular;
    for (let i = 0; i < 10; i++) s = engine.advance(s, 1);
    expect(s.t).toBeCloseTo(10, 9);
    expect(len(sub(s.pos, circular.pos))).toBeLessThan(0.01);
    expect(Math.abs(len(s.pos) - 1)).toBeLessThan(1e-4);
  });

  it('keeps the energy of an eccentric orbit', () => {
    const s0: State = { t: 0, pos: vec(1, 0), vel: vec(0, 8) };
    const after = engine.advance(s0, 5);
    expect(Math.abs(energy(after) - energy(s0)) / Math.abs(energy(s0))).toBeLessThan(1e-3);
  });

  it('a Hohmann burn from 1 AU reaches 1.524 AU half an orbit later', () => {
    const a = (1 + 1.524) / 2;
    const vp = Math.sqrt(GM * (2 / 1 - 1 / a));
    const half = Math.PI * Math.sqrt(a ** 3 / GM);
    const s = engine.advance({ t: 0, pos: vec(1, 0), vel: vec(0, vp) }, half);
    expect(len(s.pos)).toBeCloseTo(1.524, 3);
    expect(s.pos.x).toBeCloseTo(-1.524, 2); // on the far side of the Sun
  });

  it('treats states as values and splits long steps', () => {
    const before = JSON.stringify(circular);
    const one = engine.advance(circular, 0.3);
    const many = [0.1, 0.1, 0.1].reduce((s, dt) => engine.advance(s, dt), circular);
    expect(JSON.stringify(circular)).toBe(before);
    expect(len(sub(one.pos, many.pos))).toBeLessThan(1e-6);
    expect(engine.advance(circular, 0)).toBe(circular);
  });

  it('trajectory returns samples + 1 states, evenly spaced', () => {
    const states = engine.trajectory(circular, 0.5, 10);
    expect(states).toHaveLength(11);
    expect(states[0]).toBe(circular);
    expect(states[10].t).toBeCloseTo(0.5, 9);
  });

  it('follows an attractor that moves, or refuses it up front', () => {
    const moving: Attractor = { mu: GM, position: (t) => vec(t, 0) };
    let e;
    try { e = create({ attractors: [moving], maxStep: 0.001 }); } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedSetup);
      return;
    }
    expect(e.accelerationAt(vec(3, 0), 2).x).toBeCloseTo(-GM, 3); // attractor at x = 2 by then
  });
});
