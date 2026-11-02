import { describe, expect, it } from 'vitest';
import { createStones, EARTH_G, MOON_G } from './stones.ts';
import type { StoneOptions, Surface } from './stones.ts';

const ground: Surface = { id: 'ground', height: 0, footprint: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } };
const r = 0.05;

function world(extra: Partial<StoneOptions> = {}) {
  return createStones({ gravity: MOON_G, restitution: 0.3, surfaces: [ground], stones: [], ...extra });
}

// grabs stone id, moves it to (x, y, z) and lets go at the current time
function dropFrom(w: ReturnType<typeof world>, id: number, x: number, y: number, z: number) {
  expect(w.grab(id)).toBe(true);
  w.moveHeld({ x, y, z });
  w.release();
}

const y = (w: ReturnType<typeof world>, id: number) => w.stones().find((s) => s.id === id)!.pos.y;

describe('stone physics', () => {
  it('starts with every stone settled, none overlapping', () => {
    const w = world({ stones: [{ x: 0, z: 0, radius: r }, { x: 0.03, z: 0, radius: r }, { x: 1, z: 1, radius: r }] });
    const s = w.stones();
    expect(s.every((v) => v.status === 'resting')).toBe(true);
    expect(s[0].pos.y).toBeCloseTo(r, 12);
    expect(s[1].pos.y).toBeCloseTo(r + Math.sqrt((2 * r) ** 2 - 0.03 ** 2), 12);
    for (const a of s) for (const b of s) {
      if (a.id < b.id) expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(2 * r - 1e-12);
    }
  });

  it('a released stone falls on the exact parabola and lands after sqrt(2h/g)', () => {
    const w = world({ stones: [{ x: 0, z: 0, radius: r }] });
    dropFrom(w, 0, 0, 1 + r, 0);
    const t1 = Math.sqrt(2 * 1 / MOON_G);
    w.advance(t1 / 2);
    expect(y(w, 0)).toBeCloseTo(1 + r - MOON_G * (t1 / 2) ** 2 / 2, 12);
    expect(w.stones()[0].status).toBe('falling');
    w.advance(t1 / 2);
    expect(y(w, 0)).toBeCloseTo(r, 12);
  });

  it('bounces back to e^2 of the drop height, then comes to rest', () => {
    const e = 0.3;
    const w = world({ restitution: e, stones: [{ x: 0, z: 0, radius: r }] });
    dropFrom(w, 0, 0, 1 + r, 0);
    const t1 = Math.sqrt(2 / MOON_G);
    const vb = e * MOON_G * t1;
    w.advance(t1 + vb / MOON_G); // top of the first bounce
    expect(y(w, 0)).toBeCloseTo(r + e * e * 1, 12);
    w.advance(t1 * (1 + 2 * e / (1 - e))); // longer than the whole bounce series
    expect(w.stones()[0].status).toBe('resting');
    expect(y(w, 0)).toBeCloseTo(r, 12);
  });

  it('comes to rest on another stone, at sphere contact height', () => {
    const w = world({ stones: [{ x: 0, z: 0, radius: r }, { x: 5, z: 5, radius: r }] });
    dropFrom(w, 1, 0, 1, 0);
    w.advance(10);
    expect(y(w, 1)).toBeCloseTo(r + 2 * r, 12);
    dropFrom(w, 1, 0.06, 1, 0);
    w.advance(10);
    expect(y(w, 1)).toBeCloseTo(r + Math.sqrt((2 * r) ** 2 - 0.06 ** 2), 12);
  });

  it('lands on the highest surface beneath it', () => {
    const bin: Surface = { id: 'bin', height: 0.3, footprint: { minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2 } };
    const w = world({ surfaces: [ground, bin], stones: [{ x: 1, z: 1, radius: r }] });
    dropFrom(w, 0, 0.1, 1, 0);
    w.advance(10);
    expect(y(w, 0)).toBeCloseTo(0.3 + r, 12);
    expect(w.stones()[0].on).toBe('bin');
    dropFrom(w, 0, 0.5, 1, 0);
    w.advance(10);
    expect(y(w, 0)).toBeCloseTo(r, 12);
    expect(w.stones()[0].on).toBe('ground');
  });

  it('a held stone ignores gravity and goes where it is moved', () => {
    const w = world({ stones: [{ x: 0, z: 0, radius: r }] });
    expect(w.grab(0)).toBe(true);
    w.moveHeld({ x: 0.2, y: 0.8, z: -0.1 });
    w.advance(5);
    expect(w.stones()[0]).toMatchObject({ status: 'held', pos: { x: 0.2, y: 0.8, z: -0.1 } });
  });

  it('only one stone can be held, and only existing ones', () => {
    const w = world({ stones: [{ x: 0, z: 0, radius: r }, { x: 1, z: 0, radius: r }] });
    expect(w.grab(7)).toBe(false);
    expect(w.grab(0)).toBe(true);
    expect(w.grab(1)).toBe(false);
  });

  it('taking a stone from under another lets that one fall onto what is left', () => {
    const w = world({ stones: [{ x: 0, z: 0, radius: r }, { x: 0, z: 0, radius: r }] });
    expect(y(w, 1)).toBeCloseTo(3 * r, 12);
    w.grab(0);
    w.moveHeld({ x: 2, y: 1, z: 0 });
    expect(w.stones()[1].status).toBe('falling');
    w.advance(10);
    expect(y(w, 1)).toBeCloseTo(r, 12);
  });

  it('switching to Earth gravity mid-fall keeps position and speed, and lands sooner', () => {
    const w = world({ restitution: 0, stones: [{ x: 0, z: 0, radius: r }] });
    dropFrom(w, 0, 0, 2 + r, 0);
    w.advance(0.5);
    const h = 2 - MOON_G * 0.25 / 2; // height above rest at the switch
    const v = MOON_G * 0.5;          // falling speed at the switch
    expect(y(w, 0)).toBeCloseTo(r + h, 12);
    w.setGravity(EARTH_G);
    const left = (-v + Math.sqrt(v * v + 2 * EARTH_G * h)) / EARTH_G;
    w.advance(left / 2);
    expect(y(w, 0)).toBeCloseTo(r + h - v * left / 2 - EARTH_G * (left / 2) ** 2 / 2, 12);
    w.advance(left / 2);
    expect(y(w, 0)).toBeCloseTo(r, 12);
    expect(w.stones()[0].status).toBe('resting');
  });

  it('previews where the held stone would land, and the release lands exactly there', () => {
    const bin: Surface = { id: 'bin', height: 0.3, footprint: { minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2 } };
    const w = world({ surfaces: [ground, bin], stones: [{ x: 0, z: 0, radius: r }, { x: 1, z: 1, radius: r }] });
    expect(w.dropPreview()).toBeNull();
    w.grab(1);
    for (const [x, z] of [[0, 0], [0.06, 0], [0.15, 0.1], [0.5, 0.5]]) {
      w.moveHeld({ x, y: 1, z });
      const preview = w.dropPreview()!;
      expect(preview.pos).toEqual({ x, y: preview.pos.y, z });
      const probe = world({ surfaces: [ground, bin], stones: [{ x: 0, z: 0, radius: r }, { x: 1, z: 1, radius: r }] });
      dropFrom(probe, 1, x, 1, z);
      probe.advance(10);
      const landed = probe.stones()[1];
      expect(preview.pos.y).toBeCloseTo(landed.pos.y, 12);
      expect(preview.on).toBe(landed.on);
    }
  });

  it('does not depend on how time is advanced', () => {
    const make = () => {
      const w = world({ stones: [{ x: 0, z: 0, radius: r }] });
      dropFrom(w, 0, 0, 1, 0);
      return w;
    };
    const once = make(), many = make();
    once.advance(0.73);
    for (let i = 0; i < 73; i++) many.advance(0.01);
    expect(y(many, 0)).toBeCloseTo(y(once, 0), 12);
  });
});

