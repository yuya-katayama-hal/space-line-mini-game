// Stones are released at rest and only fall straight down, so every fall, bounce and landing has a closed form:
// no time steps, and the state at any time is evaluated, not integrated. A stone comes to rest on the highest
// support under it (a surface or another stone, at sphere contact height) and stays there; no rolling.
// Behind StonePhysics so a full engine (e.g. Jolt) can replace it if stone-on-stone dynamics turn out to matter.

export const MOON_G = 1.62;
export const EARTH_G = 9.81;
const MIN_APEX = 1e-4; // m: bounces lower than this end the fall
const EPS = 1e-9;

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

export interface StoneOptions {
  gravity: number;
  restitution: number;
  surfaces: readonly Surface[];
  /** settled in order onto whatever is beneath, as if dropped long ago */
  stones: readonly { x: number; z: number; radius: number }[];
}

export type StoneStatus = 'resting' | 'falling' | 'held';

export interface StoneView {
  readonly id: number;
  readonly pos: Vec3;
  readonly radius: number;
  readonly status: StoneStatus;
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
  release(): void;
  /** where the held stone would come to rest if released now; null when nothing is held */
  dropPreview(): { pos: Vec3; on: string | null } | null;
  setGravity(g: number): void;
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

interface Stone {
  id: number;
  radius: number;
  x: number;
  z: number;
  y: number; // when resting or held
  held: boolean;
  fall: Fall | null;
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

/** Centre height at which a stone of this radius over (x, z) comes to rest below fromY. */
export function restingHeight(surfaces: readonly Surface[], supports: readonly (Vec3 & { radius: number })[],
  x: number, z: number, radius: number, fromY = Infinity): number {
  let best = -Infinity;
  for (const f of surfaces) {
    if (inside(f.footprint, x, z) && f.height + radius <= fromY + EPS) best = Math.max(best, f.height + radius);
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

  const currentY = (s: Stone) => (s.fall ? fallAt(s.fall, time).y : s.y);
  const finalY = (s: Stone) => (s.fall ? s.fall.rest : s.y);

  function restHeight(s: Stone, fromY: number): number {
    const supports = stones.filter((o) => o !== s && !o.held).map((o) => ({ x: o.x, y: finalY(o), z: o.z, radius: o.radius }));
    return restingHeight(opts.surfaces, supports, s.x, s.z, s.radius, fromY);
  }

  function startFall(s: Stone, y0: number, v0: number) {
    const rest = restHeight(s, y0);
    if (y0 - rest <= EPS && v0 <= 0) {
      s.fall = null;
      s.y = rest;
      return;
    }
    s.fall = { t0: time, y0, v0, g: gravity, e: opts.restitution, rest };
  }

  // after a support is removed, let whatever it held fall, lowest first so the ones above see the new layout
  function resettle() {
    const loose = stones.filter((s) => !s.held).sort((a, b) => finalY(a) - finalY(b));
    for (const s of loose) {
      const y = currentY(s);
      if (restHeight(s, y) < finalY(s) - EPS) {
        const vy = s.fall ? fallAt(s.fall, time).vy : 0;
        startFall(s, y, vy);
      }
    }
  }

  opts.stones.forEach((spec, id) => {
    const s: Stone = { id, radius: spec.radius, x: spec.x, z: spec.z, y: 0, held: false, fall: null };
    s.y = restHeight(s, Infinity);
    stones.push(s);
  });

  const held = () => stones.find((s) => s.held) ?? null;

  function surfaceUnder(s: Stone, y: number): string | null {
    let on: string | null = null, onHeight = -Infinity;
    for (const f of opts.surfaces) {
      if (inside(f.footprint, s.x, s.z) && f.height <= y - s.radius + EPS && f.height > onHeight) { on = f.id; onHeight = f.height; }
    }
    return on;
  }

  return {
    get time() { return time; },
    advance(dt) { if (dt > 0) time += dt; },
    stones() {
      return stones.map((s) => {
        const state = s.fall ? fallAt(s.fall, time) : null;
        const y = state ? state.y : s.y;
        const status: StoneStatus = s.held ? 'held' : state && !state.done ? 'falling' : 'resting';
        return { id: s.id, pos: { x: s.x, y, z: s.z }, radius: s.radius, status, on: surfaceUnder(s, y) };
      });
    },
    dropPreview() {
      const s = held();
      if (!s) return null;
      const y = restHeight(s, s.y);
      return { pos: { x: s.x, y, z: s.z }, on: surfaceUnder(s, y) };
    },
    grab(id) {
      const s = stones[id];
      if (!s || held()) return false;
      s.y = currentY(s);
      s.fall = null;
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
    release() {
      const s = held();
      if (!s) return;
      s.held = false;
      startFall(s, s.y, 0);
    },
    setGravity(g) {
      // falling stones carry on from their current height and speed under the new gravity
      for (const s of stones) {
        if (!s.fall) continue;
        const { y, vy, done } = fallAt(s.fall, time);
        if (done) { s.y = s.fall.rest; s.fall = null; } else s.fall = { ...s.fall, t0: time, y0: y, v0: vy, g };
      }
      gravity = g;
    },
  };
}
