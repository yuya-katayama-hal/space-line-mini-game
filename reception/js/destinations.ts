// Where visitors can fly. To add one (e.g. Mars):
//   1. write js/scenes/mars.ts (same shape as moon.ts and the BoothScene interface in scene.ts: scene, camera, rig, targets, update, enter/exit, back/canGoBack)
//   2. add its text to content.ts: ERAS.mars, GATES.mars, and the cards it uses
//   3. add an entry below, and a body.era-mars color block in css/style.css
// The space scene makes one gate per entry, in this order.
import { MoonScene } from './scenes/moon.ts';
import { MarsScene } from './scenes/mars.ts';
import { ERAS, GATES } from './content.ts';
import type { GateInfo } from './content.ts';
import type { BoothScene } from './scene.ts';

export interface Destination {
  id: string;
  Scene: new () => BoothScene;
  colors: string[];   // gate ring, gate swirl
  warpColor: string;
  year: number;
  gate: GateInfo;
}

export const DESTINATIONS: Destination[] = [
  { id: 'moon', Scene: MoonScene, colors: ['#3fd7ff', '#ff7ae6'], warpColor: '#7ff6ff' },
  { id: 'mars', Scene: MarsScene, colors: ['#ff7a3c', '#ffd166'], warpColor: '#ffb27a' },
].map((d) => ({ ...d, year: +ERAS[d.id].year, gate: GATES[d.id] }));
