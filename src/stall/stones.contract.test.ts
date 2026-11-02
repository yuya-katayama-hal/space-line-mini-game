// What every stone engine must do, with tolerances a stepping engine can meet. The exact engine's closed-form
// results are checked to machine precision in stones.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { STONE_ENGINES } from './engines.ts';
import { EARTH_G, MOON_G } from './stones.ts';
import type { StoneOptions, StonePhysics, Surface } from './stones.ts';

const ground: Surface = { id: 'ground', height: 0, footprint: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } };
const bin: Surface = { id: 'bin', height: 0.3, footprint: { minX: -0.2, maxX: 0.2, minZ: -0.2, maxZ: 0.2 } };
const r = 0.05;
const TOL = 0.006; // m: Jolt keeps a small penetration slop at contacts

describe.each(Object.entries(STONE_ENGINES))('stone engine "%s"', (_, create) => {
  let w: StonePhysics | null = null;
  afterEach(() => { w?.dispose(); w = null; });

  async function world(extra: Partial<StoneOptions> = {}) {
    w = await create({ gravity: MOON_G, restitution: 0.1, surfaces: [ground], stones: [], ...extra });
    return w;
  }
  const at = (id: number) => w!.stones()[id];
  function drop(id: number, x: number, y: number, z: number) {
    expect(w!.grab(id)).toBe(true);
    w!.moveHeld({ x, y, z });
    w!.advance(0.5); // a stepping engine moves the held stone there over time
    w!.release();
  }
  // advances until the stone rests, returning how long that took
  function settle(id: number, limit = 20) {
    let t = 0;
    while (at(id).status !== 'resting' && t < limit) { w!.advance(0.05); t += 0.05; }
    return t;
  }

  it('starts with every stone resting on what is beneath it', async () => {
    await world({ surfaces: [ground, bin], stones: [{ x: 0, z: 0, radius: r }, { x: 1, z: 1, radius: r }] });
    expect(w!.stones().every((s) => s.status === 'resting')).toBe(true);
    expect(at(0).pos.y).toBeCloseTo(0.3 + r, 1);
    expect(at(0).on).toBe('bin');
    expect(Math.abs(at(1).pos.y - r)).toBeLessThan(TOL);
  });

  it('a held stone stays where it is moved, against gravity', async () => {
    await world({ stones: [{ x: 0, z: 0, radius: r }] });
    expect(w!.grab(0)).toBe(true);
    w!.moveHeld({ x: 0.2, y: 0.8, z: -0.1 });
    w!.advance(1);
    const s = at(0);
    expect(s.status).toBe('held');
    expect(Math.hypot(s.pos.x - 0.2, s.pos.y - 0.8, s.pos.z + 0.1)).toBeLessThan(1e-3);
  });

  it('holds one stone at a time, and only existing ones', async () => {
    await world({ stones: [{ x: 0, z: 0, radius: r }, { x: 1, z: 0, radius: r }] });
    expect(w!.grab(7)).toBe(false);
    expect(w!.grab(0)).toBe(true);
    expect(w!.grab(1)).toBe(false);
  });

  it('a released stone falls at the set gravity and comes to rest on the ground', async () => {
    await world({ stones: [{ x: 0, z: 0, radius: r }] });
    drop(0, 0, 1 + r, 0);
    const t1 = Math.sqrt(2 / MOON_G);
    w!.advance(0.8 * t1);
    expect(at(0).status).toBe('falling');
    expect(at(0).pos.y).toBeGreaterThan(r + 0.2);
    settle(0);
    expect(at(0).status).toBe('resting');
    expect(Math.abs(at(0).pos.y - r)).toBeLessThan(TOL);
    expect(at(0).on).toBe('ground');
  });

  it('lands on the highest surface beneath it', async () => {
    await world({ surfaces: [ground, bin], stones: [{ x: 1, z: 1, radius: r }] });
    drop(0, 0.05, 1, 0);
    settle(0);
    expect(at(0).on).toBe('bin');
    expect(Math.abs(at(0).pos.y - (0.3 + r))).toBeLessThan(TOL);
  });

  it('taking a stone from under another lets that one fall', async () => {
    await world({ stones: [{ x: 0, z: 0, radius: r }, { x: 0, z: 0, radius: r }] });
    expect(at(1).pos.y).toBeGreaterThan(2.5 * r);
    w!.grab(0);
    w!.moveHeld({ x: 2, y: 1, z: 0 });
    w!.advance(3);
    expect(at(1).pos.y).toBeLessThan(1.5 * r);
  });

  it('falls faster after switching to Earth gravity', async () => {
    const landing = async (switchTo: number | null) => {
      await world({ stones: [{ x: 0, z: 0, radius: r }] });
      drop(0, 0, 2 + r, 0);
      if (switchTo) w!.setGravity(switchTo);
      let t = 0;
      while (at(0).pos.y > r + 0.01 && t < 10) { w!.advance(0.01); t += 0.01; }
      w!.dispose();
      w = null;
      return t;
    };
    const moon = await landing(null), earth = await landing(EARTH_G);
    expect(moon).toBeCloseTo(Math.sqrt(2 * 2 / MOON_G), 0);
    expect(earth).toBeCloseTo(Math.sqrt(2 * 2 / EARTH_G), 0);
  });

  it('previews the landing spot of the held stone', async () => {
    await world({ surfaces: [ground, bin], stones: [{ x: 1, z: 1, radius: r }] });
    expect(w!.dropPreview()).toBeNull();
    w!.grab(0);
    w!.moveHeld({ x: 0.6, y: 1, z: 0.6 });
    w!.advance(0.5);
    const overGround = w!.dropPreview()!;
    expect(overGround.on).toBe('ground');
    expect(Math.abs(overGround.pos.y - r)).toBeLessThan(TOL);
    w!.moveHeld({ x: 0, y: 1, z: 0 });
    w!.advance(0.5);
    const overBin = w!.dropPreview()!;
    expect(overBin.on).toBe('bin');
    expect(Math.abs(overBin.pos.y - (0.3 + r))).toBeLessThan(TOL);
  });
});
