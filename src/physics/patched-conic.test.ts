import { describe, expect, it } from 'vitest';
import { createPatchedConicEngine, exitTime } from './patched-conic.ts';
import { keplerPropagate, UnsupportedSetup } from './kepler.ts';
import { dist, dot, len, vec } from './vec.ts';
import type { Attractor } from './engine.ts';
import type { Vec2 } from './vec.ts';

const angle = (a: Vec2, b: Vec2) => Math.acos(Math.min(1, dot(a, b) / (len(a) * len(b))));
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

describe('exitTime', () => {
  it.each([
    ['hyperbola, outbound', vec(1, 0), vec(0.3, 1.8)],
    ['hyperbola, inbound first', vec(1, 0), vec(-0.5, 1.6)],
    ['ellipse reaching R', vec(1, 0), vec(-0.2, 1.25)],
    ['near-parabola', vec(1, 0), vec(0, Math.SQRT2 * (1 + 1e-10))],
  ])('%s: reaches R exactly, moving out, and not before', (_, r0, v0) => {
    const R = 2.5;
    const tau = exitTime(1, r0, v0, R)!;
    const s = keplerPropagate(1, r0, v0, tau);
    expect(Math.abs(len(s.pos) - R)).toBeLessThan(1e-12);
    expect(dot(s.pos, s.vel)).toBeGreaterThan(0);
    for (let i = 1; i < 200; i++) expect(len(keplerPropagate(1, r0, v0, tau * i / 200).pos)).toBeLessThan(R);
  });

  it('an ellipse that stays inside never exits', () => {
    expect(exitTime(1, vec(1, 0), vec(0, 1.1), 2.5)).toBeNull();
  });
});

// a nearly massless central body keeps paths between spheres straight, and a planet standing still lets the
// flyby be compared with the two-body formulas
const still = (p: Vec2, mu: number, soi: number): Attractor => ({ mu, soi, maxAccel: 0, position: () => p, velocity: () => vec(0, 0) });
const faintSun: Attractor = { mu: 1e-12, position: () => vec(0, 0) };

describe('patched-conic engine', () => {
  it('a flyby: same speed in and out, angular momentum kept, bent by the conic geometry', () => {
    const planet = vec(100, 0), mu = 1, R = 10;
    const engine = createPatchedConicEngine({ attractors: [faintSun, still(planet, mu, R)] });
    const s0 = { t: 0, pos: vec(80, 1.5), vel: vec(1, 0) };
    const segs = engine.segments(s0, 60);
    expect(segs.map((g) => g.body)).toEqual([null, 1, null]);

    const inSoi = segs[1];
    const exit = keplerPropagate(mu, inSoi.pos, inSoi.vel, inSoi.t1 - inSoi.t0);
    expect(len(inSoi.pos)).toBeCloseTo(R, 9);
    expect(len(exit.pos)).toBeCloseTo(R, 9);
    expect(len(exit.vel) / len(inSoi.vel)).toBeCloseTo(1, 12);
    expect(cross(exit.pos, exit.vel) / cross(inSoi.pos, inSoi.vel)).toBeCloseTo(1, 12);

    // between its two crossings of radius R a conic turns its velocity by 2 (nu_R - gamma_R)
    const h = cross(inSoi.pos, inSoi.vel), p = h * h / mu;
    const e = Math.sqrt(1 - p * (2 / R - dot(inSoi.vel, inSoi.vel) / mu));
    const nuR = Math.acos((p / R - 1) / e);
    const gamma = Math.atan(e * Math.sin(nuR) / (1 + e * Math.cos(nuR)));
    expect(angle(inSoi.vel, exit.vel)).toBeCloseTo(2 * (nuR - gamma), 10);
  });

  it('catches a graze that dips just inside the sphere, and ignores one that stays just outside', () => {
    const engine = createPatchedConicEngine({ attractors: [faintSun, still(vec(100, 0), 1e-9, 10)] });
    const inside = engine.segments({ t: 0, pos: vec(80, 9.99), vel: vec(1, 0) }, 40);
    const outside = engine.segments({ t: 0, pos: vec(80, 10.01), vel: vec(1, 0) }, 40);
    expect(inside.map((g) => g.body)).toEqual([null, 1, null]);
    expect(outside.map((g) => g.body)).toEqual([null]);
  });

  it('escape from a parking orbit: leaves the sphere with the speed energy conservation says', () => {
    const mu = 3, R = 5, rp = 0.1, vInf = 0.7;
    const engine = createPatchedConicEngine({ attractors: [faintSun, still(vec(50, 0), mu, R)] });
    const vp = Math.sqrt(vInf ** 2 + 2 * mu / rp);
    const s0 = { t: 0, pos: vec(50 + rp, 0), vel: vec(0, vp) };
    const [inside, outside] = engine.segments(s0, 50);
    expect(inside.body).toBe(1);
    expect(outside.body).toBeNull();
    const out = engine.advance(s0, inside.t1);
    expect(dist(out.pos, vec(50, 0))).toBeCloseTo(R, 9);
    expect(len(out.vel)).toBeCloseTo(Math.sqrt(vInf ** 2 + 2 * mu / R), 12);
  });

  it('a captured ship stays with its planet', () => {
    const engine = createPatchedConicEngine({ attractors: [faintSun, still(vec(50, 0), 1, 5)] });
    const segs = engine.segments({ t: 0, pos: vec(51, 0), vel: vec(0, 1.1) }, 1000);
    expect(segs.map((g) => g.body)).toEqual([1]);
  });

  it('cutting a flight anywhere gives the same result (across a flyby)', () => {
    const engine = createPatchedConicEngine({ attractors: [faintSun, still(vec(100, 0), 1, 10)] });
    const s0 = { t: 0, pos: vec(80, 1.5), vel: vec(1, 0) };
    const whole = engine.advance(s0, 40);
    for (const cut of [5, 15.3, 21, 33]) {
      const two = engine.advance(engine.advance(s0, cut), 40 - cut);
      expect(dist(two.pos, whole.pos)).toBeLessThan(1e-9);
    }
  });

  it('works with planets moving on circular orbits around a real Sun', () => {
    const GM = 4 * Math.PI ** 2, r = 1.5, w = Math.sqrt(GM / r ** 3);
    const planet: Attractor = {
      mu: 1e-5, soi: 0.01, maxAccel: r * w * w,
      position: (t) => vec(r * Math.cos(w * t), r * Math.sin(w * t)),
      velocity: (t) => vec(-r * w * Math.sin(w * t), r * w * Math.cos(w * t)),
    };
    const engine = createPatchedConicEngine({ attractors: [{ mu: GM, position: () => vec(0, 0) }, planet] });
    const s0 = { t: 0, pos: vec(r + 0.02, 0), vel: vec(-0.5, r * w) };
    const segs = engine.segments(s0, 0.2);
    expect(segs[0].body).toBeNull();
    expect(segs[1].body).toBe(1);
    const enter = engine.advance(s0, segs[0].t1);
    expect(dist(enter.pos, planet.position(enter.t))).toBeCloseTo(0.01, 10);
  });

  it('refuses setups it cannot solve', () => {
    const sun = { mu: 1, position: () => vec(0, 0) };
    expect(() => createPatchedConicEngine({ attractors: [sun, sun] })).toThrow(UnsupportedSetup);
    expect(() => createPatchedConicEngine({ attractors: [{ mu: 1, position: (t) => vec(t, 0) }] })).toThrow(UnsupportedSetup);
    expect(() => createPatchedConicEngine({ attractors: [sun, { mu: 1, soi: 1, position: () => vec(5, 0) }] })).toThrow(UnsupportedSetup);
  });
});

