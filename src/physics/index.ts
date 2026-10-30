//   patchedConic  exact conics joined at spheres of influence (one fixed central body + planets on rails)
//   kepler        exact two-body solution (one fixed attractor)
//   leapfrog      fixed-step numerical integration (any attractors)
import type { EngineFactory } from './engine.ts';
import { createKeplerEngine } from './kepler.ts';
import { createLeapfrogEngine } from './leapfrog.ts';
import { patchedConicFactory } from './patched-conic.ts';

export type * from './engine.ts';
export * from './vec.ts';
export { UnsupportedSetup } from './kepler.ts';
export type { PatchedConicEngine, Segment } from './patched-conic.ts';

export const ENGINES: Record<string, EngineFactory> = {
  patchedConic: patchedConicFactory,
  kepler: createKeplerEngine,
  leapfrog: createLeapfrogEngine,
};
