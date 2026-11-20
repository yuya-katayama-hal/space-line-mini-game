// Hand landmarks (MediaPipe's 21 points) -> a cursor and an open / closed hand. Pure, so it is tested without a
// camera; camera.ts feeds it frames.
import type { Vec2 } from '../physics/index.ts';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** one detected hand: landmarks in the camera image (0..1) and in metres around the hand (for its shape) */
export interface HandFrame {
  readonly landmarks: readonly Point3[];
  readonly world: readonly Point3[];
}

export interface Region {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export type HandShape = 'open' | 'closed' | 'unsure';

export const HAND_CONFIG = {
  // the part of the camera image (unmirrored, 0..1) that maps to the whole screen, so a relaxed hand reaches
  // every edge; retune on site with the real chair and camera (the dashed box in the camera preview)
  region: { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.7 } as Region,
  smoothMin: 0.16,  // per frame, when the hand is almost still: steadier
  smoothMax: 0.7,   // per frame, when it moves fast: snappier
  smoothPx: 260,    // px of movement over which smoothing goes from min to max
  // a finger is curled when its tip is closer to the wrist than this fraction of its middle joint's distance,
  // and extended beyond the second; in between it counts for neither, which gives the shape hysteresis
  curledBelow: 0.9,
  extendedAbove: 1.05,
  // thumb tip to index tip, as a fraction of the palm (wrist to middle knuckle): pinched below the first, apart
  // above the second, neither in between
  pinchBelow: 0.25,
  pinchAbove: 0.45,
  debounceMs: 80,   // a new shape must last this long, so a one-frame tracking glitch can't drop a stone
  handLostMs: 400,  // tracking may drop out this long before the hand counts as gone
};

const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, middle joint] of index, middle, ring, pinky
const PALM = [0, 5, 9, 17]; // wrist and three knuckles: they stay put when the fingers close

const dist = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Closed on a pinch (thumb and index tips together) or when at least three fingers are curled; open when the
 *  thumb is away from the index and either at least three fingers or the index alone are extended. The index alone
 *  counts because many people pinch with the other three tucked, and letting go of that pinch must open the hand.
 *  Measured on the world landmarks, so it doesn't matter how the hand is turned toward the camera. */
export function handShape(world: readonly Point3[], cfg = HAND_CONFIG): HandShape {
  const pinch = dist(world[4], world[8]) / (dist(world[9], world[0]) || 1);
  if (pinch < cfg.pinchBelow) return 'closed';
  const apart = pinch > cfg.pinchAbove;
  let curled = 0, extended = 0, indexExtended = false;
  FINGERS.forEach(([tip, pip], f) => {
    const ratio = dist(world[tip], world[0]) / (dist(world[pip], world[0]) || 1);
    if (ratio < cfg.curledBelow) curled++;
    else if (ratio > cfg.extendedAbove) { extended++; if (f === 0) indexExtended = true; }
  });
  if (apart && (extended >= 3 || indexExtended)) return 'open';
  return curled >= 3 ? 'closed' : 'unsure';
}

export function palmCentre(landmarks: readonly Point3[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const i of PALM) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / PALM.length, y: y / PALM.length };
}

/** camera image (0..1) -> screen (0..1), mirrored so moving the hand right moves the cursor right */
export function regionToScreen(p: { x: number; y: number }, r: Region): { x: number; y: number } {
  return { x: clamp01((r.x1 - p.x) / (r.x1 - r.x0)), y: clamp01((p.y - r.y0) / (r.y1 - r.y0)) };
}

export class HandTracker {
  private readonly cfg: typeof HAND_CONFIG;
  private cursor: Vec2 | null = null;
  private isClosed = false;
  private pending: { shape: 'open' | 'closed'; since: number } | null = null;
  private lastSeen = -Infinity;

  constructor(cfg = HAND_CONFIG) {
    this.cfg = cfg;
  }

  /** CSS pixels of the screen; null while no hand is in view */
  get pointer(): Vec2 | null { return this.cursor; }
  get closed(): boolean { return this.isClosed; }

  /** frame: the hand seen in this camera frame, or null if none */
  update(frame: HandFrame | null, now: number, size: { width: number; height: number }) {
    if (!frame) {
      if (now - this.lastSeen > this.cfg.handLostMs) {
        this.cursor = null;
        this.isClosed = false;
        this.pending = null;
      }
      return;
    }
    this.lastSeen = now;

    const s = regionToScreen(palmCentre(frame.landmarks), this.cfg.region);
    const target = { x: s.x * size.width, y: s.y * size.height };
    if (!this.cursor) {
      this.cursor = target; // a hand that just appeared: jump there instead of sliding in
    } else {
      const d = Math.hypot(target.x - this.cursor.x, target.y - this.cursor.y);
      const a = Math.min(this.cfg.smoothMax, this.cfg.smoothMin + d / this.cfg.smoothPx);
      this.cursor = { x: this.cursor.x + (target.x - this.cursor.x) * a, y: this.cursor.y + (target.y - this.cursor.y) * a };
    }

    const shape = handShape(frame.world, this.cfg);
    if (shape === 'unsure' || (shape === 'closed') === this.isClosed) {
      this.pending = null;
      return;
    }
    if (!this.pending || this.pending.shape !== shape) this.pending = { shape, since: now };
    if (now - this.pending.since >= this.cfg.debounceMs) {
      this.isClosed = shape === 'closed';
      this.pending = null;
    }
  }
}
