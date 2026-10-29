// Hub scene (2126): Earth, the Moon, Mars, Saturn, the Sun, and one gate per destination.
// It is also where the return trip starts: startHomecoming() glides in until Earth fills the view.
import * as THREE from 'three';
import { OrbitRig, starfield, glowTexture, textSprite, NOISE_GLSL } from '../util.ts';
import { SPACE } from '../content.ts';
import type { CardInfo } from '../content.ts';
import type { Destination } from '../destinations.ts';
import type { BoothScene, Occluder, SceneTarget, Target } from '../scene.ts';

const SUN_POS = new THREE.Vector3(-650, 160, 380);

const VERT = /* glsl */`
varying vec3 vP; varying vec3 vWN; varying vec3 vWP;
void main(){
  vP = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// The Earth shaders are shared with the Moon scene, which lights them from its own sun.
export function earthMaterial(sunPos: THREE.Vector3 = SUN_POS) {
  return new THREE.ShaderMaterial({
    uniforms: { sunPos: { value: sunPos } },
    vertexShader: VERT,
    fragmentShader: NOISE_GLSL + /* glsl */`
uniform vec3 sunPos;
varying vec3 vP; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vP);
  float n = fbm(p * 1.5) + 0.3 * fbm(p * 5.0);
  float land = smoothstep(0.03, 0.07, n);
  float lat = abs(p.y);
  vec3 ocean = mix(vec3(0.004, 0.025, 0.09), vec3(0.01, 0.11, 0.25), smoothstep(-0.3, 0.05, n));
  float dry = smoothstep(0.05, 0.4, fbm(p * 2.6 + 7.0)) * (1.0 - smoothstep(0.3, 0.55, lat));
  vec3 ground = mix(vec3(0.05, 0.16, 0.03), vec3(0.42, 0.3, 0.13), dry);
  ground = mix(ground, vec3(0.22, 0.18, 0.14), smoothstep(0.28, 0.5, n));
  vec3 col = mix(ocean, ground, land);
  float ice = smoothstep(0.8, 0.86, lat + 0.06 * snoise(p * 7.0));
  col = mix(col, vec3(0.85, 0.9, 0.95), ice);

  vec3 N = normalize(vWN);
  vec3 L = normalize(sunPos - vWP);
  vec3 V = normalize(cameraPosition - vWP);
  float diff = dot(N, L);
  float light = smoothstep(-0.1, 0.45, diff);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 50.0) * (1.0 - land) * light;
  float city = smoothstep(0.45, 0.85, snoise(p * 38.0)) * smoothstep(0.2, 0.9, snoise(p * 9.0) + 0.6) * land * (1.0 - ice);
  vec3 night = vec3(1.0, 0.62, 0.25) * city * (1.0 - smoothstep(-0.25, 0.05, diff)) * 2.2;
  vec3 c = col * (0.015 + light * 1.2) + spec * vec3(0.9, 0.85, 0.7) * 0.8 + night;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += vec3(0.25, 0.5, 1.0) * rim * smoothstep(-0.3, 0.4, diff) * 0.7;
  gl_FragColor = vec4(c, 1.0);
}`,
  });
}

export function cloudMaterial(sunPos: THREE.Vector3 = SUN_POS) {
  return new THREE.ShaderMaterial({
    uniforms: { sunPos: { value: sunPos }, time: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: VERT,
    fragmentShader: NOISE_GLSL + /* glsl */`
uniform vec3 sunPos; uniform float time;
varying vec3 vP; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vP);
  float n = fbm(p * 2.4 + vec3(time * 0.004, 0.0, 0.0)) + 0.4 * fbm(p * 9.0);
  float a = smoothstep(0.08, 0.55, n);
  float light = smoothstep(-0.15, 0.4, dot(normalize(vWN), normalize(sunPos - vWP)));
  gl_FragColor = vec4(vec3(1.0) * (0.04 + light), a * 0.85);
}`,
  });
}

export function atmosphereMaterial(color = new THREE.Color(0.3, 0.6, 1.0), sunPos: THREE.Vector3 = SUN_POS) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color }, sunPos: { value: sunPos } },
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: VERT,
    fragmentShader: /* glsl */`
