// Patched conics, the standard first approximation for interplanetary flight. The general three-body problem
// has no closed-form solution, so the flight is split at the planets' spheres of influence (SOI) and each piece
// is an exact two-body conic (keplerPropagate): around a planet inside its SOI (its frame treated as inertial),
// around the central body elsewhere. No time steps; the only approximation is feeling one body at a time.
//
// SOI crossings are exact as well:
//   leaving   from the planet-centred conic's anomaly at the SOI radius, polished with Newton
//   entering  conservative advancement: each jump is the largest one the bound on the relative motion proves
//             can't pass the boundary, so no entry is skipped; a safeguarded Newton + bisection finishes it
import type { Attractor, EngineFactory, PhysicsEngine, State } from './engine.ts';
import { fixedCentre, keplerPropagate, UnsupportedSetup } from './kepler.ts';
import { add, dist, dot, len, scale, sub, ZERO } from './vec.ts';
import type { Vec2 } from './vec.ts';

interface Body {
  readonly mu: number;
  readonly soi: number;
  readonly maxAccel: number;
  position(t: number): Vec2;
  velocity(t: number): Vec2;
}

/** One conic of the flight. pos/vel are relative to `body` at t0. */
export interface Segment {
  readonly t0: number;
  t1: number;
  readonly body: number | null; // index into the attractors, null for the central body
  readonly pos: Vec2;
  readonly vel: Vec2;
}

export interface PatchedConicEngine extends PhysicsEngine {
  segments(s: State, duration: number): Segment[];
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;

function periapsis(mu: number, r: Vec2, v: Vec2): number {
  const p = cross(r, v) ** 2 / mu;
  const alpha = 2 / len(r) - dot(v, v) / mu;
  const e = Math.sqrt(Math.max(0, 1 - p * alpha));
  return p / (1 + e);
}

/** Time until the orbit first reaches distance R moving outward; null if it never does (captured). */
export function exitTime(mu: number, r0v: Vec2, v0v: Vec2, R: number): number | null {
  const r0 = len(r0v);
  const outward = dot(r0v, v0v) >= 0;
  if (r0 >= R && outward) return 0;
  const alpha = 2 / r0 - dot(v0v, v0v) / mu;
  const p = cross(r0v, v0v) ** 2 / mu;
  const e = Math.sqrt(Math.max(0, 1 - p * alpha));
  if (alpha > 0 && (1 + e) / alpha < R) return null; // apoapsis inside R

  let tau: number;
  if (p > 1e-12 * r0 && e > 1e-12) {
    const sinceP = (nu: number): number => {
      if (e < 1 - 1e-8) {
        const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
        return (E - e * Math.sin(E)) / Math.sqrt(mu * alpha ** 3);
      }
      if (e > 1 + 1e-8) {
        const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
        return (e * Math.sinh(F) - F) / Math.sqrt(mu * (-alpha) ** 3);
      }
      const D = Math.tan(nu / 2); // parabola: Barker's equation
      return 0.5 * Math.sqrt(p ** 3 / mu) * (D + D ** 3 / 3);
    };
    const clamp = (c: number) => Math.min(1, Math.max(-1, c));
    const nu0 = (outward ? 1 : -1) * Math.acos(clamp((p / r0 - 1) / e));
    const nuR = Math.acos(clamp((p / R - 1) / e));
    tau = sinceP(nuR) - sinceP(nu0);
    if (alpha > 0 && tau < 0) tau += 2 * Math.PI / Math.sqrt(mu * alpha ** 3);
  } else {
    // radial or near-circular: the anomaly is undefined, so bracket and bisect on the exact radius
    let hi = 1e-6;
    while (len(keplerPropagate(mu, r0v, v0v, hi).pos) < R && hi < 1e12) hi *= 2;
    let lo = 0;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (len(keplerPropagate(mu, r0v, v0v, m).pos) < R) lo = m; else hi = m; }
    tau = hi;
  }
  // the anomaly formulas lose precision near e = 1; Newton on |r(tau)| - R against the exact solution fixes it
  for (let i = 0; i < 4; i++) {
    const s = keplerPropagate(mu, r0v, v0v, tau);
    const r = len(s.pos), rdot = dot(s.pos, s.vel) / r;
    if (!(rdot > 0)) break;
    const step = (r - R) / rdot;
    tau -= step;
    if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(tau))) break;
  }
  return Math.max(0, tau);
}

