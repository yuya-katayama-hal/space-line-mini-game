import { describe, expect, it } from 'vitest';
import { ENGINES, add, dist, dot, len, norm, scale, sub } from '../physics/index.ts';
import type { PatchedConicEngine } from '../physics/index.ts';
import {
  DAYS_PER_YEAR, EARTH_BODY, EARTH_R, KMS, KM_PER_AU, MARS_BODY, MARS_R, SUN,
  burnFromOrbit, escapeFromOrbit, hohmann, planetAttractor, planetPos, planetVel, straightLineDv,
} from './solar.ts';

const engine = ENGINES.kepler({ attractors: [SUN] });
const earth = { name: 'Earth', r: EARTH_R, phase0: 0 };
const mars = { name: 'Mars', r: MARS_R, phase0: 0 };

describe('solar system', () => {
  it('Earth moves at about 29.8 km/s and goes round once a year', () => {
    expect(len(planetVel(earth, 0)) * KMS).toBeCloseTo(29.8, 1);
    expect(planetPos(earth, 1).x).toBeCloseTo(1, 9);
  });

  it('Hohmann transfer to Mars: ~2.9 + 2.6 km/s, ~259 days, Mars ~44° ahead at launch', () => {
    const h = hohmann(EARTH_R, MARS_R);
    expect(h.depart * KMS).toBeCloseTo(2.94, 1);
    expect(h.arrive * KMS).toBeCloseTo(2.65, 1);
    expect(h.time * DAYS_PER_YEAR).toBeCloseTo(259, -1);
    expect(h.lead * 180 / Math.PI).toBeCloseTo(44.3, 0);
  });

  it('flying a straight line in 3 months costs many times the Hohmann transfer', () => {
    const h = hohmann(EARTH_R, MARS_R);
    const m = { ...mars, phase0: h.lead };
    const straight = straightLineDv(engine, { pos: planetPos(earth, 0), vel: planetVel(earth, 0), t: 0 },
      { pos: planetPos(m, 0.25), vel: planetVel(m, 0.25) }, 0.25);
    expect(straight).toBeGreaterThan(5 * (h.depart + h.arrive));
  });

  it('burns from / into a 300 km orbit: ~3.6 km/s to leave Earth, ~2.1 km/s to be captured at Mars', () => {
    const h = hohmann(EARTH_R, MARS_R);
    expect(burnFromOrbit(EARTH_BODY, h.depart) * KMS).toBeCloseTo(3.6, 1);
    expect(burnFromOrbit(MARS_BODY, h.arrive) * KMS).toBeCloseTo(2.1, 1);
  });

  it('spheres of influence: Earth ~925,000 km, Mars ~577,000 km', () => {
    expect(planetAttractor(earth, EARTH_BODY).soi! * KM_PER_AU / 1000).toBeCloseTo(925, -1);
    expect(planetAttractor(mars, MARS_BODY).soi! * KM_PER_AU / 1000).toBeCloseTo(577, -1);
  });

  it('the escape hyperbola leaves Earth\'s sphere heading where it was aimed, at the right speed', () => {
    const pc = ENGINES.patchedConic({ attractors: [SUN, planetAttractor(earth, EARTH_BODY), planetAttractor(mars, MARS_BODY)] }) as PatchedConicEngine;
    const vInf = { x: 0.3, y: 0.5 };
    const rel = escapeFromOrbit(EARTH_BODY, vInf);
    const start = { t: 0, pos: add(planetPos(earth, 0), rel.pos), vel: add(planetVel(earth, 0), rel.vel) };
    const [inEarth] = pc.segments(start, 0.5);
    expect(inEarth.body).toBe(1);
    const out = pc.advance(start, inEarth.t1);
    const relOut = sub(out.vel, planetVel(earth, out.t));
    const soi = planetAttractor(earth, EARTH_BODY).soi!;
    expect(len(relOut)).toBeCloseTo(Math.sqrt(len(vInf) ** 2 + 2 * EARTH_BODY.mu / soi), 9);
    const turn = Math.acos(dot(relOut, vInf) / (len(relOut) * len(vInf)));
    expect(turn).toBeLessThan(0.05); // the sphere's edge is not yet fully on the asymptote
  });

  it('a Hohmann flight from low Earth orbit on the patched-conic engine reaches Mars', () => {
    const h = hohmann(EARTH_R, MARS_R);
    const m = { ...mars, phase0: h.lead };
    const pc = ENGINES.patchedConic({ attractors: [SUN, planetAttractor(earth, EARTH_BODY), planetAttractor(m, MARS_BODY)] });
    const rel = escapeFromOrbit(EARTH_BODY, scale(norm(planetVel(earth, 0)), h.depart));
    const start = { t: 0, pos: add(planetPos(earth, 0), rel.pos), vel: add(planetVel(earth, 0), rel.vel) };
    const end = pc.advance(start, h.time);
    expect(dist(end.pos, planetPos(m, h.time))).toBeLessThan(0.08); // the game's arrival zone
  });

  it('launching with the Hohmann burn at the right moment meets Mars', () => {
    const h = hohmann(EARTH_R, MARS_R);
    const m = { ...mars, phase0: h.lead };
    const v = planetVel(earth, 0);
    const start = { t: 0, pos: planetPos(earth, 0), vel: { x: v.x * (1 + h.depart / len(v)), y: v.y * (1 + h.depart / len(v)) } };
    const end = engine.advance(start, h.time);
    const gap = len({ x: end.pos.x - planetPos(m, h.time).x, y: end.pos.y - planetPos(m, h.time).y });
    expect(gap).toBeLessThan(1e-9);
  });
});
