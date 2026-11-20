import { describe, expect, it } from 'vitest';
import { HAND_CONFIG, HandTracker, handShape, palmCentre, regionToScreen } from './gesture.ts';
import type { HandFrame, Point3 } from './gesture.ts';

// A synthetic hand in MediaPipe's 21-landmark layout. World coordinates are metres around the wrist; image
// coordinates are the same shape, scaled and placed at `at` in the (unmirrored) camera image.
const FINGER_X = [-0.03, -0.01, 0.01, 0.03]; // index, middle, ring, pinky
function hand(curled: readonly boolean[], at = { x: 0.5, y: 0.5 }): HandFrame {
  const world: Point3[] = new Array(21);
  world[0] = { x: 0, y: 0, z: 0 };
  [[1, -0.04, -0.03], [2, -0.06, -0.05], [3, -0.07, -0.07], [4, -0.08, -0.09]]
    .forEach(([i, x, y]) => { world[i] = { x, y, z: 0 }; });
  FINGER_X.forEach((x, f) => {
    const base = 5 + 4 * f; // mcp, pip, dip, tip
    world[base] = { x, y: -0.09, z: 0 };
    world[base + 1] = { x, y: -0.13, z: 0 };
    world[base + 2] = curled[f] ? { x, y: -0.11, z: 0.03 } : { x, y: -0.155, z: 0 };
    world[base + 3] = curled[f] ? { x, y: -0.07, z: 0.03 } : { x, y: -0.18, z: 0 };
  });
  const landmarks = world.map((p) => ({ x: at.x + p.x * 2, y: at.y + p.y * 2, z: p.z }));
  return { landmarks, world };
}
const OPEN = [false, false, false, false];
const FIST = [true, true, true, true];
const SIZE = { width: 1000, height: 800 };

describe('hand shape', () => {
  it('reads an open hand as open and a fist as closed', () => {
    expect(handShape(hand(OPEN).world)).toBe('open');
    expect(handShape(hand(FIST).world)).toBe('closed');
  });

  it('is unsure about a half-closed hand', () => {
    expect(handShape(hand([true, true, false, false]).world)).toBe('unsure');
  });

  it('allows one finger to disagree', () => {
    expect(handShape(hand([true, true, true, false]).world)).toBe('closed');
    expect(handShape(hand([false, false, false, true]).world)).toBe('open');
  });
});

describe('cursor position', () => {
  it('sits at the palm centre, which does not move when the hand closes', () => {
    expect(palmCentre(hand(FIST).landmarks)).toEqual(palmCentre(hand(OPEN).landmarks));
  });

  it('maps the camera region to the whole screen, mirrored, clamped at the edges', () => {
    const r = HAND_CONFIG.region;
    expect(regionToScreen({ x: r.x1, y: r.y0 }, r)).toEqual({ x: 0, y: 0 });
    expect(regionToScreen({ x: r.x0, y: r.y1 }, r)).toEqual({ x: 1, y: 1 });
    const mid = regionToScreen({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, r);
    expect(mid.x).toBeCloseTo(0.5, 12);
    expect(mid.y).toBeCloseTo(0.5, 12);
    expect(regionToScreen({ x: 0, y: 2 }, r)).toEqual({ x: 1, y: 1 });
  });
});

describe('hand tracker', () => {
  const centre = { x: (HAND_CONFIG.region.x0 + HAND_CONFIG.region.x1) / 2, y: (HAND_CONFIG.region.y0 + HAND_CONFIG.region.y1) / 2 };
  const placed = (curled: readonly boolean[]) => {
    // put the palm centre at the middle of the region, so the cursor lands mid-screen
    const h = hand(curled);
    const p = palmCentre(h.landmarks);
    return hand(curled, { x: 0.5 + centre.x - p.x, y: 0.5 + centre.y - p.y });
  };

  it('has no pointer and an open hand before any hand is seen', () => {
    const t = new HandTracker();
    expect(t.pointer).toBeNull();
    expect(t.closed).toBe(false);
  });

  it('jumps to a hand that appears, instead of sliding in', () => {
    const t = new HandTracker();
    t.update(placed(OPEN), 0, SIZE);
    expect(t.pointer!.x).toBeCloseTo(500, 6);
    expect(t.pointer!.y).toBeCloseTo(400, 6);
  });

  it('follows a moving hand smoothly', () => {
    const t = new HandTracker();
    t.update(placed(OPEN), 0, SIZE);
    const start = placed(OPEN);
    // 5 % of the image to the left in the camera, which is to the right on the mirrored screen
    const moved = { ...start, landmarks: start.landmarks.map((p) => ({ ...p, x: p.x - 0.05 })) };
    t.update(moved, 33, SIZE);
    const target = regionToScreen(palmCentre(moved.landmarks), HAND_CONFIG.region).x * SIZE.width;
    expect(t.pointer!.x).toBeGreaterThan(500);
    expect(t.pointer!.x).toBeLessThan(target);
  });

  it('closes only once the fist has lasted the debounce time, and opens the same way', () => {
    const t = new HandTracker();
    t.update(placed(OPEN), 0, SIZE);
    t.update(placed(FIST), 10, SIZE);
    expect(t.closed).toBe(false);
    t.update(placed(FIST), 10 + HAND_CONFIG.debounceMs, SIZE);
    expect(t.closed).toBe(true);
    t.update(placed(OPEN), 200, SIZE);
    expect(t.closed).toBe(true);
    t.update(placed(OPEN), 200 + HAND_CONFIG.debounceMs, SIZE);
    expect(t.closed).toBe(false);
  });

  it('a one-frame glitch does not change the hand state', () => {
    const t = new HandTracker();
    t.update(placed(OPEN), 0, SIZE);
    t.update(placed(FIST), 10, SIZE);
    t.update(placed(OPEN), 20, SIZE);
    t.update(placed(OPEN), 20 + HAND_CONFIG.debounceMs, SIZE);
    expect(t.closed).toBe(false);
  });

  it('keeps the current state while unsure', () => {
    const t = new HandTracker();
    t.update(placed(FIST), 0, SIZE);
    t.update(placed(FIST), HAND_CONFIG.debounceMs, SIZE);
    expect(t.closed).toBe(true);
    t.update(placed([true, true, false, false]), 200, SIZE);
    t.update(placed([true, true, false, false]), 200 + 10 * HAND_CONFIG.debounceMs, SIZE);
    expect(t.closed).toBe(true);
  });

  it('rides out a short tracking loss, then lets go once the hand is gone', () => {
    const t = new HandTracker();
    t.update(placed(FIST), 0, SIZE);
    t.update(placed(FIST), HAND_CONFIG.debounceMs, SIZE);
    t.update(null, HAND_CONFIG.debounceMs + HAND_CONFIG.handLostMs / 2, SIZE);
    expect(t.pointer).not.toBeNull();
    expect(t.closed).toBe(true);
    t.update(null, HAND_CONFIG.debounceMs + HAND_CONFIG.handLostMs + 1, SIZE);
    expect(t.pointer).toBeNull();
    expect(t.closed).toBe(false);
  });
});
