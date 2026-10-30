import { ENGINES } from '../physics/index.ts';
import { Game } from './game.ts';
import { mouseInput } from './input.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
// any engine in ENGINES works here; one that can't take planets gets the Sun alone
const game = new Game(canvas, ENGINES.patchedConic, mouseInput(canvas));
// lets tests and the console step the game by hand, since hidden tabs throttle animation frames
Object.assign(window, { spaceLine: { game } });

let last = performance.now();
function frame(now: number) {
  game.update((now - last) / 1000);
  last = now;
  game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
