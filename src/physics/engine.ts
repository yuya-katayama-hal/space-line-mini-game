// Games talk only to this interface, so engines can be swapped without touching game code: implement
// EngineFactory and register it in ENGINES (index.ts). engine.test.ts runs on every registered engine.
import type { Vec2 } from './vec.ts';

/** A point mass that pulls on the ship. Its motion is given ("on rails"), not simulated. */
export interface Attractor {
  /** gravitational parameter G*M, in the caller's units (the mini-game uses AU^3/yr^2) */
  readonly mu: number;
  position(t: number): Vec2;
  /** patched conics: sphere-of-influence radius; absent on the central body */
  readonly soi?: number;
  velocity?(t: number): Vec2;
  /** patched conics: an upper bound on the body's acceleration, which keeps sphere-entry detection safe */
  readonly maxAccel?: number;
}

/** Engines treat states as values and never mutate them. */
export interface State {
  readonly t: number;
  readonly pos: Vec2;
  readonly vel: Vec2;
}

export interface PhysicsEngine {
  readonly name: string;
  accelerationAt(pos: Vec2, t: number): Vec2;
  /** dt >= 0 */
  advance(s: State, dt: number): State;
  /** samples + 1 states, s first, evenly spaced over duration */
  trajectory(s: State, duration: number, samples: number): State[];
}

export interface EngineOptions {
  attractors: readonly Attractor[];
  /** stepping engines only */
  maxStep?: number;
  /** stepping engines only: keeps the pull finite when the ship passes through an attractor */
  softening?: number;
}

/** Throws UnsupportedSetup for attractors the engine can't handle. */
export type EngineFactory = (opts: EngineOptions) => PhysicsEngine;
