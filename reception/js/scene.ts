// Shapes shared by the scenes, the UI and main: what a scene offers, and the things a visitor can point at.
import type * as THREE from 'three';
import type { OrbitRig } from './util.ts';
import type { CardInfo } from './content.ts';

// Something in a 3D scene the cursor can hover / select. ui.project() fills in the _x, _y, _r, _vis screen fields.
export interface SceneTarget {
  id: string;
  kind?: undefined;
  el?: undefined;
  obj: THREE.Object3D;
  radius: number;
  tag?: string;
  tagEn?: string;
  info?: CardInfo;
  focus?: number;              // camera distance when selected
  noTag?: boolean;             // no floating label
  action?: 'travel' | 'launch';
  to?: string;                 // travel: destination id
  enabled?: () => boolean;
  onSelect?: () => void;
  markerSize?: number;
  _x?: number; _y?: number; _r?: number; _vis?: boolean;
}

// A DOM button (back / close) handled like a target, so it can be hovered and pinched too.
export interface DomTarget {
  id: string;
  kind: 'dom';
  el: HTMLElement;
  obj?: undefined;
  action: 'back' | 'close';
  tag?: string;
}

export type Target = SceneTarget | DomTarget;

// a planet that hides targets behind it
export interface Occluder {
  obj: THREE.Object3D;
  radius: number;
}

export interface BoothScene {
  era: string;
  bloom: { strength: number; radius: number; threshold: number };
  exposure: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: OrbitRig;
  targets: SceneTarget[];
  occluders: Occluder[];
  update(dt: number, t: number, hovered: Target | null): void;
  enter(): void;
  exit(): void;
  back(): boolean;       // handle "back" inside the scene; false = nothing to go back to here
  canGoBack(): boolean;
  selected(target: SceneTarget): void;
}
