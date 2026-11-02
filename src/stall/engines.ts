// The stone engines the stall can switch between (STALL_CONFIG.engine, or the P key).
import { createStones } from './stones.ts';
import type { StoneEngine } from './stones.ts';

export const STONE_ENGINES = {
  exact: async (opts) => createStones(opts),
  // loaded on first use: its WebAssembly is a 3 MB chunk of its own
  jolt: async (opts) => (await import('./jolt-stones.ts')).createJoltStones(opts),
} satisfies Record<string, StoneEngine>;

export type StoneEngineName = keyof typeof STONE_ENGINES;
