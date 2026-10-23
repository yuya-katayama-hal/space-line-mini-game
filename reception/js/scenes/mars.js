// Mars in 2126, the story's present (speculative), at dusk: 3D-printed homes, an oxygen plant, a helicopter drone, a dust devil,
// Olympus Mons on the horizon, a blue sunset (as Mars really has), and Earth as a small evening star.
import * as THREE from 'three';
import { OrbitRig, starfield, skyDome, hotspotMarker, seeded, glowTexture, textSprite } from '../util.js';
import { MARS } from '../content.js';

// sun and Earth sit in the clear sky between the year header and Olympus Mons in the default view
const SUN_DIR = new THREE.Vector3(0.14, 0.025, -0.99).normalize(); // setting on the horizon
const LIGHT_DIR = new THREE.Vector3(0.3, 0.3, -0.9).normalize();    // the light comes from a bit higher, so the base isn't all in shadow
const EARTH_POS = new THREE.Vector3(85, 70, -860);                  // the evening star, just above the sun
const HUB = { x: -8, z: 6 };
const OXY = { x: 26, z: 16 };
const SOLAR = { x: -32, z: -16 };
const HOLO = { x: -22, z: 32 };
const DEVIL = { z: -30, rx: 52, rz: 34 }; // the dust devil wanders behind the base: x ±52, z −30 … −64
const PADS = [ // ground flattened for buildings: [x, z, radius]
  [HUB.x, HUB.z, 15], [OXY.x, OXY.z, 8], [SOLAR.x, SOLAR.z, 9], [HOLO.x, HOLO.z, 3],
];

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const cyl = (rt, rb, h, mat, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
const glowSprite = (color, size, blending = THREE.AdditiveBlending) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending }));
  s.scale.setScalar(size);
  return s;
};

export class MarsScene {
  constructor() {
    this.era = 'mars';
    this.bloom = { strength: 0.75, radius: 0.5, threshold: 0.88 };
    this.exposure = 1.0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 3000);
    this.rig = new OrbitRig(this.camera, {
      target: new THREE.Vector3(0, 2, 2), distance: 72, pitch: 0.3, yaw: 0,
      minPitch: 0.08, maxPitch: 1.25, minDist: 20, maxDist: 160, autoSpin: 0.03,
    });
    this.targets = [];
    this.markers = [];
    this.occluders = [];
    this.blinkers = [];
    this.rand = seeded(2126 + 4);
    this.tmp = new THREE.Vector3();
    const s = this.scene;

    // thin, dusty air at dusk: a butterscotch haze near the ground, a dim violet sky above
    s.fog = new THREE.Fog(0xb8714c, 160, 1300);
    s.add(skyDome('#2c2238', '#d0835a', 1500, 0.45));
    const stars = starfield({ count: 1500, radius: 1200, size: 1.6, band: false });
    stars.material.fog = false;
    stars.material.opacity = 0.6;
    s.add(stars);

