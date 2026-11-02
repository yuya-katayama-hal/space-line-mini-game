// The exact stone engine: positions are evaluated from closed forms, never integrated. A released stone flies the
// parabola of its release velocity until it first touches something; that moment is found by conservative
// advancement (jumps no longer than the stone can travel before touching, so no contact is skipped). From there
// it stops moving sideways and falls straight onto the highest support under it (a surface, a wall top or another
// stone, at contact height), bouncing in closed form, and stays there: no rolling. jolt-stones.ts implements the
// same StonePhysics with rolling and real shapes.

export const MOON_G = 1.62;
export const EARTH_G = 9.81;
const MIN_APEX = 1e-4; // m: bounces lower than this end the fall
const EPS = 1e-9;
const CONTACT = 1e-10;  // m: closer than this counts as touching
const MAX_FLIGHT = 60;  // s: a throw that touches nothing in this time is treated as touching where it is
const PATH_POINTS = 24;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Footprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A horizontal floor stones can rest on (the ground, a bin's floor, the pouch). */
export interface Surface {
  readonly id: string;
  readonly height: number;
  readonly footprint: Footprint;
}

/** an axis-aligned solid box, e.g. a bin wall */
export interface Obstacle {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface StoneSpec {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** the stone's real shape, relative to its centre; engines without shapes use the radius */
  readonly hull?: readonly Vec3[];
}

export interface StoneOptions {
  gravity: number;
  restitution: number;
  surfaces: readonly Surface[];
  /** walls that keep rolling stones in; engines without rolling don't need them */
  obstacles?: readonly Obstacle[];
  /** settled in order onto whatever is beneath, as if dropped long ago */
  stones: readonly StoneSpec[];
}

/** orientation as a unit quaternion */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export type StoneStatus = 'resting' | 'falling' | 'held';

export interface StoneView {
  readonly id: number;
  readonly pos: Vec3;
  readonly radius: number;
  readonly status: StoneStatus;
  /** null when the engine doesn't turn stones */
  readonly rot: Quat | null;
  /** the highest surface beneath the stone */
  readonly on: string | null;
}

export interface StonePhysics {
  readonly time: number;
  advance(dt: number): void;
  stones(): StoneView[];
  /** false if the stone doesn't exist or another one is already held */
  grab(id: number): boolean;
  moveHeld(target: Vec3): void;
  /** lets go of the held stone with this velocity (at rest if omitted) */
  release(velocity?: Vec3): void;
  /** where the held stone would come to rest if released now with this velocity, and the path it would take;
   *  null when nothing is held */
  dropPreview(velocity?: Vec3): DropPreview | null;
  setGravity(g: number): void;
  dispose(): void;
}

export interface DropPreview {
  readonly pos: Vec3;
  readonly on: string | null;
  /** from the stone to where it lands, as points to draw a line through */
  readonly path: readonly Vec3[];
}

export type StoneEngine = (opts: StoneOptions) => Promise<StonePhysics>;

const AT_REST: Vec3 = { x: 0, y: 0, z: 0 };

/** the highest surface whose footprint contains (x, z) and whose top is at or below bottomY */
export function surfaceUnder(surfaces: readonly Surface[], x: number, z: number, bottomY: number): string | null {
  let on: string | null = null, onHeight = -Infinity;
  for (const f of surfaces) {
    if (inside(f.footprint, x, z) && f.height <= bottomY + EPS && f.height > onHeight) { on = f.id; onHeight = f.height; }
  }
  return on;
}

/** a fall from (t0, y0) with vertical speed v0 (up positive) onto the rest height */
interface Fall {
  t0: number;
  y0: number;
  v0: number;
  g: number;
  e: number;
  rest: number;
}

/** sideways motion of a thrown stone, from (x0, z0) at t0 until it touches something at tStop */
interface Drift {
  t0: number;
  x0: number;
  z0: number;
  vx: number;
  vz: number;
  tStop: number;
}

interface Stone {
  id: number;
  radius: number;
  x: number; // where it rests (or will, once a throw ends)
  z: number;
  y: number; // when resting or held
  held: boolean;
  fall: Fall | null;
  drift: Drift | null;
}

/** how a release plays out: the first contact, where the stone ends up sideways, and where it settles */
interface Plan {
  tContact: number; // after release
  x: number;
  z: number;
  yContact: number;
  rest: number;
}

/** height and vertical speed of a fall at time t, and whether it has come to rest */
function fallAt(f: Fall, t: number): { y: number; vy: number; done: boolean } {
  let tau = t - f.t0;
  const h = f.y0 - f.rest;
  const t1 = (f.v0 + Math.sqrt(Math.max(0, f.v0 * f.v0 + 2 * f.g * h))) / f.g;
  if (tau < t1 - EPS) return { y: f.y0 + f.v0 * tau - f.g * tau * tau / 2, vy: f.v0 - f.g * tau, done: false };
  tau -= t1;
  let v = f.e * (f.g * t1 - f.v0);
  while (v * v / (2 * f.g) >= MIN_APEX) {
    const d = 2 * v / f.g;
    if (tau < d - EPS) return { y: f.rest + v * tau - f.g * tau * tau / 2, vy: v - f.g * tau, done: false };
    tau -= d;
    v *= f.e;
  }
  return { y: f.rest, vy: 0, done: true };
}

const inside = (fp: Footprint, x: number, z: number) => x >= fp.minX && x <= fp.maxX && z >= fp.minZ && z <= fp.maxZ;
const gap = (v: number, min: number, max: number) => Math.max(min - v, 0, v - max);
const boxDistance = (b: Obstacle, p: Vec3) => Math.hypot(gap(p.x, b.min.x, b.max.x), gap(p.y, b.min.y, b.max.y), gap(p.z, b.min.z, b.max.z));
const surfaceBox = (f: Surface): Obstacle =>
  ({ min: { x: f.footprint.minX, y: f.height - 0.2, z: f.footprint.minZ }, max: { x: f.footprint.maxX, y: f.height, z: f.footprint.maxZ } });

/** Centre height at which a stone of this radius over (x, z) comes to rest below fromY: on a surface, on a box's
 *  top or rim, or on another stone. */
export function restingHeight(surfaces: readonly Surface[], supports: readonly (Vec3 & { radius: number })[],
  x: number, z: number, radius: number, fromY = Infinity, boxes: readonly Obstacle[] = []): number {
  let best = -Infinity;
  for (const f of surfaces) {
    if (inside(f.footprint, x, z) && f.height + radius <= fromY + EPS) best = Math.max(best, f.height + radius);
  }
  for (const b of boxes) {
    const d = Math.hypot(gap(x, b.min.x, b.max.x), gap(z, b.min.z, b.max.z));
    if (d >= radius) continue;
    const top = b.max.y + Math.sqrt(radius * radius - d * d);
    if (top <= fromY + EPS) best = Math.max(best, top);
  }
  for (const o of supports) {
    const d = Math.hypot(x - o.x, z - o.z), sum = radius + o.radius;
    if (d >= sum) continue;
    const top = o.y + Math.sqrt(sum * sum - d * d);
    if (top <= fromY + EPS) best = Math.max(best, top);
  }
  return best === -Infinity ? fromY : best;
}

export function createStones(opts: StoneOptions): StonePhysics {
  let time = 0;
  let gravity = opts.gravity;
  const stones: Stone[] = [];

  const obstacles = opts.obstacles ?? [];
  const solids = [...obstacles, ...opts.surfaces.map(surfaceBox)];
  const currentY = (s: Stone) => (s.fall ? fallAt(s.fall, time).y : s.y);
  const finalY = (s: Stone) => (s.fall ? s.fall.rest : s.y);
  const drifting = (s: Stone) => !!s.drift && time < s.drift.tStop;
  function currentXZ(s: Stone): { x: number; z: number } {
    if (!drifting(s)) return { x: s.x, z: s.z };
    const d = s.drift!, tau = time - d.t0;
    return { x: d.x0 + d.vx * tau, z: d.z0 + d.vz * tau };
  }
  const others = (s: Stone) => stones.filter((o) => o !== s && !o.held);

  function restAt(s: Stone, x: number, z: number, fromY: number): number {
    const supports = others(s).map((o) => ({ x: o.x, y: finalY(o), z: o.z, radius: o.radius }));
    return restingHeight(opts.surfaces, supports, x, z, s.radius, fromY, obstacles);
  }

  // where a stone released at p with velocity v first touches something, and where it then settles
  function plan(s: Stone, p: Vec3, v: Vec3): Plan {
    const g = gravity, r = s.radius;
    const at = (t: number): Vec3 => ({ x: p.x + v.x * t, y: p.y + v.y * t - g * t * t / 2, z: p.z + v.z * t });
    const rocks = others(s).map((o) => ({ c: { x: o.x, y: finalY(o), z: o.z }, r: o.radius }));
    const clearance = (q: Vec3) => {
      let c = Infinity;
      for (const b of solids) c = Math.min(c, boxDistance(b, q) - r);
      for (const k of rocks) c = Math.min(c, Math.hypot(q.x - k.c.x, q.y - k.c.y, q.z - k.c.z) - r - k.r);
      return c;
    };
    // conservative advancement: within delta the stone moves at most speed*delta + g*delta^2/2
    let t = 0;
    for (let i = 0; i < 100000 && t < MAX_FLIGHT; i++) {
      const c = clearance(at(t));
      if (c <= CONTACT) break;
      const speed = Math.hypot(v.x, v.y - g * t, v.z);
      t += 2 * c / (speed + Math.sqrt(speed * speed + 2 * g * c));
    }
    const q = at(t);
    let x = q.x, z = q.z;
    // a stone hit below its middle would be passed through on the way down, so step clear of it first
    for (const k of rocks) {
      const dh = Math.hypot(x - k.c.x, z - k.c.z), sum = r + k.r;
      if (q.y < k.c.y && dh < sum && Math.hypot(dh, q.y - k.c.y) <= sum + CONTACT * 10) {
        const ux = dh > 0 ? (x - k.c.x) / dh : -Math.sign(v.x || 1), uz = dh > 0 ? (z - k.c.z) / dh : 0;
        x = k.c.x + ux * (sum + 1e-9);
        z = k.c.z + uz * (sum + 1e-9);
      }
    }
    return { tContact: t, x, z, yContact: q.y, rest: restAt(s, x, z, q.y) };
  }

  function launch(s: Stone, p: Vec3, v: Vec3) {
    const pl = plan(s, p, v);
    s.x = pl.x;
    s.z = pl.z;
    s.drift = v.x || v.z ? { t0: time, x0: p.x, z0: p.z, vx: v.x, vz: v.z, tStop: time + pl.tContact } : null;
    if (p.y - pl.rest <= EPS && v.y <= 0 && !s.drift) {
      s.fall = null;
      s.y = pl.rest;
      return;
    }
    s.fall = { t0: time, y0: p.y, v0: v.y, g: gravity, e: opts.restitution, rest: pl.rest };
  }

  function startFall(s: Stone, y0: number, v0: number) {
    launch(s, { x: s.x, y: y0, z: s.z }, { x: 0, y: v0, z: 0 });
  }
  const restHeight = (s: Stone, fromY: number) => restAt(s, s.x, s.z, fromY);

  // after a support is removed, let whatever it held fall, lowest first so the ones above see the new layout;
  // a stone still in flight keeps the landing it was planned with
  function resettle() {
    const loose = stones.filter((s) => !s.held && !drifting(s)).sort((a, b) => finalY(a) - finalY(b));
    for (const s of loose) {
      const y = currentY(s);
      if (restHeight(s, y) < finalY(s) - EPS) {
        const vy = s.fall ? fallAt(s.fall, time).vy : 0;
        startFall(s, y, vy);
      }
    }
  }

  opts.stones.forEach((spec, id) => {
    const s: Stone = { id, radius: spec.radius, x: spec.x, z: spec.z, y: 0, held: false, fall: null, drift: null };
    s.y = restHeight(s, Infinity);
    stones.push(s);
  });

  const held = () => stones.find((s) => s.held) ?? null;


  return {
    get time() { return time; },
    advance(dt) { if (dt > 0) time += dt; },
    stones() {
      return stones.map((s) => {
        const state = s.fall ? fallAt(s.fall, time) : null;
        const y = state ? state.y : s.y;
        const { x, z } = currentXZ(s);
        const status: StoneStatus = s.held ? 'held' : (state && !state.done) || drifting(s) ? 'falling' : 'resting';
        return { id: s.id, pos: { x, y, z }, radius: s.radius, status, rot: null, on: surfaceUnder(opts.surfaces, x, z, y - s.radius) };
      });
    },
    dropPreview(v = AT_REST) {
      const s = held();
      if (!s) return null;
      const p = { x: s.x, y: s.y, z: s.z };
      const pl = plan(s, p, v);
      const path: Vec3[] = [];
      for (let i = 0; i <= PATH_POINTS; i++) {
        const t = pl.tContact * i / PATH_POINTS;
        path.push({ x: p.x + v.x * t, y: p.y + v.y * t - gravity * t * t / 2, z: p.z + v.z * t });
      }
      path.push({ x: pl.x, y: pl.yContact, z: pl.z }, { x: pl.x, y: pl.rest, z: pl.z });
      return { pos: { x: pl.x, y: pl.rest, z: pl.z }, on: surfaceUnder(opts.surfaces, pl.x, pl.z, pl.rest - s.radius), path };
    },
    grab(id) {
      const s = stones[id];
      if (!s || held()) return false;
      const { x, z } = currentXZ(s);
      s.y = currentY(s);
      s.x = x;
      s.z = z;
      s.fall = null;
      s.drift = null;
      s.held = true;
      resettle();
      return true;
    },
    moveHeld(p) {
      const s = held();
      if (!s) return;
      s.x = p.x;
      s.y = p.y;
      s.z = p.z;
    },
    release(v = AT_REST) {
      const s = held();
      if (!s) return;
      s.held = false;
      launch(s, { x: s.x, y: s.y, z: s.z }, v);
    },
    setGravity(g) {
      // moving stones carry on from their current position and velocity under the new gravity
      const moving = stones.map((s) => {
        if (!s.fall) return null;
        const { y, vy, done } = fallAt(s.fall, time);
        if (done && !drifting(s)) { s.y = s.fall.rest; s.fall = null; return null; }
        const d = drifting(s) ? s.drift! : null;
        return { s, p: { ...currentXZ(s), y }, v: { x: d ? d.vx : 0, y: vy, z: d ? d.vz : 0 } };
      });
      gravity = g;
      for (const m of moving) if (m) launch(m.s, m.p, m.v);
    },
    dispose() {},
  };
}
