// The moon-stone stall: one stop of phase 2 (design.md). Take stones from the bins if you like, drop them in the
// pouch, and leave by holding still on the shuttle sign. Nothing here is required.
import * as THREE from 'three';
import { DropGuide } from './guide.ts';
import type { StallInput } from './input.ts';
import { STONE_ENGINES } from './engines.ts';
import type { StoneEngineName } from './engines.ts';
import { BIN, KINDS, OBSTACLES, POUCH, POUCH_LIMIT, SURFACES, binWalls, binX, initialStones, pouchWalls, seeded } from './layout.ts';
import { MOON_G } from './stones.ts';
import type { Obstacle, StonePhysics, StoneView } from './stones.ts';

export const STALL_CONFIG = {
  engine: 'exact' as StoneEngineName, // the P key switches while running
  carryHeight: 0.62,  // m: a held stone travels on this plane, above the bin walls
  carrySmoothing: 12, // 1/s: how fast a held stone catches up with the hand
  // a stone let go while moving keeps the carry's velocity: averaged over throwAveraging so a twitch as the hand
  // opens doesn't count, and capped so it can't be flung across the room
  throwAveraging: 0.08, // s
  maxThrowSpeed: 1.5,   // m/s
  // the guide's arc jumps around while the hand moves, so it fades out between these speeds and shows only once
  // the stone is nearly still, where the drop it predicts is the one the visitor gets
  guideSpeed: [0.06, 0.2] as const, // m/s: fully shown below the first, gone above the second
  pickSlack: 1.8,     // a stone can be picked within this many radii of the pointer ray (hand jitter)
  dwellMs: 1400,      // holding still on the shuttle sign to leave
  restitution: 0.25,
};

type Phase = 'browsing' | 'boarded';

export class Stall {
  private phase: Phase = 'browsing';
  private physics: StonePhysics | null = null; // null while an engine loads
  private engine: StoneEngineName = STALL_CONFIG.engine;
  private generation = 0; // a reset that finishes after a newer one started is dropped
  private kindOf: number[] = [];
  private meshes: THREE.Mesh[] = [];
  private hovered: number | null = null;
  private held: number | null = null;
  private carry: THREE.Vector3 | null = null;
  private readonly carryVelocity = new THREE.Vector3();
  private wasClosed = false;
  private dwellStart: number | null = null;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly input: StallInput;
  private readonly ui: {
    cursor: HTMLElement; count: HTMLElement; board: HTMLElement; ring: HTMLElement; boarded: HTMLElement; dropLabel: HTMLElement; engine: HTMLElement;
  };
  // a held stone floats with no depth cue, so the guide shows where it would land
  private readonly guide = new DropGuide();