uniform vec3 color; uniform vec3 sunPos;
varying vec3 vP; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWP);
  // back faces: dot(N,V) is 0 at the outer edge and about -0.45 at Earth's limb
  float i = pow(clamp(-dot(N, V) * 1.9, 0.0, 1.0), 1.8);
  float lit = smoothstep(-0.5, 0.5, dot(N, normalize(sunPos - vWP)));
  gl_FragColor = vec4(color * i * (0.15 + 1.3 * lit), 1.0);
}`,
  });
}

// Rocky (moon / mars) or banded gas-giant planet.
function planetMaterial({ gas = false, c1, c2, c3, scale = 3 }: { gas?: boolean; c1: string; c2: string; c3: string; scale?: number }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunPos: { value: SUN_POS },
      c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, c3: { value: new THREE.Color(c3) },
      scale: { value: scale }, gas: { value: gas ? 1 : 0 },
    },
    vertexShader: VERT,
    fragmentShader: NOISE_GLSL + /* glsl */`
uniform vec3 sunPos; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float scale; uniform float gas;
varying vec3 vP; varying vec3 vWN; varying vec3 vWP;
void main(){
  vec3 p = normalize(vP);
  vec3 col;
  if (gas > 0.5) {
    float b = p.y * 9.0 + fbm(p * vec3(2.0, 6.0, 2.0)) * 1.2;
    col = mix(c1, c2, 0.5 + 0.5 * sin(b));
    col = mix(col, c3, smoothstep(0.6, 1.0, sin(b * 0.37 + 1.0)));
  } else {
    float n = fbm(p * scale);
    col = mix(c1, c2, smoothstep(-0.4, 0.4, n));
    float crater = smoothstep(0.55, 0.62, snoise(p * scale * 3.0));
    col = mix(col, c3, crater * 0.6);
  }
  vec3 N = normalize(vWN);
  float light = smoothstep(-0.08, 0.6, dot(N, normalize(sunPos - vWP)));
  gl_FragColor = vec4(col * (0.012 + light * 1.15), 1.0);
}`,
  });
}

function ringMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    uniforms: { inner: { value: 18 }, outer: { value: 33 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
uniform float inner; uniform float outer; varying vec3 vP;
void main(){
  float r = (length(vP.xy) - inner) / (outer - inner);
  float bands = 0.55 + 0.45 * sin(r * 60.0) * sin(r * 13.0 + 1.0);
  float gap = smoothstep(0.58, 0.6, r) * (1.0 - smoothstep(0.64, 0.66, r));
  float a = smoothstep(0.0, 0.05, r) * (1.0 - smoothstep(0.95, 1.0, r)) * bands * (1.0 - gap * 0.9);
  gl_FragColor = vec4(vec3(0.85, 0.76, 0.6) * 0.9, a * 0.85);
}`,
  });
}

function portalMaterial(c1: string, c2: string) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, hover: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
uniform float time; uniform vec3 c1; uniform vec3 c2; uniform float hover; varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float s = 0.5 + 0.5 * sin(a * 4.0 + r * 14.0 - time * (2.5 + hover * 4.0));
  float glow = 1.0 - smoothstep(0.0, 1.0, r);
  vec3 col = mix(c1, c2, s) * (0.25 + 0.75 * s) * glow * (1.0 + hover);
  col += c2 * pow(1.0 - r, 5.0) * 2.5;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}

// gate positions around Earth, in units of 20 along the camera's right / up
interface Slot { x: number; y: number }
const GATE_SLOTS: Slot[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0.8, y: 0.75 }, { x: -0.8, y: 0.75 }, { x: 0.8, y: -0.75 }, { x: -0.8, y: -0.75 }];

interface Portal {
  id: string;
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  discMat: THREE.ShaderMaterial;
  text: THREE.Sprite;
  slot: Slot;
  spin: number;
  hover: number;
}

