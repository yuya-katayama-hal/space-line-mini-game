// Earth, 2126: a seaside launch site at dawn. The turn starts here (rocket on the pad, liftoff)
// and ends here (the return capsule floats down under parachutes).
import * as THREE from 'three';
import { OrbitRig, skyDome, Smoke, glowTexture, seeded, enableShadows } from '../util.ts';
import type { Emitter, Random } from '../util.ts';
import type { BoothScene, Occluder, SceneTarget } from '../scene.ts';

const SUN_DIR = new THREE.Vector3(0.9, 0.12, -0.5).normalize();
const LANDING = new THREE.Vector3(34, 0, 26); // where the capsule touches down

const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
const glowSprite = (color: THREE.ColorRepresentation, size: number) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
};
const lathe = (pts: number[][], mat: THREE.Material, seg = 40) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);

export class LaunchScene implements BoothScene {
  era: string;
  bloom: { strength: number; radius: number; threshold: number };
  exposure: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: OrbitRig;
  targets: SceneTarget[];
  occluders: Occluder[];
  rand: Random;
  mode: 'ready' | 'liftoff' | 'landing' | 'landed';
  time: number;
  smoke: Smoke;
  exhaust: Emitter;
  dust: Emitter;
  // built by the build*() methods the constructor calls
  beacon!: THREE.Sprite;
  arm!: THREE.Group;
  flame!: THREE.Group;
  rocket!: THREE.Group;
  chutes!: THREE.Group;
  capsule!: THREE.Group;

  constructor() {
    this.era = 'launch';
    this.bloom = { strength: 0.7, radius: 0.5, threshold: 0.85 };
    this.exposure = 1.0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 3000);
    this.rig = new OrbitRig(this.camera, {
      target: new THREE.Vector3(0, 17, 0), distance: 78, pitch: 0.12, yaw: 0.55,
      minPitch: 0.02, maxPitch: 0.9, minDist: 30, maxDist: 150, autoSpin: 0.02,
    });
    this.targets = []; // nothing to select here: the only way to launch is the down-to-up swipe
    this.occluders = [];
    this.rand = seeded(2026);
    this.mode = 'ready'; // ready | liftoff | landing | landed
    this.time = 0;
    const s = this.scene;

    s.fog = new THREE.Fog(0xe0a080, 220, 900);
    s.add(skyDome('#0c1f55', '#ffa66b', 1200, 0.5));
    const sunGlow = glowSprite(0xffd2a0, 300);
    sunGlow.material.fog = false;
    sunGlow.position.copy(SUN_DIR).multiplyScalar(1000);
    s.add(sunGlow);