  constructor(canvas: HTMLCanvasElement, input: StallInput) {
    this.canvas = canvas;
    this.input = input;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    const $ = (id: string) => document.getElementById(id)!;
    this.ui = {
      cursor: $('cursor'), count: $('count'), board: $('board'), ring: $('board-ring'), boarded: $('boarded'), dropLabel: $('drop-label'), engine: $('engine'),
    };
    // tilted down only so far that the sky (and Earth) stays in view above the stall
    this.camera.position.set(0, 1.2, 1.6);
    this.camera.lookAt(0, 0.5, -0.6);
    this.buildScene();
    void this.reset();
    $('boarded').addEventListener('click', () => void this.reset());
    addEventListener('keydown', (e) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      this.engine = this.engine === 'exact' ? 'jolt' : 'exact';
      void this.reset();
    });
  }

  async reset() {
    const generation = ++this.generation;
    this.physics?.dispose();
    this.physics = null;
    for (const m of this.meshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.ui.engine.textContent = `${ENGINE_LABEL[this.engine]} (P: 切り替え / switch)`;
    const specs = initialStones();
    this.kindOf = specs.map((s) => s.kind);
    // each stone's turn is baked into its shape, so the hull handed to the physics matches what is drawn
    const rand = seeded(17);
    const geometries = specs.map((s) => lumpyStone(s.radius, rand)
      .applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6))));
    const physics = await STONE_ENGINES[this.engine]({
      gravity: MOON_G, restitution: STALL_CONFIG.restitution, surfaces: SURFACES, obstacles: OBSTACLES,
      stones: specs.map((s, i) => ({ ...s, hull: hullPoints(geometries[i]) })),
    });
    if (generation !== this.generation) { physics.dispose(); geometries.forEach((g) => g.dispose()); return; }
    this.physics = physics;
    this.meshes = specs.map((s, i) => {
      const mesh = new THREE.Mesh(geometries[i], stoneMaterial(KINDS[s.kind].color));
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    });
    this.phase = 'browsing';
    this.held = this.hovered = null;
    this.carry = null;
    this.dwellStart = null;
    this.ui.boarded.classList.add('hidden');
  }

  // ---------- each frame ----------
  update(realDt: number, now: number) {
    const dt = Math.min(realDt, 0.05);
    if (!this.physics) return;
    if (this.phase === 'browsing') this.interact(this.physics, dt, now);
    this.physics.advance(dt);
  }

  private interact(physics: StonePhysics, dt: number, now: number) {
    const p = this.input.pointer;
    const closed = this.input.closed && !!p;
    const ray = p ? this.rayAt(p.x, p.y) : null;

    if (this.held === null) {
      this.hovered = ray ? this.pick(physics, ray) : null;
      if (closed && !this.wasClosed && this.hovered !== null && physics.grab(this.hovered)) {
        this.held = this.hovered;
        const s = physics.stones()[this.held];
        this.carry = new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z);
        this.carryVelocity.set(0, 0, 0);
      }
    } else if (!closed) {
      physics.release(this.throwVelocity());
      this.held = null;
      this.carry = null;
    } else if (ray && this.carry) {
      const target = this.carryTarget(ray);
      const before = this.carry.clone();
      // exponential catch-up: the stone lifts out of the bin and follows the hand without jumping
      this.carry.lerp(target, 1 - Math.exp(-STALL_CONFIG.carrySmoothing * dt));
      if (dt > 0) {
        const v = this.carry.clone().sub(before).divideScalar(dt);
        this.carryVelocity.lerp(v, 1 - Math.exp(-dt / STALL_CONFIG.throwAveraging));
      }
      physics.moveHeld({ x: this.carry.x, y: this.carry.y, z: this.carry.z });
    }
    this.wasClosed = closed;

    // leaving: hold still (open hand, nothing held) on the shuttle sign
    const onBoard = !!p && this.held === null && !closed && this.overElement(this.ui.board, p.x, p.y);
    if (!onBoard) this.dwellStart = null;
    else if (this.dwellStart === null) this.dwellStart = now;
    const progress = this.dwellStart === null ? 0 : Math.min(1, (now - this.dwellStart) / STALL_CONFIG.dwellMs);
    this.ui.ring.style.setProperty('--p', String(progress));
    if (progress >= 1) this.board(physics);
  }

  private board(physics: StonePhysics) {
    this.phase = 'boarded';
    if (this.held !== null) { physics.release(); this.held = null; }
    const taken = this.collected(physics).map((s) => KINDS[this.kindOf[s.id]].name);
    this.ui.boarded.querySelector('.taken')!.textContent = taken.length
      ? `おみやげ: ${taken.join('、')} / Souvenirs: ${taken.length}`
      : 'おみやげなし。それもまた、旅です / No souvenirs this time';
    this.ui.boarded.classList.remove('hidden');
  }

  private collected(physics: StonePhysics): StoneView[] {
    return physics.stones().filter((s) => s.on === 'pouch' && s.status !== 'held');
  }

  // the stone nearest along the ray, within a generous radius so a jittery hand can still pick it
  private pick(physics: StonePhysics, ray: THREE.Ray): number | null {
    let best: number | null = null, bestT = Infinity;
    const c = new THREE.Vector3();
    for (const s of physics.stones()) {
      c.set(s.pos.x, s.pos.y, s.pos.z);
      const along = c.clone().sub(ray.origin).dot(ray.direction);
      if (along <= 0 || ray.distanceToPoint(c) > s.radius * STALL_CONFIG.pickSlack) continue;
      if (along < bestT) { bestT = along; best = s.id; }
    }
    return best;
  }

  private throwVelocity() {
    const v = this.carryVelocity.clone().clampLength(0, STALL_CONFIG.maxThrowSpeed);
    return { x: v.x, y: v.y, z: v.z };
  }

  private carryTarget(ray: THREE.Ray): THREE.Vector3 {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -STALL_CONFIG.carryHeight);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    // pointing above the horizon: keep the stone at the far edge of the stall
    return hit && hit.z > -1.2 ? hit : ray.at(2, new THREE.Vector3()).setY(STALL_CONFIG.carryHeight).setZ(-1.2);
  }

  private rayAt(x: number, y: number): THREE.Ray {
    const ndc = new THREE.Vector2(x / this.canvas.clientWidth * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.clone();
  }

  private overElement(el: HTMLElement, x: number, y: number) {
    const r = el.getBoundingClientRect(), c = this.canvas.getBoundingClientRect();
    return x + c.left >= r.left && x + c.left <= r.right && y + c.top >= r.top && y + c.top <= r.bottom;
  }

  // ---------- drawing ----------
  draw() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * devicePixelRatio)) {
      this.renderer.setPixelRatio(devicePixelRatio);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const physics = this.physics;
    if (physics) {
      for (const s of physics.stones()) {
        const m = this.meshes[s.id];
        m.position.set(s.pos.x, s.pos.y, s.pos.z);
        if (s.rot) m.quaternion.set(s.rot.x, s.rot.y, s.rot.z, s.rot.w);
        (m.material as THREE.MeshStandardMaterial).emissive.setHex(s.id === this.held ? 0x335566 : s.id === this.hovered ? 0x223344 : 0x000000);
      }
      this.drawGuide(physics);
      const n = this.collected(physics).length;
      this.ui.count.textContent = `おみやげ袋 ${n}個 / Pouch: ${n}`;
      this.ui.count.classList.toggle('over', n > POUCH_LIMIT);
    }
    const p = this.input.pointer;
    this.ui.cursor.classList.toggle('hidden', !p || this.phase !== 'browsing');
    if (p) {
      this.ui.cursor.style.transform = `translate(${p.x}px, ${p.y}px)`;
      this.ui.cursor.classList.toggle('glow', this.hovered !== null || this.held !== null);
      this.ui.cursor.classList.toggle('closed', this.input.closed);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private drawGuide(physics: StonePhysics) {
    const preview = this.held === null ? null : physics.dropPreview(this.throwVelocity());
    const stone = this.held === null ? null : physics.stones()[this.held];
    const [still, moving] = STALL_CONFIG.guideSpeed;
    const speed = this.carryVelocity.length();
    const alpha = Math.min(1, Math.max(0, (moving - speed) / (moving - still)));
    const intoPouch = preview?.on === 'pouch';
    this.ui.dropLabel.classList.toggle('hidden', !intoPouch || alpha < 0.5);
    if (!preview || !stone || this.held === null || alpha === 0) { this.guide.hide(); return; }
    this.guide.show(preview.path, preview.pos, stone.radius, this.meshes[this.held], intoPouch ? 0x7dff9a : 0xffffff);
    this.guide.fade(alpha);
    if (intoPouch) {
      const p = this.guide.spot.clone().project(this.camera);
      this.ui.dropLabel.style.transform =
        `translate(${(p.x + 1) / 2 * this.canvas.clientWidth}px, ${(1 - p.y) / 2 * this.canvas.clientHeight}px)`;
    }
  }

  private buildScene() {
    const { scene } = this;
    scene.add(this.guide.group);
    scene.background = new THREE.Color(0x020308);
    scene.add(new THREE.AmbientLight(0x8890a0, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2.5, 3, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
    scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(stars());
    scene.add(earth());

    KINDS.forEach((k, i) => scene.add(bin(i, k.color, signTexture(k.name, k.nameEn, k.caption, k.captionEn))));
    scene.add(pouch());
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicMaterial({
      map: signTexture('ご自由にお取りください', 'Free - please take some', `おひとり${POUCH_LIMIT}個まで`, `Limit ${POUCH_LIMIT} per visitor`),
    }));
    banner.position.set(0, 0.7, BIN.z - BIN.depth / 2 - 0.02);
    scene.add(banner);
  }
}

// ---------- props ----------
function lumpyStone(radius: number, rand: () => number) {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.82 + rand() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function stoneMaterial(color: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
}

function solid(box: Obstacle, material: THREE.Material) {
  const { min, max } = box;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z), material);
  mesh.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// the walls are the very boxes the physics collides with (layout.ts)
function bin(i: number, accent: number, sign: THREE.Texture) {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6 });
  const { width: w, depth: d, floor: f, front, thickness: t } = BIN;
  const x = binX(i), z = BIN.z;
  group.add(solid({ min: { x: x - w / 2, y: 0, z: z - d / 2 }, max: { x: x + w / 2, y: f, z: z + d / 2 } }, body));
  for (const wall of binWalls(i)) group.add(solid(wall, body));
  group.add(solid({ min: { x: x - w / 2 - 0.002, y: front - 0.035, z: z + d / 2 - t / 2 - 0.002 }, max: { x: x + w / 2 + 0.002, y: front, z: z + d / 2 + t / 2 + 0.002 } },
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })));
  const label = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, 0.17), new THREE.MeshBasicMaterial({ map: sign }));
  label.position.set(x, 0.13, z + d / 2 + t / 2 + 0.002);
  group.add(label);
  return group;
}

