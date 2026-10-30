// Units are AU and years, so the Sun's G*M is 4 pi^2 and every number stays near 1. Earth and Mars move on
// circular orbits in one plane.
import type { Attractor, PhysicsEngine } from '../physics/index.ts';
import { add, len, scale, sub, vec } from '../physics/index.ts';
import type { Vec2 } from '../physics/index.ts';

export const GM_SUN = 4 * Math.PI ** 2;
/** km/s in 1 AU/yr */
export const KMS = 4.740470463;
export const DAYS_PER_YEAR = 365.25;

export const SUN: Attractor = { mu: GM_SUN, position: () => vec(0, 0) };

export interface Planet {
  readonly name: string;
  /** orbit radius, AU */
  readonly r: number;
  /** angle at t = 0, radians, counter-clockwise from +x */
  readonly phase0: number;
}

export const EARTH_R = 1;
export const MARS_R = 1.524;

export const angularSpeed = (r: number) => Math.sqrt(GM_SUN / r ** 3);

export function planetPos(p: Planet, t: number): Vec2 {
  const a = p.phase0 + angularSpeed(p.r) * t;
  return vec(p.r * Math.cos(a), p.r * Math.sin(a));
}

export function planetVel(p: Planet, t: number): Vec2 {
  const a = p.phase0 + angularSpeed(p.r) * t;
  const v = p.r * angularSpeed(p.r);
  return vec(-v * Math.sin(a), v * Math.cos(a));
}

export const KM_PER_AU = 149_597_870.7;

/** parking: a circular orbit 300 km up, where departures start and arrivals end */
export interface PlanetBody {
  readonly mu: number;
  readonly parking: number;
}
export const EARTH_BODY: PlanetBody = { mu: GM_SUN * 3.0034896e-6, parking: (6371 + 300) / KM_PER_AU };
export const MARS_BODY: PlanetBody = { mu: GM_SUN * 3.2271560e-7, parking: (3389.5 + 300) / KM_PER_AU };

/** Sphere of influence by Laplace's formula r (m/M)^(2/5). */
export function planetAttractor(p: Planet, body: PlanetBody): Attractor {
  const w = angularSpeed(p.r);
  return {
    mu: body.mu,
    soi: p.r * (body.mu / GM_SUN) ** 0.4,
    maxAccel: p.r * w * w,
    position: (t) => planetPos(p, t),
    velocity: (t) => planetVel(p, t),
  };
}

/** The burn from the parking orbit to leave with excess speed vInf, or to be captured arriving with it. Burning
 *  deep in the gravity well costs less than escaping first and then adding vInf (the Oberth effect). */
export const burnFromOrbit = (b: PlanetBody, vInf: number) =>
  Math.sqrt(vInf * vInf + 2 * b.mu / b.parking) - Math.sqrt(b.mu / b.parking);

/** The state at periapsis, relative to the planet, of the counter-clockwise escape hyperbola whose outgoing
 *  asymptote points along vInf. */
export function escapeFromOrbit(b: PlanetBody, vInf: Vec2): { pos: Vec2; vel: Vec2 } {
  const v = len(vInf);
  const e = 1 + b.parking * v * v / b.mu;
  const periapsisAngle = Math.atan2(vInf.y, vInf.x) - Math.acos(-1 / e); // the asymptote is nu_inf past periapsis
  const vp = Math.sqrt(v * v + 2 * b.mu / b.parking);
  const c = Math.cos(periapsisAngle), s = Math.sin(periapsisAngle);
  return { pos: vec(b.parking * c, b.parking * s), vel: vec(-vp * s, vp * c) };
}

/** Hohmann transfer: the minimum-energy half ellipse between two circular orbits. */
export function hohmann(r1: number, r2: number) {
  const a = (r1 + r2) / 2;
  const depart = Math.sqrt(GM_SUN * (2 / r1 - 1 / a)) - Math.sqrt(GM_SUN / r1);
  const arrive = Math.sqrt(GM_SUN / r2) - Math.sqrt(GM_SUN * (2 / r2 - 1 / a));
  const time = Math.PI * Math.sqrt(a ** 3 / GM_SUN);
  /** how far ahead of the ship the target must be at departure, radians */
  const lead = Math.PI - angularSpeed(r2) * time;
  return { depart, arrive, time, lead };
}

/** The "just aim at it" comparison: speed change for a constant-speed straight line, thrusting against gravity
 *  the whole way and matching velocities at both ends. */
export function straightLineDv(engine: PhysicsEngine, from: { pos: Vec2; vel: Vec2; t: number },
  to: { pos: Vec2; vel: Vec2 }, duration: number, steps = 400): number {
  const v = scale(sub(to.pos, from.pos), 1 / duration);
  let againstGravity = 0;
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps;
    againstGravity += len(engine.accelerationAt(add(from.pos, scale(v, f * duration)), from.t + f * duration)) * duration / steps;
  }
  return len(sub(v, from.vel)) + againstGravity + len(sub(to.vel, v));
}