describe('stone physics: letting go while moving', () => {
  const g = MOON_G;
  const at = (w: ReturnType<typeof world>, id: number) => w.stones().find((s) => s.id === id)!;
  function throwFrom(w: ReturnType<typeof world>, id: number, p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) {
    expect(w.grab(id)).toBe(true);
    w.moveHeld(p);
    w.release(v);
  }

  it('flies the exact parabola of its release velocity', () => {
    const w = world({ restitution: 0, stones: [{ x: 5, z: 5, radius: r }] });
    throwFrom(w, 0, { x: 0, y: 1 + r, z: 0 }, { x: 0.5, y: 0.2, z: -0.3 });
    w.advance(0.4);
    const s = at(w, 0);
    expect(s.status).toBe('falling');
    expect(s.pos.x).toBeCloseTo(0.5 * 0.4, 12);
    expect(s.pos.z).toBeCloseTo(-0.3 * 0.4, 12);
    expect(s.pos.y).toBeCloseTo(1 + r + 0.2 * 0.4 - g * 0.4 ** 2 / 2, 12);
  });

  it('comes to rest where the parabola meets the ground', () => {
    const w = world({ restitution: 0, stones: [{ x: 5, z: 5, radius: r }] });
    throwFrom(w, 0, { x: 0, y: 1 + r, z: 0 }, { x: 0.5, y: 0, z: 0 });
    w.advance(10);
    const s = at(w, 0);
    expect(s.status).toBe('resting');
    expect(s.pos.x).toBeCloseTo(0.5 * Math.sqrt(2 / g), 9);
    expect(s.pos.y).toBeCloseTo(r, 12);
  });

  it('stops at a wall it hits and drops down beside it', () => {
    const wall = { min: { x: 0.3, y: 0, z: -1 }, max: { x: 0.32, y: 0.5, z: 1 } };
    const w = world({ restitution: 0, obstacles: [wall], stones: [{ x: -1, z: 0, radius: r }] });
    throwFrom(w, 0, { x: 0, y: 0.3 + r, z: 0 }, { x: 1, y: 0, z: 0 });
    w.advance(10);
    const s = at(w, 0);
    expect(s.pos.x).toBeCloseTo(0.3 - r, 9);
    expect(s.pos.y).toBeCloseTo(r, 12);
  });

  it('can come to rest on top of a wall', () => {
    const wall = { min: { x: 0, y: 0, z: -1 }, max: { x: 0.1, y: 0.5, z: 1 } };
    const w = world({ restitution: 0, obstacles: [wall], stones: [{ x: -1, z: 0, radius: r }] });
    throwFrom(w, 0, { x: 0.05, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
    w.advance(10);
    expect(at(w, 0).pos.y).toBeCloseTo(0.5 + r, 12);
  });

  it('thrown onto another stone, rests touching it without overlap', () => {
    const w = world({ restitution: 0, stones: [{ x: 0.5, z: 0, radius: r }, { x: -1, z: 0, radius: r }] });
    throwFrom(w, 1, { x: 0, y: 0.6, z: 0 }, { x: 0.63, y: 0, z: 0 });
    w.advance(10);
    const a = at(w, 0), b = at(w, 1);
    expect(b.status).toBe('resting');
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(2 * r - 1e-9);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeLessThan(2 * r + 1e-6);
  });

  it('a sideways hit low on another stone pushes it clear before it settles', () => {
    const w = world({ restitution: 0, stones: [{ x: 0.5, z: 0, radius: r }, { x: -1, z: 0, radius: r }] });
    throwFrom(w, 1, { x: 0, y: r, z: 0 }, { x: 1, y: 0.3, z: 0 }); // skims along and hits it from the side
    w.advance(10);
    const a = at(w, 0), b = at(w, 1);
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(2 * r - 1e-9);
  });

  it('previews exactly where a throw will come to rest, with the arc it flies', () => {
    const wall = { min: { x: 0.3, y: 0, z: -1 }, max: { x: 0.32, y: 0.2, z: 1 } };
    const make = () => world({ obstacles: [wall], stones: [{ x: 0.6, z: 0, radius: r }, { x: -1, z: 0, radius: r }] });
    for (const v of [{ x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }, { x: 0.8, y: 0.4, z: 0.1 }, { x: 1.5, y: 0, z: 0 }]) {
      const w = make();
      w.grab(1);
      w.moveHeld({ x: 0, y: 0.6, z: 0 });
      const preview = w.dropPreview(v)!;
      expect(preview.path[0]).toEqual({ x: 0, y: 0.6, z: 0 });
      w.release(v);
      w.advance(10);
      const landed = at(w, 1);
      expect(preview.pos.x).toBeCloseTo(landed.pos.x, 9);
      expect(preview.pos.y).toBeCloseTo(landed.pos.y, 9);
      expect(preview.pos.z).toBeCloseTo(landed.pos.z, 9);
      expect(preview.on).toBe(landed.on);
    }
  });

  it('switching gravity mid-flight keeps position and velocity', () => {
    const w = world({ restitution: 0, stones: [{ x: 5, z: 5, radius: r }] });
    throwFrom(w, 0, { x: 0, y: 2, z: 0 }, { x: 0.4, y: 0, z: 0 });
    w.advance(0.5);
    const before = at(w, 0).pos;
    w.setGravity(EARTH_G);
    expect(at(w, 0).pos).toEqual(before);
    w.advance(0.1);
    const s = at(w, 0);
    expect(s.pos.x).toBeCloseTo(0.4 * 0.6, 12);
    expect(s.pos.y).toBeCloseTo(before.y - g * 0.5 * 0.1 - EARTH_G * 0.1 ** 2 / 2, 12);
  });

  it('a throw does not depend on how time is advanced', () => {
    const make = () => {
      const w = world({ stones: [{ x: 0.4, z: 0, radius: r }, { x: -1, z: 0, radius: r }] });
      throwFrom(w, 1, { x: 0, y: 0.7, z: 0 }, { x: 0.5, y: 0.3, z: 0.05 });
      return w;
    };
    const once = make(), many = make();
    once.advance(1.37);
    for (let i = 0; i < 137; i++) many.advance(0.01);
    const p = at(once, 1).pos, q = at(many, 1).pos;
    expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-12);
  });
});