function pouch() {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.9 });
  const fp = POUCH.footprint;
  group.add(solid({ min: { x: fp.minX, y: 0, z: fp.minZ }, max: { x: fp.maxX, y: POUCH.floor, z: fp.maxZ } }, cloth));
  for (const wall of pouchWalls()) group.add(solid(wall, cloth));
  return group;
}

/** the vertices of a stone mesh, for the physics' convex hull */
function hullPoints(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  return Array.from({ length: pos.count }, (_, i) => ({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) }));
}

const ENGINE_LABEL: Record<StoneEngineName, string> = {
  exact: 'physics: exact (no rolling)',
  jolt: 'physics: Jolt Physics',
};

function stars() {
  const rand = seeded(5);
  const pts: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    if (u < 0.02) continue; // only above the horizon
    pts.push(200 * s * Math.cos(a), 200 * u, 200 * s * Math.sin(a));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: false }));
}

// From a near-side base Earth hangs in about the same spot in the sky; its real apparent size is about 1.9 degrees.
function earth() {
  const dist = 120, radius = dist * Math.tan((1.9 / 2) * Math.PI / 180);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshStandardMaterial({
    color: 0x3b7bd8, emissive: 0x0b1d3a, roughness: 0.7,
  }));
  sphere.position.set(0.12, 0.1, -1).normalize().multiplyScalar(dist);
  return sphere;
}

function signTexture(title: string, titleEn: string, line: string, lineEn: string) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 384;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f4ec';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1d2433';
  ctx.textAlign = 'center';
  const font = (px: number, bold = false) => `${bold ? 'bold ' : ''}${px}px system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif`;
  ctx.font = font(78, true);
  ctx.fillText(title, 512, 100);
  ctx.font = font(50);
  ctx.fillStyle = '#4b5468';
  ctx.fillText(titleEn, 512, 170);
  ctx.fillStyle = '#1d2433';
  ctx.font = font(52);
  ctx.fillText(line, 512, 265);
  ctx.font = font(42);
  ctx.fillStyle = '#4b5468';
  ctx.fillText(lineEn, 512, 330);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