export function createPatchedConicEngine({ attractors }: { attractors: readonly Attractor[] }): PatchedConicEngine {
  const central = attractors.filter((a) => a.soi === undefined);
  if (central.length !== 1) throw new UnsupportedSetup(`patched conics need exactly one central body (no soi), got ${central.length}`);
  const sun = central[0];
  const centre = fixedCentre(sun, 'patched-conic');
  const bodies = new Map<number, Body>();
  attractors.forEach((a, i) => {
    if (a.soi === undefined) return;
    if (!(a.soi > 0) || !a.velocity || a.maxAccel === undefined) {
      throw new UnsupportedSetup('each body with a sphere of influence needs soi > 0, velocity() and maxAccel');
    }
    bodies.set(i, { mu: a.mu, soi: a.soi, maxAccel: a.maxAccel, position: (t) => a.position(t), velocity: (t) => a.velocity!(t) });
  });

  const frame = (b: number | null, t: number) => {
    const body = b === null ? null : bodies.get(b)!;
    return body ? { pos: body.position(t), vel: body.velocity(t), mu: body.mu } : { pos: centre, vel: ZERO, mu: sun.mu };
  };

  function at(seg: Segment, t: number): State {
    const f = frame(seg.body, t);
    const r = keplerPropagate(f.mu, seg.pos, seg.vel, t - seg.t0);
    return { t, pos: add(f.pos, r.pos), vel: add(f.vel, r.vel) };
  }

  function start(s: State, body: number | null): Segment {
    const f = frame(body, s.t);
    return { t0: s.t, t1: s.t, body, pos: sub(s.pos, f.pos), vel: sub(s.vel, f.vel) };
  }

  function bodyAt(s: State): number | null {
    for (const [i, b] of bodies) if (dist(s.pos, b.position(s.t)) < b.soi) return i;
    return null;
  }

  function entry(seg: Segment, b: Body, limit: number): number | null {
    const eps = b.soi * 1e-10;
    // bound on |d/dt relative velocity|: the central pull at the conic's periapsis + the planet's acceleration
    const rp = Math.max(periapsis(sun.mu, seg.pos, seg.vel), 1e-9 * len(seg.pos));
    const A = sun.mu / (rp * rp) + b.maxAccel;
    const probe = (t: number) => {
      const s = at(seg, t);
      const d = sub(s.pos, b.position(t));
      const v = sub(s.vel, b.velocity(t));
      const dl = len(d);
      return { g: dl - b.soi, speed: len(v), rate: dot(d, v) / dl };
    };
    let t = seg.t0;
    for (let i = 0; i < 10000; i++) {
      const { g, speed, rate } = probe(t);
      if (g <= eps) {
        if (rate <= 0) return t;
        t += 10 * eps / Math.max(speed, 1e-300); // just exited this sphere: not an entry
      } else {
        // converging gets slow near the boundary; a Newton jump that lands inside brackets the entry
        if (rate < 0 && g < b.soi * 1e-3) {
          const tn = t + g / -rate;
          if (tn <= limit && probe(tn).g <= 0) {
            let lo = t, hi = tn;
            for (let k = 0; k < 100 && hi - lo > 1e-15 * Math.max(1, Math.abs(hi)); k++) {
              const m = (lo + hi) / 2;
              if (probe(m).g <= 0) hi = m; else lo = m;
            }
            return hi;
          }
        }
        // the largest delta with speed*delta + A*delta^2/2 <= g, so the boundary can't be passed
        t += 2 * g / (speed + Math.sqrt(speed * speed + 2 * A * g));
      }
      if (t > limit) return null;
    }
    return t; // only an extremely shallow graze gets here; accept the approximation
  }

  function segments(s: State, duration: number): Segment[] {
    const end = s.t + duration;
    const out: Segment[] = [];
    let seg = start(s, bodyAt(s));
    for (let n = 0; n < 64; n++) {
      let next: { t: number; body: number | null } | null = null;
      if (seg.body !== null) {
        const b = bodies.get(seg.body)!;
        const tau = exitTime(b.mu, seg.pos, seg.vel, b.soi);
        if (tau !== null && seg.t0 + tau <= end) next = { t: seg.t0 + tau, body: null };
      } else {
        for (const [i, b] of bodies) {
          const t = entry(seg, b, next ? next.t : end);
          if (t !== null && (!next || t < next.t)) next = { t, body: i };
        }
      }
      if (!next) break;
      seg.t1 = next.t;
      out.push(seg);
      seg = start(at(seg, next.t), next.body);
    }
    seg.t1 = end;
    out.push(seg);
    return out;
  }

  function evaluate(segs: Segment[], t: number): State {
    const seg = segs.find((g) => t <= g.t1) ?? segs[segs.length - 1];
    return at(seg, t);
  }

  function accelerationAt(p: Vec2, t: number): Vec2 {
    const b = bodyAt({ t, pos: p, vel: ZERO });
    const f = frame(b, t);
    const d = sub(p, f.pos);
    const r = len(d);
    return scale(d, -f.mu / (r * r * r));
  }

  function advance(s: State, dt: number): State {
    if (!(dt > 0)) return s;
    return evaluate(segments(s, dt), s.t + dt);
  }

  function trajectory(s: State, duration: number, samples: number): State[] {
    const segs = segments(s, duration);
    const out = [s];
    for (let i = 1; i <= samples; i++) out.push(evaluate(segs, s.t + duration * i / samples));
    return out;
  }

  return { name: 'patched-conic', accelerationAt, advance, trajectory, segments };
}

export const patchedConicFactory: EngineFactory = (opts) => createPatchedConicEngine(opts);
