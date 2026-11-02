// The stone stall, in metres: four bins of moon stones in a row, and the visitor's souvenir pouch in front.
import { restingHeight } from './stones.ts';
import type { Footprint, Obstacle, Surface, Vec3 } from './stones.ts';

export interface StoneKind {
  readonly id: string;
  readonly name: string;      // Japanese
  readonly nameEn: string;
  readonly caption: string;   // Japanese, one line for the sign
  readonly captionEn: string;
  readonly color: number;
  readonly radius: [number, number];
  readonly count: number;
}

export const KINDS: readonly StoneKind[] = [
  {
    id: 'highland', name: '斜長岩 (高地の石)', nameEn: 'Highland anorthosite',
    caption: '月の明るい「高地」をつくる白っぽい石', captionEn: 'The pale rock of the bright highlands',
    color: 0xd6d1c4, radius: [0.035, 0.05], count: 14,
  },
  {
    id: 'basalt', name: '玄武岩 (海の石)', nameEn: 'Mare basalt',
    caption: '暗い「海」は、むかし固まった溶岩', captionEn: "The dark 'seas' are old, solid lava",
    color: 0x3e3c3a, radius: [0.035, 0.05], count: 14,
  },
  {
    id: 'orange', name: 'オレンジ色のガラス玉', nameEn: 'Orange glass beads',
    caption: '火山の噴火でできたガラス (アポロ17号が発見)', captionEn: 'Volcanic glass, found by Apollo 17',
    color: 0xc8682a, radius: [0.022, 0.03], count: 22,
  },
  {
    id: 'breccia', name: '角礫岩', nameEn: 'Breccia',
    caption: '隕石の衝突で砕けて、また固まった石', captionEn: 'Rock shattered by impacts and welded again',
    color: 0x8d877f, radius: [0.035, 0.05], count: 14,
  },
];

export const BIN = { width: 0.42, depth: 0.36, wall: 0.4, front: 0.3, floor: 0.22, z: -0.35, gap: 0.08, thickness: 0.02 };
export const binX = (i: number) => (i - (KINDS.length - 1) / 2) * (BIN.width + BIN.gap);
export const binFootprint = (i: number): Footprint => ({
  minX: binX(i) - BIN.width / 2, maxX: binX(i) + BIN.width / 2,
  minZ: BIN.z - BIN.depth / 2, maxZ: BIN.z + BIN.depth / 2,
});

export const POUCH = { footprint: { minX: 0.45, maxX: 0.8, minZ: 0.12, maxZ: 0.4 }, floor: 0.04, wall: 0.16, thickness: 0.015 };
export const POUCH_LIMIT = 3; // shown on the sign, never enforced

/** A souvenir: a stone inside the pouch's walls with its bottom below their top, moving or not, unless held.
 *  Being over the pouch isn't enough: that includes stones on the rim, on others above it, or flying over it. */
export function inPouch(s: { pos: Vec3; radius: number; status: string }): boolean {
  const fp = POUCH.footprint, t = POUCH.thickness / 2;
  return s.status !== 'held'
    && s.pos.x > fp.minX + t && s.pos.x < fp.maxX - t && s.pos.z > fp.minZ + t && s.pos.z < fp.maxZ - t
    && s.pos.y - s.radius < POUCH.wall;
}

// the walls around a footprint, straddling its edges; the front wall can be lower so the contents show
function walls(fp: Footprint, height: number, front: number, t: number): Obstacle[] {
  const box = (x0: number, x1: number, y1: number, z0: number, z1: number): Obstacle => ({ min: { x: x0, y: 0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
  return [
    box(fp.minX - t / 2, fp.minX + t / 2, height, fp.minZ, fp.maxZ),
    box(fp.maxX - t / 2, fp.maxX + t / 2, height, fp.minZ, fp.maxZ),
    box(fp.minX, fp.maxX, height, fp.minZ - t / 2, fp.minZ + t / 2),
    box(fp.minX, fp.maxX, front, fp.maxZ - t / 2, fp.maxZ + t / 2),
  ];
}
export const binWalls = (i: number) => walls(binFootprint(i), BIN.wall, BIN.front, BIN.thickness);
export const pouchWalls = () => walls(POUCH.footprint, POUCH.wall, POUCH.wall, POUCH.thickness);
/** what keeps rolling stones in: drawn from the same boxes the physics uses */
export const OBSTACLES: readonly Obstacle[] = [...KINDS.flatMap((_, i) => binWalls(i)), ...pouchWalls()];

export const SURFACES: readonly Surface[] = [
  { id: 'ground', height: 0, footprint: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 } },
  ...KINDS.map((k, i) => ({ id: k.id, height: BIN.floor, footprint: binFootprint(i) })),
  { id: 'pouch', height: POUCH.floor, footprint: POUCH.footprint },
];

/** deterministic, so every visitor finds the same bins */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The stones the stall starts with, and which kind each one is. Stones don't roll in the physics, so random
 *  spots would stack into towers; each stone takes the lowest of several spots instead, like a poured heap. */
export function initialStones() {
  const rand = seeded(2126);
  const specs: { x: number; z: number; radius: number; kind: number }[] = [];
  const placed: (Vec3 & { radius: number })[] = [];
  KINDS.forEach((k, i) => {
    const fp = binFootprint(i);
    for (let n = 0; n < k.count; n++) {
      const radius = k.radius[0] + rand() * (k.radius[1] - k.radius[0]);
      const margin = radius + BIN.thickness / 2; // the walls straddle the footprint's edges
      let best = { x: 0, z: 0, y: Infinity };
      for (let tries = 0; tries < 12; tries++) {
        const x = fp.minX + margin + rand() * (fp.maxX - fp.minX - 2 * margin);
        const z = fp.minZ + margin + rand() * (fp.maxZ - fp.minZ - 2 * margin);
        const y = restingHeight(SURFACES, placed, x, z, radius);
        if (y < best.y) best = { x, z, y };
      }
      placed.push({ ...best, radius });
      specs.push({ kind: i, radius, x: best.x, z: best.z });
    }
  });
  return specs;
}
