import { describe, expect, it } from 'vitest';
import { carryPoint } from './carry.ts';

// the carry plane faces the camera: z fixed; x and y follow the hand
const plane = { z: -0.35, minY: 0.48, maxY: 1, minX: -1.2, maxX: 1.2 };
const from = { x: 0, y: 1.2, z: 1.6 };

describe('carry point', () => {
  it('is where the pointer ray meets the plane', () => {
    const p = carryPoint(from, { x: 0.3, y: -0.2, z: -1 }, plane)!;
    const t = (plane.z - from.z) / -1;
    expect(p.z).toBe(plane.z);
    expect(p.x).toBeCloseTo(from.x + 0.3 * t, 12);
    expect(p.y).toBeCloseTo(from.y - 0.2 * t, 12);
  });

  it('stays above the bin walls however low the hand goes', () => {
    expect(carryPoint(from, { x: 0, y: -1, z: -1 }, plane)!.y).toBe(plane.minY);
  });

  it('stays within the row sideways and below the top', () => {
    const p = carryPoint(from, { x: 5, y: 3, z: -1 }, plane)!;
    expect(p.x).toBe(plane.maxX);
    expect(p.y).toBe(plane.maxY);
  });

  it('has no point for a ray that never reaches the plane', () => {
    expect(carryPoint(from, { x: 0, y: 0, z: 1 }, plane)).toBeNull();
  });
});