export class SpaceScene implements BoothScene {
  era: string;
  bloom: { strength: number; radius: number; threshold: number };
  exposure: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: OrbitRig;
  sun: THREE.Mesh;
  earth: THREE.Group;
  earthSurface: THREE.Mesh;
  clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  moonPivot: THREE.Group;
  moon: THREE.Mesh;
  mars: THREE.Mesh;
  saturn: THREE.Group;
  portals: Portal[];
  portalsVisible: number;
  targets: SceneTarget[];
  occluders: Occluder[];
  focused: string;
  tmp: THREE.Vector3;
  tmp2: THREE.Vector3;
  homecoming?: { t: number; dur: number } | null;

  constructor(destinations: Destination[] = []) {
    this.era = 'space';
    this.bloom = { strength: 0.85, radius: 0.55, threshold: 0.7 };
    this.exposure = 1.0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000004);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 3000);
    this.rig = new OrbitRig(this.camera, {
      distance: 62, pitch: 0.12, yaw: 0, minDist: 8, maxDist: 400, autoSpin: 0.025,
      minPitch: -1.2, maxPitch: 1.2,
    });
    const s = this.scene;
    s.add(starfield({ count: 7000, radius: 1400, size: 2.2 }));

    // Sun
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2) }));
    this.sun.position.copy(SUN_POS);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,210,140,1)', 'rgba(255,120,40,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    sunGlow.scale.setScalar(380);
    this.sun.add(sunGlow);
    s.add(this.sun);

    // Earth
    this.earth = new THREE.Group();
    this.earthSurface = new THREE.Mesh(new THREE.SphereGeometry(10, 128, 64), earthMaterial());
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(10.12, 96, 48), cloudMaterial());
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(11.1, 64, 32), atmosphereMaterial());
    this.earthSurface.rotation.z = 0.41; // axial tilt
    this.clouds.rotation.z = 0.41;
    this.earth.add(this.earthSurface, this.clouds, atmo);
    s.add(this.earth);

    // Moon (orbits Earth)
    this.moonPivot = new THREE.Group();
    this.moonPivot.rotation.z = 0.09;
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(2.7, 64, 32), planetMaterial({ c1: '#3a3a3c', c2: '#8d8b86', c3: '#2a2a2b', scale: 2.5 }));
    this.moon.position.set(28, 0, 0);
    this.moonPivot.add(this.moon);
    s.add(this.moonPivot);

    // Mars
    this.mars = new THREE.Mesh(new THREE.SphereGeometry(5.3, 64, 32), planetMaterial({ c1: '#5a1d0b', c2: '#b4522a', c3: '#e8d6c8', scale: 2.2 }));
    this.mars.position.set(140, 12, -170);
    s.add(this.mars);

    // Saturn
    this.saturn = new THREE.Group();
    const saturnBody = new THREE.Mesh(new THREE.SphereGeometry(14, 64, 32), planetMaterial({ gas: true, c1: '#a88b5a', c2: '#d9c193', c3: '#7b6440' }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(18, 33, 160, 1), ringMaterial());
    ring.rotation.x = -Math.PI / 2;
    this.saturn.add(saturnBody, ring);
    this.saturn.rotation.set(0.45, 0, 0.2);
    this.saturn.position.set(-190, 75, -340);
    s.add(this.saturn);

    // Gates: one per destination, placed around Earth relative to the camera (right, left, then diagonals).
    this.portals = destinations.map((d, i) => this.makePortal(d.id, d.colors[0], d.colors[1], d.gate.label, GATE_SLOTS[i % GATE_SLOTS.length]));
    this.portalsVisible = 1;

    const t = (id: string, obj: THREE.Object3D, radius: number, info: CardInfo, extra: Partial<SceneTarget> = {}): SceneTarget => ({ id, obj, radius, tag: info.tag, tagEn: info.tagEn, info, ...extra });
    this.targets = [
      t('earth', this.earth, 10, SPACE.earth, { focus: 62, onSelect: () => this.focusEarth() }),
      t('moon', this.moon, 2.7, SPACE.moon, { focus: 14 }),
      t('mars', this.mars, 5.3, SPACE.mars, { focus: 24 }),
      t('saturn', this.saturn, 16, SPACE.saturn, { focus: 85 }),
      t('sun', this.sun, 40, SPACE.sun, { focus: 300 }),
      ...destinations.map((d, i) => t(`gate-${d.id}`, this.portals[i].group, 4.6, d.gate, { noTag: true, action: 'travel', to: d.id, enabled: () => this.portalsVisible > 0.5 })),
    ];
    this.occluders = [{ obj: this.earth, radius: 10.2 }, { obj: this.saturn, radius: 14 }, { obj: this.mars, radius: 5.3 }, { obj: this.moon, radius: 2.7 }];
    this.focused = 'earth';
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  makePortal(id: string, c1: string, c2: string, label: string[], slot: Slot): Portal {
    const group = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(c1).multiplyScalar(2.2), transparent: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.22, 16, 96), ringMat);
    const discMat = portalMaterial(c1, c2);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.3, 64), discMat);
    const text = textSprite(label, { glow: c1, scale: 11 });
    text.position.y = 7.6;
    group.add(ring, disc, text);
    this.scene.add(group);
    return { id, group, ring, ringMat, discMat, text, slot, spin: slot.x >= 0 ? 1 : -1, hover: 0 };
  }

  // Return trip: start far out and glide in until Earth fills the view (main waits for homecomingDone).
  startHomecoming(dur = 6) {
    this.focused = 'earth';
    this.rig.follow = this.earth;
    this.rig.dist = this.rig.goalDist = this.rig.maxDist;
    this.homecoming = { t: 0, dur };
  }
  get homecomingDone() { return !this.homecoming || this.homecoming.t >= this.homecoming.dur; }

  focusEarth() {
    this.focused = 'earth';
    this.rig.focusOn(this.earth, 62);
  }

  // Called by main when a target is selected (before the default handling).
  selected(target: SceneTarget) {
    if (target.id !== 'earth' && !target.action) this.focused = target.id;
  }

  // Fist / back button: if looking at another planet, return to Earth; otherwise nothing to do.
  back() {
    if (this.focused !== 'earth') { this.focusEarth(); return true; }
    return false;
  }
  canGoBack() { return this.focused !== 'earth'; }

  enter() {
    this.focused = 'earth';
    this.homecoming = null;
    this.rig.reset(true);
    this.rig.follow = this.earth;
  }
  exit() {}

  update(dt: number, t: number, hovered: Target | null) {
    this.earthSurface.rotation.y += dt * 0.03;
    this.clouds.rotation.y += dt * 0.036;
    this.clouds.material.uniforms.time.value = t;
    this.moonPivot.rotation.y += dt * 0.08;
    this.mars.rotation.y += dt * 0.05;
    this.saturn.children[0].rotation.y += dt * 0.08;
    if (this.homecoming) {
      const h = this.homecoming;
      h.t = Math.min(h.dur, h.t + dt);
      const k = h.t / h.dur, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.rig.dist = this.rig.goalDist = this.rig.maxDist + (16 - this.rig.maxDist) * e;
    }
    this.rig.update(dt);

    // keep the gates beside Earth, facing the camera
    const cam = this.camera;
    const right = this.tmp.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = this.tmp2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const goal = this.focused === 'earth' && !this.homecoming ? 1 : 0;
    this.portalsVisible += (goal - this.portalsVisible) * Math.min(1, dt * 3);
    for (const p of this.portals) {
      p.group.position.copy(this.earth.position).addScaledVector(right, 20 * p.slot.x).addScaledVector(up, 20 * p.slot.y);
      p.group.position.y += 1.5;
      p.group.quaternion.copy(cam.quaternion);
      const isHover = hovered && hovered.obj === p.group;
      p.hover += ((isHover ? 1 : 0) - p.hover) * Math.min(1, dt * 6);
      const sc = (0.85 + 0.15 * Math.sin(t * 2 + p.slot.x) * 0.3 + p.hover * 0.18) * this.portalsVisible;
      p.group.scale.setScalar(Math.max(sc, 0.0001));
      p.group.visible = this.portalsVisible > 0.02;
      p.discMat.uniforms.time.value = t;
      p.discMat.uniforms.hover.value = p.hover;
      p.ring.rotation.z += dt * (0.4 + p.hover * 2) * p.spin;
    }
  }
}
