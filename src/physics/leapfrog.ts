// Fixed-step leapfrog (kick-drift-kick). Being symplectic, it keeps orbits closed over many revolutions
// instead of spiralling out like Euler. Kept for comparison with the exact engines.
import type { EngineFactory, State } from './engine.ts';
import { add, scale, vec } from './vec.ts';
import type { Vec2 } from './vec.ts';

export const createLeapfrogEngine: EngineFactory = ({ attractors, maxStep = 0.0005, softening = 1e-3 }) => {
  const eps2 = softening * softening;

  function accelerationAt(p: Vec2, t: number): Vec2 {
    let ax = 0, ay = 0;
    for (const a of attractors) {
      const c = a.position(t);
      const dx = c.x - p.x, dy = c.y - p.y;
      const r2 = dx * dx + dy * dy + eps2;
      const f = a.mu / (r2 * Math.sqrt(r2));
      ax += f * dx;
      ay += f * dy;
    }
    return vec(ax, ay);
  }

  function step(s: State, h: number): State {
    const vHalf = add(s.vel, scale(accelerationAt(s.pos, s.t), h / 2));
    const pos = add(s.pos, scale(vHalf, h));
    const t = s.t + h;
    return { t, pos, vel: add(vHalf, scale(accelerationAt(pos, t), h / 2)) };
  }

  function advance(s: State, dt: number): State {
    if (!(dt > 0)) return s;
    const n = Math.ceil(dt / maxStep);
    let x = s;
    for (let i = 0; i < n; i++) x = step(x, dt / n);
    return x;
  }

  function trajectory(s: State, duration: number, samples: number): State[] {
    const out = [s];
    let x = s;
    for (let i = 0; i < samples; i++) out.push(x = advance(x, duration / samples));
    return out;
  }

  return { name: 'leapfrog', accelerationAt, advance, trajectory };
};
