import { mouseStallInput } from './input.ts';
import { Stall } from './stall.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const stall = new Stall(canvas, mouseStallInput(document.getElementById('stage')!));
// lets tests and the console step the stall by hand, since hidden tabs throttle animation frames
Object.assign(window, { stall });

let last = performance.now();
function frame(now: number) {
  stall.update((now - last) / 1000, now);
  last = now;
  stall.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