    s.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a2a22, 0.9));
    const sun = new THREE.DirectionalLight(0xffc8a0, 2.4);
    sun.position.copy(SUN_DIR).multiplyScalar(150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 400 });
    sun.shadow.bias = -0.0004;
    s.add(sun);

    this.buildLand();
    this.buildPad();
    this.buildRocket();
    this.buildCapsule();
    this.smoke = new Smoke(s, { count: 220, color: 0xf2ece6, opacity: 0.65, life: 6, rise: 2.5, grow: 4 });
    this.exhaust = this.smoke.addEmitter(() => this.exhaustPos(), 0, 7);
    this.dust = this.smoke.addEmitter(() => LANDING.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0.5, (Math.random() - 0.5) * 6)), 0, 3);

    enableShadows(s);
  }

  // ---------- island, sea, hills ----------
  buildLand() {
    const s = this.scene;
    const sea = new THREE.Mesh(new THREE.CircleGeometry(2400, 64), new THREE.MeshStandardMaterial({ color: 0x1d4a78, metalness: 0.6, roughness: 0.25 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.6;
    s.add(sea);
    const land = new THREE.Mesh(new THREE.CircleGeometry(150, 96), new THREE.MeshStandardMaterial({ color: 0x5b7a3e, roughness: 0.95 }));
    land.rotation.x = -Math.PI / 2;
    s.add(land);
    const beach = new THREE.Mesh(new THREE.RingGeometry(150, 158, 96), new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = -0.2;
    s.add(beach);
    const r = this.rand;
    const hill = new THREE.MeshStandardMaterial({ color: 0x47622f, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = r(Math.PI * 0.55, Math.PI * 1.45), d = r(95, 140), h = r(8, 22);
      const m = new THREE.Mesh(new THREE.ConeGeometry(r(14, 26), h, 7), hill);
      m.position.set(Math.cos(a) * d, h / 2 - 0.5, Math.sin(a) * d);
      s.add(m);
    }
    // road to the pad
    const road = box(5, 0.1, 90, new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.9 }), -30, 0.05, 30);
    road.rotation.y = 0.6;
    s.add(road);
  }

  buildPad() {
    const s = this.scene;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9b9890, roughness: 0.9 });
    const pad = cyl(16, 17, 1.2, concrete, 48);
    pad.position.y = 0.6;
    s.add(pad);
    s.add(box(6, 1.4, 22, new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 1 }), 0, 0.6, 9)); // flame trench
    // umbilical tower
    const steel = new THREE.MeshStandardMaterial({ color: 0xc8532f, metalness: 0.4, roughness: 0.5 });
    const tower = new THREE.Group();
    tower.position.set(-9, 1.2, 0);
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) tower.add(box(0.5, 46, 0.5, steel, x, 23, z));
    for (let y = 2; y < 46; y += 3.5) {
      tower.add(box(4.5, 0.3, 0.3, steel, 0, y, -2), box(4.5, 0.3, 0.3, steel, 0, y, 2));
      tower.add(box(0.3, 0.3, 4.5, steel, -2, y, 0), box(0.3, 0.3, 4.5, steel, 2, y, 0));
    }
    tower.add(box(5, 1.2, 5, steel, 0, 46.6, 0));
    const beacon = glowSprite(0xff4040, 3);
    beacon.position.y = 48;
    tower.add(beacon);
    this.beacon = beacon;
    this.arm = new THREE.Group();
    this.arm.position.set(2, 30, 0);
    this.arm.add(box(6.5, 1, 1.2, steel, 3.25, 0, 0));
    tower.add(this.arm);
    s.add(tower);
    // floodlights
    for (const [x, z] of [[18, 14], [-18, 16], [16, -16], [-20, -14]]) {
      const pole = cyl(0.25, 0.35, 14, new THREE.MeshStandardMaterial({ color: 0xbfc4ca }), 8);
      pole.position.set(x, 7, z);
      s.add(pole);
      const l = glowSprite(0xfff1d6, 5);
      l.position.set(x, 14.5, z);
      s.add(l);
    }
  }

  buildRocket() {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, metalness: 0.2, roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.4, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, metalness: 0.3, roughness: 0.4 });
    const rocket = new THREE.Group();
    rocket.add(lathe([[0, 0], [2.0, 0], [2.0, 30], [1.95, 33], [1.5, 36.5], [0.7, 38.6], [0, 39.4]], white));
    const band = cyl(2.03, 2.03, 1.2, accent, 40);
    band.position.y = 26;
    rocket.add(band);
    const engine = cyl(1.2, 1.7, 1.6, dark, 24);
    engine.position.y = -0.6;
    rocket.add(engine);
    for (const side of [-1, 1]) { // solid boosters
      const b = new THREE.Group();
      b.position.set(side * 2.9, 0, 0);
      b.add(lathe([[0, 0], [0.9, 0], [0.9, 13], [0.5, 15], [0, 15.6]], white, 24));
      const n = cyl(0.6, 0.85, 1, dark, 16);
      n.position.y = -0.5;
      b.add(n);
      rocket.add(b);
    }
    this.flame = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.8, 14, 20, 1, true), new THREE.MeshBasicMaterial({
      color: hdr(0xffa060, 2.6), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    cone.rotation.x = Math.PI;
    cone.position.y = -7.5;
    this.flame.add(cone, glowSprite(0xffc080, 22));
    this.flame.children[1].position.y = -3;
    this.flame.visible = false;
    rocket.add(this.flame);
    rocket.position.y = 2.6;
    this.rocket = rocket;
    this.scene.add(rocket);

  }

  buildCapsule() {
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xe9ecf1, metalness: 0.3, roughness: 0.4 });
    const shield = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.9 });
    g.add(lathe([[0, 0], [2.4, 0.2], [2.2, 1.2], [1.1, 3.6], [0.6, 4.0], [0, 4.0]], shell));
    const heat = cyl(2.45, 2.2, 0.45, shield, 32);
    heat.position.y = 0.1;
    g.add(heat);
    g.add(box(0.7, 0.5, 0.1, new THREE.MeshBasicMaterial({ color: hdr(0x9ff8ff, 1.6) }), 0, 2.2, 1.65));
    // three parachutes on lines
    this.chutes = new THREE.Group();
    const cloth = [0xff7a3c, 0xffffff, 0xff7a3c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }));
    const line = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const c = new THREE.Group();
      c.position.set(Math.cos(a) * 4.2, 15, Math.sin(a) * 4.2);
      c.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), cloth[i]);
      canopy.scale.y = 0.6;
      c.add(canopy);
      this.chutes.add(c);
      const len = c.position.distanceTo(new THREE.Vector3(0, 4, 0));
      const l = cyl(0.04, 0.04, len, line, 4);
      l.position.copy(c.position).add(new THREE.Vector3(0, 4, 0)).multiplyScalar(0.5);
      l.lookAt(c.position);
      l.rotateX(Math.PI / 2);
      this.chutes.add(l);
    }
    g.add(this.chutes);
    g.visible = false;
    this.capsule = g;
    this.scene.add(g);
  }

  exhaustPos() {
    const p = this.rocket.position;
    return new THREE.Vector3(p.x + (Math.random() - 0.5) * 8, Math.max(1.5, p.y - 4), p.z + 6 + (Math.random() - 0.5) * 8);
  }

  // ---------- sequence controls (called by main) ----------
  get landed() { return this.mode === 'landed'; }

  liftoff() {
    if (this.mode !== 'ready') return;
    this.mode = 'liftoff';
    this.time = 0;
    this.flame.visible = true;
    this.exhaust.rate = 40;
    this.rig.focusOn(this.rocket, 95);
  }

  startLanding() {
    this.mode = 'landing';
    this.time = 0;
    this.rocket.visible = false;
    this.capsule.visible = true;
    this.capsule.position.set(LANDING.x, 150, LANDING.z);
    this.chutes.scale.set(1, 1, 1);
    this.chutes.rotation.set(0, 0, 0);
    this.rig.reset(true);
    this.rig.focusOn(this.capsule, 55);
    this.rig.dist = 55;
    this.rig.target.copy(this.capsule.position);
  }

  reset() {
    this.mode = 'ready';
    this.time = 0;
    this.rocket.visible = true;
    this.rocket.position.y = 2.6;
    this.flame.visible = false;
    this.capsule.visible = false;
    this.exhaust.rate = 0;
    this.dust.rate = 0;
    this.arm.rotation.y = 0;
    this.rig.reset(true);
  }

  back() { return false; }
  canGoBack() { return false; }
  selected() {}
  enter() {}
  exit() {}

  update(dt: number, t: number) {
    this.time += dt;
    const k = this.time;
    if (this.mode === 'liftoff') {
      this.arm.rotation.y = Math.min(1.4, k * 1.2); // swing the arm away
      this.rocket.position.y = 2.6 + 1.6 * Math.pow(k, 2.4);
      this.flame.scale.setScalar(1 + 0.08 * Math.sin(t * 50));
      this.exhaust.rate = k < 4 ? 40 : 0;
    } else if (this.mode === 'landing') {
      const dur = 9;
      const e = Math.min(1, k / dur);
      this.capsule.position.y = 150 * Math.pow(1 - e, 1.6);
      this.capsule.rotation.z = Math.sin(t * 1.3) * 0.05 * (1 - e);
      if (e >= 1) {
        this.mode = 'landed';
        this.time = 0;
        this.dust.rate = 30;
      }
    } else if (this.mode === 'landed') {
      // canopies sag and drift down beside the capsule
      const s = Math.max(0.15, 1 - k * 0.6);
      this.chutes.scale.set(1, s, 1);
      this.chutes.rotation.z = Math.min(0.9, k * 0.5);
      if (k > 1.2) this.dust.rate = 0;
    }
    this.beacon.material.opacity = Math.sin(t * 3) > 0 ? 1 : 0.2;
    this.smoke.update(dt);
    this.rig.update(dt);
  }
}
