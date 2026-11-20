// The open / closed hand is all the stall needs besides the pointer, so hand tracking can implement this later.
import type { Vec2 } from '../physics/index.ts';
import { vec } from '../physics/index.ts';

export interface StallInput {
  /** CSS pixels of the canvas; null with no mouse over it or no hand in view */
  readonly pointer: Vec2 | null;
  readonly closed: boolean;
}

/** The hand while one is in view, otherwise the mouse (for development, or if the camera fails at the venue). */
export function eitherInput(hand: StallInput | null, mouse: StallInput): StallInput {
  const active = () => (hand && hand.pointer ? hand : mouse);
  return {
    get pointer() { return active().pointer; },
    get closed() { return active().closed; },
  };
}

// mouse: holding the left button stands in for a closed hand
export function mouseStallInput(el: HTMLElement): StallInput {
  let pointer: Vec2 | null = null;
  let closed = false;
  // not offsetX/Y: those are relative to the event target, which is the shuttle sign when the pointer is on it
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return vec(e.clientX - r.left, e.clientY - r.top);
  };
  el.addEventListener('pointermove', (e) => { pointer = at(e); });
  el.addEventListener('pointerleave', () => { pointer = null; closed = false; });
  el.addEventListener('pointerdown', (e) => { if (e.button === 0) { pointer = at(e); closed = true; } });
  addEventListener('pointerup', (e) => { if (e.button === 0) closed = false; });
  addEventListener('blur', () => { closed = false; });
  return {
    get pointer() { return pointer; },
    get closed() { return closed; },
  };
}
