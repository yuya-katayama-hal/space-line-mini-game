// Device-independent, so hand tracking can replace the mouse later.
import type { Vec2 } from '../physics/index.ts';
import { vec } from '../physics/index.ts';

export interface GameInput {
  /** CSS pixels of the canvas; null with no mouse over it or no hand in view */
  readonly pointer: Vec2 | null;
  readonly fastForward: boolean;
  onSelect(cb: () => void): void;
}

// mouse: move = pointer, click = select, hold Space or the right button = fast-forward
export function mouseInput(el: HTMLElement): GameInput {
  let pointer: Vec2 | null = null;
  let space = false, right = false;
  const selects: (() => void)[] = [];
  el.addEventListener('pointermove', (e) => { pointer = vec(e.offsetX, e.offsetY); });
  el.addEventListener('pointerleave', () => { pointer = null; });
  el.addEventListener('pointerdown', (e) => {
    pointer = vec(e.offsetX, e.offsetY);
    if (e.button === 2) right = true;
    else if (e.button === 0) for (const cb of selects) cb();
  });
  el.addEventListener('pointerup', (e) => { if (e.button === 2) right = false; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('keydown', (e) => { if (e.code === 'Space') { space = true; e.preventDefault(); } });
  addEventListener('keyup', (e) => { if (e.code === 'Space') space = false; });
  addEventListener('blur', () => { space = right = false; });
  return {
    get pointer() { return pointer; },
    get fastForward() { return space || right; },
    onSelect(cb) { selects.push(cb); },
  };
}
