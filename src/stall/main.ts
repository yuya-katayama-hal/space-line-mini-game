import { startHandCamera } from '../hand/camera.ts';
import type { HandCamera } from '../hand/camera.ts';
import { eitherInput, mouseStallInput } from './input.ts';
import type { StallInput } from './input.ts';
import { Stall } from './stall.ts';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const stage = document.getElementById('stage')!;
const preview = document.getElementById('hand-preview')!;
const status = document.getElementById('hand-status')!;

let camera: HandCamera | null = null;
const hand: StallInput = {
  get pointer() { return camera?.tracker.pointer ?? null; },
  get closed() { return camera?.tracker.closed ?? false; },
};
const stall = new Stall(canvas, eitherInput(hand, mouseStallInput(stage)));
// lets tests and the console step the stall by hand, since hidden tabs throttle animation frames
Object.assign(window, { stall });

// C shows the camera preview, for tuning the hand region on site
addEventListener('keydown', (e) => { if (e.key === 'c' || e.key === 'C') preview.classList.toggle('hidden'); });
startHandCamera(document.getElementById('hand-video') as HTMLVideoElement, document.getElementById('hand-overlay') as HTMLCanvasElement,
  (text) => { status.textContent = text; }, () => !preview.classList.contains('hidden'))
  .then((c) => { camera = c; }, (err) => {
    console.warn('hand tracking failed:', err);
    status.textContent = '手の認識を使えません。マウスで操作できます / Hand tracking unavailable: use the mouse';
  });

let last = performance.now();
function frame(now: number) {
  camera?.update(now, { width: stage.clientWidth, height: stage.clientHeight });
  stall.update((now - last) / 1000, now);
  last = now;
  stall.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
