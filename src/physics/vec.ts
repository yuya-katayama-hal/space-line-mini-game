export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const ZERO = vec(0, 0);
export const add = (a: Vec2, b: Vec2) => vec(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2) => vec(a.x - b.x, a.y - b.y);
export const scale = (a: Vec2, k: number) => vec(a.x * k, a.y * k);
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2) => {
  const l = len(a);
  return l > 0 ? scale(a, 1 / l) : ZERO;
};
