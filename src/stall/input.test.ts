import { describe, expect, it } from 'vitest';
import { eitherInput } from './input.ts';
import type { StallInput } from './input.ts';

const source = (pointer: { x: number; y: number } | null, closed: boolean): StallInput => ({ pointer, closed });

describe('hand or mouse', () => {
  it('follows the hand while one is in view', () => {
    const input = eitherInput(source({ x: 1, y: 2 }, true), source({ x: 9, y: 9 }, false));
    expect(input.pointer).toEqual({ x: 1, y: 2 });
    expect(input.closed).toBe(true);
  });

  it('falls back to the mouse when no hand is in view', () => {
    const input = eitherInput(source(null, false), source({ x: 9, y: 9 }, true));
    expect(input.pointer).toEqual({ x: 9, y: 9 });
    expect(input.closed).toBe(true);
  });

  it('works with the mouse alone when there is no camera', () => {
    const input = eitherInput(null, source({ x: 9, y: 9 }, false));
    expect(input.pointer).toEqual({ x: 9, y: 9 });
  });

  it('reads the sources live, not once', () => {
    let pointer: { x: number; y: number } | null = null;
    const hand: StallInput = { get pointer() { return pointer; }, closed: false };
    const input = eitherInput(hand, source({ x: 9, y: 9 }, false));
    expect(input.pointer).toEqual({ x: 9, y: 9 });
    pointer = { x: 1, y: 1 };
    expect(input.pointer).toEqual({ x: 1, y: 1 });
  });
});
