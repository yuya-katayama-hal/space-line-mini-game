// Where a held stone goes for a pointer ray: onto an upright plane facing the camera, at a fixed depth, so the
// hand's left/right and up/down move the stone left/right and up/down. Moving it toward or away from the camera,
// as a flat carry plane did, was hard to judge on a screen.
import type { Vec3 } from './stones.ts';

export interface CarryPlane {
  readonly z: number;
  /** high enough that a carried stone clears the bin walls */
  readonly minY: number;
  readonly maxY: number;
  readonly minX: number;
  readonly maxX: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** null when the ray never reaches the plane */
export function carryPoint(origin: Vec3, dir: Vec3, plane: CarryPlane): Vec3 | null {
  if (dir.z === 0) return null;
  const t = (plane.z - origin.z) / dir.z;
  if (!(t > 0)) return null;
  return {
    x: clamp(origin.x + dir.x * t, plane.minX, plane.maxX),
    y: clamp(origin.y + dir.y * t, plane.minY, plane.maxY),
    z: plane.z,
  };
}
