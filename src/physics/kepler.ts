// Exact two-body propagation in universal variables: no time steps, so no error that grows with time, and one
// set of formulas for ellipses, parabolas and hyperbolas. Kepler's equation itself has no closed form; its root
// (the universal anomaly chi) is found to machine precision with Laguerre-Conway, which converges where Newton
// can fail on hyperbolic orbits. Only one fixed attractor has such a solution, so the factory refuses others.
// See Vallado, "Fundamentals of Astrodynamics and Applications", sec. 2.3; Curtis, "Orbital Mechanics for
// Engineering Students", sec. 3.7; Conway (1986), "An improved algorithm due to Laguerre for the solution of
// Kepler's equation".
import type { Attractor, EngineFactory, State } from './engine.ts';
import { add, dot, len, scale, sub } from './vec.ts';
import type { Vec2 } from './vec.ts';

/** Stumpff functions C(z) = (1 - cos(sqrt z))/z and S(z) = (sqrt z - sin(sqrt z))/z^1.5, for any sign of z */
export function stumpff(z: number): { c: number; s: number } {
  if (Math.abs(z) < 1e-2) {
    // the closed forms lose precision to cancellation near 0
    return {
      c: 1 / 2 - z / 24 + z * z / 720 - z ** 3 / 40320 + z ** 4 / 3628800,
      s: 1 / 6 - z / 120 + z * z / 5040 - z ** 3 / 362880 + z ** 4 / 39916800,
    };
  }
  if (z > 0) {
    const q = Math.sqrt(z);
    return { c: (1 - Math.cos(q)) / z, s: (q - Math.sin(q)) / (q * z) };
  }
  const q = Math.sqrt(-z);
  return { c: (Math.cosh(q) - 1) / -z, s: (Math.sinh(q) - q) / (q * -z) };
}

export class UnsupportedSetup extends Error {}

// a moving centre has no closed-form solution
export function fixedCentre(a: Attractor, engine: string): Vec2 {
  const centre = a.position(0);
  for (const t of [-1e3, -1, 1, 1e3]) {
    const p = a.position(t);
    if (p.x !== centre.x || p.y !== centre.y) throw new UnsupportedSetup(`the ${engine} engine needs a central attractor that stays put`);
  }
  return centre;
}

/** r0v, v0v relative to the centre; dt of any sign */
export function keplerPropagate(mu: number, r0v: Vec2, v0v: Vec2, dt: number): { pos: Vec2; vel: Vec2 } {
  if (dt === 0) return { pos: r0v, vel: v0v };
  const sqmu = Math.sqrt(mu);
  const r0 = len(r0v);
  const v2 = dot(v0v, v0v);
  const rv = dot(r0v, v0v) / sqmu;
  const alpha = 2 / r0 - v2 / mu; // 1/a: > 0 ellipse, 0 parabola, < 0 hyperbola

  // an ellipse repeats, so reduce dt by whole periods: keeps chi small and the solve well conditioned
  let t = dt;
  if (alpha > 1e-12) {
    const period = 2 * Math.PI / Math.sqrt(mu * alpha ** 3);
    t = dt - period * Math.trunc(dt / period);
  }

  // starting guess: Vallado, algorithm 8
  let x: number;
  if (alpha > 1e-12) x = sqmu * t * alpha;
  else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const sgn = Math.sign(t);
    x = sgn * Math.sqrt(-a) * Math.log((-2 * mu * alpha * t) / (dot(r0v, v0v) + sgn * Math.sqrt(-mu * a) * (1 - r0 * alpha)));
    if (!Number.isFinite(x)) x = sqmu * t / r0;
  } else x = sqmu * t / r0;

  // F(chi) = rv chi^2 C + (1 - alpha r0) chi^3 S + r0 chi - sqrt(mu) t = 0, with first and second derivatives
  const F = (x: number) => {
    const z = alpha * x * x;
    const { c, s } = stumpff(z);
    const f = rv * x * x * c + (1 - alpha * r0) * x ** 3 * s + r0 * x - sqmu * t;
    const f1 = rv * x * (1 - z * s) + (1 - alpha * r0) * x * x * c + r0;
    const f2 = rv * (1 - z * c) + (1 - alpha * r0) * x * (1 - z * s);
    return { f, f1, f2 };
  };
  const n = 5; // Laguerre-Conway order
  for (let i = 0; i < 60; i++) {
    const { f, f1, f2 } = F(x);
    const root = Math.sqrt(Math.abs((n - 1) ** 2 * f1 * f1 - n * (n - 1) * f * f2));
    const den = f1 + Math.sign(f1) * root;
    const dx = n * f / (den === 0 ? f1 : den);
    x -= dx;
    if (Math.abs(dx) <= 1e-15 * Math.max(1, Math.abs(x))) break;
  }

  // Lagrange coefficients
  const z = alpha * x * x;
  const { c, s } = stumpff(z);
  const f = 1 - (x * x / r0) * c;
  const g = t - (x ** 3 / sqmu) * s;
  const pos = add(scale(r0v, f), scale(v0v, g));
  const r = len(pos);
  const fdot = (sqmu / (r * r0)) * (alpha * x ** 3 * s - x);
  const gdot = 1 - (x * x / r) * c;
  return { pos, vel: add(scale(r0v, fdot), scale(v0v, gdot)) };
}

export const createKeplerEngine: EngineFactory = ({ attractors }) => {
  if (attractors.length !== 1) throw new UnsupportedSetup(`the Kepler engine solves exactly one attractor, got ${attractors.length}`);
  const [a] = attractors;
  const centre = fixedCentre(a, 'Kepler');
  const mu = a.mu;

  function accelerationAt(p: Vec2): Vec2 {
    const d = sub(p, centre);
    const r = len(d);
    return scale(d, -mu / (r * r * r));
  }

  function advance(s: State, dt: number): State {
    if (!(dt > 0)) return s;
    const { pos, vel } = keplerPropagate(mu, sub(s.pos, centre), s.vel, dt);
    return { t: s.t + dt, pos: add(pos, centre), vel };
  }

  // each sample straight from s, so rounding doesn't accumulate
  function trajectory(s: State, duration: number, samples: number): State[] {
    const out = [s];
    for (let i = 1; i <= samples; i++) out.push(advance(s, duration * i / samples));
    return out;
  }

  return { name: 'kepler', accelerationAt, advance, trajectory };
};