    s.add(new THREE.HemisphereLight(0xb08a90, 0x4a2216, 0.9));
    const sun = new THREE.DirectionalLight(0xffe0c0, 2.2);
    sun.position.copy(LIGHT_DIR).multiplyScalar(160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 360 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    s.add(sun);

    this.makeCraters();
    this.buildTerrain();
    this.buildRocks();
    this.buildSky();
    this.buildOlympus();
    this.buildMesas();
    this.buildHomes();
    this.buildOxygen();
    this.buildSolar();
    this.buildHolo();
    this.buildDrone();
    this.buildDustDevil();

    s.traverse((o) => {
      if (o.isMesh && !o.material.transparent && !o.material.isMeshBasicMaterial && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  addHotspot(id, parent, localPos, extra = {}) {
    const m = hotspotMarker(0x9ff8ff, extra.markerSize || 2.6);
    m.position.copy(localPos);
    parent.add(m);
    this.markers.push(m);
    const info = MARS[id];
    this.targets.push({ id, obj: m, radius: 2.6, tag: info.tag, tagEn: info.tagEn, info, focus: 40, ...extra });
  }

  // ---------- ground: dunes, a few craters, rocks ----------
  makeCraters() {
    const r = this.rand;
    this.craters = [];
    const clear = (x, z, cr) => PADS.every(([px, pz, pr]) => Math.hypot(x - px, z - pz) > pr + cr * 1.6);
    for (let i = 0, n = 0; i < 400 && n < 16; i++) {
      const a = r(0, Math.PI * 2), d = Math.sqrt(r(0.05, 1)) * 58, cr = r(1.5, 6);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!clear(x, z, cr)) continue;
      this.craters.push({ x, z, r: cr, d: cr * r(0.2, 0.3), rim: cr * r(0.06, 0.12) });
      n++;
    }
    for (let i = 0; i < 30; i++) {
      const cr = r(8, 35), a = r(0, Math.PI * 2), d = r(62 + cr * 1.6, 700);
      this.craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: cr, d: cr * r(0.1, 0.18), rim: cr * r(0.03, 0.06) });
    }
  }

  height(x, z) {
    // wind-carved dune ridges (skewed so they don't look like regular ripples) on broad swells
    const u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;
    const dune = Math.pow(Math.abs(Math.sin(u * 0.16 + 0.8 * Math.sin(v * 0.045))), 1.6) * (0.5 + 0.5 * Math.sin(v * 0.03 + 1.1));
    let h = 0.9 * Math.sin(x * 0.035 + 0.4) * Math.sin(z * 0.04 + 1.7) + 0.7 * dune;
    for (const c of this.craters) {
      const dx = x - c.x, dz = z - c.z;
      const q2 = (dx * dx + dz * dz) / (c.r * c.r);
      if (q2 > 2.56) continue;
      if (q2 < 1) h += c.d * (q2 - 1) + c.rim * q2 * q2 * q2;
      else { const k = (Math.sqrt(q2) - 1) / 0.6; h += c.rim * (1 - k) * (1 - k); }
    }
    for (const [px, pz, pr] of PADS) h *= smooth((Math.hypot(x - px, z - pz) - pr) / 5);
    return h - (x * x + z * z) / 8000;
  }

  // rust-red dust with darker basalt patches (linear RGB)
  shade(x, z) {
    const basalt = smooth((Math.sin(x * 0.023 + 0.7) * Math.sin(z * 0.019 + 2.2) - 0.15) / 0.5);
    const speck = 0.04 * Math.sin(x * 2.1 + z * 1.3) * Math.sin(x * 0.9 - z * 2.7);
    const k = 1 - 0.45 * basalt + speck;
    return [0.42 * k, 0.12 * k, 0.045 * k];
  }

  buildTerrain() {
    // one disc: fine rings out to r = 62, then rings that widen out to the horizon
    const geo = new THREE.RingGeometry(0.001, 1, 220, 160);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const x0 = pos.getX(i), z0 = pos.getZ(i);
      const t = Math.hypot(x0, z0);
      const rad = t <= 0.625 ? (t / 0.625) * 62 : 62 * Math.pow(1200 / 62, (t - 0.625) / 0.375);
      const k = t > 0 ? rad / t : 0;
      const x = x0 * k, z = z0 * k;
      pos.setXYZ(i, x, this.height(x, z), z);
      col.push(...this.shade(x, z));
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
  }

  buildRocks() {
    const r = this.rand;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6b3220, roughness: 1, flatShading: true }), 380);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < 3000 && n < 380; i++) {
      const a = r(0, Math.PI * 2), d = r(3, 60), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!PADS.every(([px, pz, pr]) => Math.hypot(x - px, z - pz) > pr + 1)) continue;
      const k = r() < 0.88 ? r(0.15, 0.55) : r(0.7, 1.6);
      p.set(x, this.height(x, z) - k * 0.25, z);
      q.setFromEuler(new THREE.Euler(r(0, 3), r(0, 3), r(0, 3)));
      sc.set(k, k * r(0.5, 0.8), k * r(0.8, 1.2));
      rocks.setMatrixAt(n++, m4.compose(p, q, sc));
    }
    rocks.count = n;
    this.scene.add(rocks);
  }

  // ---------- the sky: a small sun with a blue halo, and Earth as the evening star ----------
  buildSky() {
    const sunPos = SUN_DIR.clone().multiplyScalar(900);
    for (const [color, size] of [[0x7fb0ff, 170], [0xcfe2ff, 50], [0xffffff, 16]]) { // the blue sunset glow
      const g = glowSprite(color, size);
      g.material.fog = false;
      g.position.copy(sunPos);
      this.scene.add(g);
    }
    this.earth = new THREE.Group();
    this.earth.position.copy(EARTH_POS);
    for (const [color, size] of [[0x8fc8ff, 26], [0xffffff, 7]]) {
      const g = glowSprite(color, size);
      g.material.fog = false;
      this.earth.add(g);
    }
    this.scene.add(this.earth);
    const info = MARS.earth;
    this.targets.push({ id: 'earth', obj: this.earth, radius: 10, tag: info.tag, tagEn: info.tagEn, info });
  }

  // ---------- Olympus Mons: a vast, gentle shield volcano on the horizon ----------
  buildOlympus() {
    const profile = [[0, 62], [26, 60], [34, 64], [70, 62], [180, 40], [260, 16], [300, 6], [312, -12], [0, -12]]
      .map(([x, y]) => new THREE.Vector2(x, y)); // caldera, gentle flanks, the cliff around its base
    const mons = new THREE.Mesh(new THREE.LatheGeometry(profile.reverse(), 72), new THREE.MeshStandardMaterial({ color: 0x8a4428, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
    mons.position.set(340, -6, -900);
    mons.userData.noShadow = true;
    this.scene.add(mons);
    const summit = new THREE.Object3D();
    summit.position.set(0, 70, 0);
    mons.add(summit);
    this.addHotspot('olympus', summit, new THREE.Vector3(0, 18, 0), { markerSize: 26, radius: 40, focus: undefined });
  }

  buildMesas() {
    const r = this.rand;
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a3a22, roughness: 1, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = r(Math.PI * 0.8, Math.PI * 2.2), d = r(260, 520), w = r(20, 55), h = r(10, 28);
      const m = cyl(w * 0.8, w, h, mat, 7);
      m.position.set(Math.cos(a) * d, h / 2 - 4, Math.sin(a) * d);
      m.rotation.y = r(0, 3);
      m.userData.noShadow = true;
      this.scene.add(m);
    }
  }

  // ---------- 3D-printed homes from Martian soil, with a greenhouse ----------
  buildHomes() {
    const g = new THREE.Group();
    g.position.set(HUB.x, this.height(HUB.x, HUB.z), HUB.z);
    // printed layers: fine horizontal stripes
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const cg = c.getContext('2d');
    for (let y = 0; y < 64; y += 8) { cg.fillStyle = '#b3653f'; cg.fillRect(0, y, 4, 5); cg.fillStyle = '#8f4a2c'; cg.fillRect(0, y + 5, 4, 3); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 10);
    const printed = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.4, roughness: 0.35 });
    const windows = new THREE.MeshBasicMaterial({ color: hdr(0xffcf8a, 2.2) });
    const homes = [[0, 0, 4.2], [9, -4, 3.2], [-8, 3, 3.4], [2, 9, 2.8]];
    for (const [x, z, r] of homes) {
      const shell = new THREE.Mesh(new THREE.LatheGeometry(
        [[0, 0], [r, 0], [r * 1.02, r * 0.5], [r * 0.9, r * 1.15], [r * 0.6, r * 1.55], [0.01, r * 1.75]].map(([a, b]) => new THREE.Vector2(a, b)), 40), printed);
      shell.position.set(x, 0, z);
      g.add(shell);
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, 0.1, 6, 48), windows);
      band.rotation.x = -Math.PI / 2;
      band.position.set(x, r * 0.5, z);
      g.add(band);
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (const [x, z] of [...homes.slice(1), [-3, -9]]) {
      const dir = new THREE.Vector3(x, 0, z);
      const tube = cyl(0.85, 0.85, dir.length(), metal, 16);
      tube.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      tube.position.set(x / 2, 0.85, z / 2);
      g.add(tube);
    }
    // greenhouse
    const gh = new THREE.Group();
    gh.position.set(-3, 0, -9);
    gh.add(new THREE.Mesh(new THREE.SphereGeometry(3.6, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xbff5ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false })));
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3aa860, emissive: 0x3dff86, emissiveIntensity: 0.7, roughness: 0.8 });
    for (let i = -2; i <= 2; i++) gh.add(box(0.7, 0.8, 4.4 - Math.abs(i) * 0.7, leaf, i * 1.15, 0.4, 0)); // planting rows
    gh.add(at(glowSprite(0x7dffa8, 7.5), 0, 1.6, 0));
    g.add(gh);
    this.scene.add(g);
    this.addHotspot('base', g, new THREE.Vector3(0, 10, 0), { focus: 45 });
  }

  // ---------- oxygen plant: turns the CO2 air into breathable oxygen ----------
  buildOxygen() {
    const g = new THREE.Group();
    g.position.set(OXY.x, this.height(OXY.x, OXY.z), OXY.z);
    const white = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 0.35, roughness: 0.35 });
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xcfe3ff, metalness: 0.5, roughness: 0.25 });
    g.add(box(6, 3.6, 4, white, 0, 1.8, 0));
    for (const [x, z] of [[-4.6, -1.5], [-4.6, 1.8], [4.4, 0]]) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16), tankMat);
      t.position.set(x, 1.6, z);
      g.add(t);
      g.add(at(cyl(0.2, 0.2, 1.4, white, 8), x, 0.4, z));
    }
    // air intake with a spinning fan
    const intake = cyl(1.6, 1.6, 1.2, white, 32);
    intake.rotation.x = Math.PI / 2;
    intake.position.set(0, 2.2, 2.6);
    g.add(intake);
    this.fan = new THREE.Group();
    this.fan.position.set(0, 2.2, 3.25);
    for (let k = 0; k < 4; k++) {
      const blade = box(0.25, 1.4, 0.05, new THREE.MeshBasicMaterial({ color: hdr(0x5ff2ff, 1.6) }), 0, 0.7, 0);
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      arm.add(blade);
      this.fan.add(arm);
    }
    g.add(this.fan);
    const sign = textSprite(['O₂'], { glow: '#7ff6ff', scale: 5 });
    sign.position.set(0, 6.2, 0);
    g.add(sign);
    this.scene.add(g);
    this.addHotspot('oxygen', g, new THREE.Vector3(0, 9.5, 0), { focus: 36 });
    // pipe to the homes
    const from = new THREE.Vector2(OXY.x - 3, OXY.z), to = new THREE.Vector2(HUB.x + 9, HUB.z - 4);
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const v = from.clone().lerp(to, i / 30);
      pts.push(new THREE.Vector3(v.x, this.height(v.x, v.y) + 0.35, v.y));
    }
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.22, 8), white));
  }

  buildSolar() {
    const g = new THREE.Group();
    g.position.set(SOLAR.x, this.height(SOLAR.x, SOLAR.z), SOLAR.z);
    const panel = new THREE.MeshStandardMaterial({ color: 0x1b2f6a, metalness: 0.8, roughness: 0.25, emissive: 0x0a1a55, emissiveIntensity: 0.4 });
    const leg = new THREE.MeshStandardMaterial({ color: 0xbfc4ca });
    const face = Math.atan2(LIGHT_DIR.x, LIGHT_DIR.z);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const p = new THREE.Group();
        p.position.set((col - 1.5) * 4.4, 0, (row - 1) * 4.2);
        p.rotation.y = face;
        p.add(at(cyl(0.12, 0.12, 1.4, leg, 6), 0, 0.7, 0));
        const s = box(4, 0.1, 2.4, panel, 0, 1.5, 0);
        s.rotation.x = -0.9;
        p.add(s);
        g.add(p);
      }
    }
    this.scene.add(g);
  }

  // ---------- hologram of Mars (facts) ----------
  buildHolo() {
    const g = new THREE.Group();
    g.position.set(HOLO.x, this.height(HOLO.x, HOLO.z), HOLO.z);
    g.add(at(cyl(1.6, 2.1, 1, new THREE.MeshStandardMaterial({ color: 0xdfe6f0, metalness: 0.4, roughness: 0.3 }), 32), 0, 0.5, 0));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 1.3, 5, 32, 1, true), new THREE.MeshBasicMaterial({
      color: hdr(0xff9a5c, 0.5), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    beam.position.y = 3.5;
    g.add(beam);
    this.holo = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 3), new THREE.MeshBasicMaterial({ color: hdr(0xff9a5c, 1.8), wireframe: true, transparent: true, opacity: 0.8 }));
    this.holo.position.y = 6.4;
    g.add(this.holo);
    this.scene.add(g);
    this.addHotspot('data', g, new THREE.Vector3(0, 10.5, 0), { focus: 30 });
  }

  // ---------- helicopter drone (Ingenuity's descendants) ----------
  buildDrone() {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a23f, metalness: 0.8, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.4, roughness: 0.5 });
    g.add(box(1.1, 0.9, 1.1, gold));
    g.add(box(1.8, 0.06, 1.2, new THREE.MeshStandardMaterial({ color: 0x1b2f6a, metalness: 0.8, roughness: 0.25 }), 0, 2.4, 0));
    g.add(at(cyl(0.06, 0.06, 2.0, dark, 6), 0, 1.4, 0));
    this.rotors = [];
    for (const [y, dir] of [[1.6, 1], [2.05, -1]]) {
      const r = new THREE.Group();
      r.position.y = y;
      r.add(box(4.2, 0.05, 0.35, dark));
      r.userData.dir = dir;
      g.add(r);
      this.rotors.push(r);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const l = cyl(0.04, 0.04, 1.4, dark, 6);
      l.position.set(Math.cos(a) * 0.8, -0.8, Math.sin(a) * 0.8);
      l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      g.add(l);
    }
    g.add(at(glowSprite(0x9ff8ff, 1.2), 0, -0.5, 0.6));
    g.scale.setScalar(1.4);
    this.drone = g;
    this.scene.add(g);
    this.addHotspot('drone', g, new THREE.Vector3(0, 3.6, 0), { focus: 26 });
  }

  // ---------- a dust devil wandering across the plain ----------
  buildDustDevil() {
    const g = new THREE.Group();
    this.devilParts = [];
    const tex = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64);
    for (let i = 0; i < 60; i++) {
      const k = i / 60;
      const m = new THREE.SpriteMaterial({ map: tex, color: 0xc98458, transparent: true, opacity: 0.22 * (1 - k * 0.5), depthWrite: false });
      const s = new THREE.Sprite(m);
      const size = 2.5 + k * 7;
      s.scale.setScalar(size);
      g.add(s);
      this.devilParts.push({ s, y: k * 26, r: 0.6 + k * 4, phase: i * 0.9 });
    }
    this.devil = g;
    this.scene.add(g);
    this.addHotspot('dust', g, new THREE.Vector3(0, 30, 0), { focus: 60 });
  }

  back() { return false; }
  canGoBack() { return true; }
  selected() {}

  enter() { this.rig.reset(true); }
  exit() {}

  update(dt, t) {
    // drone: a lazy figure-eight over the base
    const a = t * 0.18;
    this.drone.position.set(Math.sin(a) * 24 - 2, 11 + Math.sin(a * 2.3) * 2, Math.sin(a * 2) * 12 + 4);
    this.drone.rotation.y = a;
    for (const r of this.rotors) r.rotation.y += dt * 40 * r.userData.dir;

    // dust devil: drifts along its loop, spinning
    const d = t * 0.03;
    const dx = Math.cos(d) * DEVIL.rx, dz = DEVIL.z - Math.abs(Math.sin(d)) * DEVIL.rz;
    this.devil.position.set(dx, this.height(dx, dz), dz);
    for (const p of this.devilParts) {
      const ang = p.phase + t * (3 - p.y * 0.06);
      p.s.position.set(Math.cos(ang) * p.r, p.y, Math.sin(ang) * p.r);
    }

    this.fan.rotation.z += dt * 6;
    this.holo.rotation.y += dt * 0.5;
    for (const m of this.markers) m.scale.setScalar(m.userData.baseSize * (1 + 0.14 * Math.sin(t * 3)));
    this.rig.update(dt);
  }
}
