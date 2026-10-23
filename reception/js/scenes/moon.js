// The Moon in 2126, the story's present (speculative): a base near the south pole — regolith-covered habitat domes, a greenhouse,
// an ice-mining crater, a pressurized rover, a spaceport, the Apollo 11 site kept as a museum, and Earth in the sky.
import * as THREE from 'three';
import { OrbitRig, starfield, hotspotMarker, seeded, glowTexture } from '../util.js';
import { earthMaterial, cloudMaterial, atmosphereMaterial } from './space.js';
import { MOON } from '../content.js';

const SUN_DIR = new THREE.Vector3(-1, 0.2, 0.35).normalize(); // low sun, as it always is near the pole
const SUN_FAR = SUN_DIR.clone().multiplyScalar(5000);
const EARTH_POS = new THREE.Vector3(150, 40, -380);
const ICE = { x: 39, z: -34, r: 12 };
const HUB = { x: -8, z: 6 };
const PORT = { x: 31, z: 20 };
const APOLLO = { x: -39, z: -20 };
const MONUMENT = { x: 11, z: -34 };
const HOLO = { x: -22, z: 32 };
const ROVER = { x: -6, z: 3, rx: 29, rz: 22 }; // elliptical drive loop around the base
const PADS = [ // ground flattened for buildings: [x, z, radius]
  [HUB.x, HUB.z, 14], [PORT.x, PORT.z, 8], [APOLLO.x, APOLLO.z, 6], [MONUMENT.x, MONUMENT.z, 3], [HOLO.x, HOLO.z, 3],
];

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
const cyl = (rt, rb, h, mat, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
const dome = (r, mat) => new THREE.Mesh(new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };
const glowSprite = (color, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
};

export class MoonScene {
  constructor() {
    this.era = 'moon';
    this.bloom = { strength: 0.8, radius: 0.5, threshold: 0.9 };
    this.exposure = 1.0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000003);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 3000);
    this.rig = new OrbitRig(this.camera, {
      target: new THREE.Vector3(0, 2, 2), distance: 72, pitch: 0.3, yaw: 0,
      minPitch: 0.08, maxPitch: 1.25, minDist: 20, maxDist: 160, autoSpin: 0.03,
    });
    this.targets = [];
    this.markers = [];
    this.occluders = [];
    this.blinkers = [];
    this.rand = seeded(2126);
    this.tmp = new THREE.Vector3();
    const s = this.scene;

    s.add(starfield({ count: 6000, radius: 900, size: 2.0 }));
    const sunGlow = glowSprite(0xfff1d6, 260);
    sunGlow.position.copy(SUN_DIR).multiplyScalar(850);
    s.add(sunGlow);

    // no air: hard light from a low sun, a faint blue fill from earthshine
    s.add(new THREE.HemisphereLight(0x8fa6d8, 0x141414, 0.35));
    const sun = new THREE.DirectionalLight(0xfff3e0, 3.0);
    sun.position.copy(SUN_DIR).multiplyScalar(160);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 360 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    s.add(sun);

    this.makeCraters();
    this.buildTerrain();
    this.buildRocks();
    this.buildEarth();
    this.buildBase();
    this.buildIce();
    this.buildPort();
    this.buildApollo();
    this.buildMonument();
    this.buildHolo();
    this.buildRover();

    s.traverse((o) => {
      if (o.isMesh && !o.material.transparent && !o.material.isMeshBasicMaterial && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  addHotspot(id, parent, localPos, extra = {}) {
    const m = hotspotMarker(0x9ff8ff, 2.6);
    m.position.copy(localPos);
    parent.add(m);
    this.markers.push(m);
    const info = MOON[id];
    this.targets.push({ id, obj: m, radius: 2.6, tag: info.tag, tagEn: info.tagEn, info, focus: 40, ...extra });
  }

  // ---------- ground ----------
  makeCraters() {
    const r = this.rand;
    this.craters = [{ x: ICE.x, z: ICE.z, r: ICE.r, d: 4.5, rim: 1.2 }];
    const clear = (x, z, cr) => Math.hypot(x - ICE.x, z - ICE.z) > ICE.r * 1.6 + cr
      && PADS.every(([px, pz, pr]) => Math.hypot(x - px, z - pz) > pr + cr * 1.6);
    for (let i = 0, n = 0; i < 500 && n < 45; i++) {
      const a = r(0, Math.PI * 2), d = Math.sqrt(r(0.02, 1)) * 58, cr = r(1, 6);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!clear(x, z, cr)) continue;
      this.craters.push({ x, z, r: cr, d: cr * r(0.25, 0.4), rim: cr * r(0.08, 0.15) });
      n++;
    }
    // big, shallow craters out toward the horizon
    for (let i = 0; i < 70; i++) {
      const cr = r(6, 40), a = r(0, Math.PI * 2), d = r(62 + cr * 1.6, 800);
      this.craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: cr, d: cr * r(0.12, 0.22), rim: cr * r(0.04, 0.08) });
    }
  }

  height(x, z) {
    // gentle, irregular swells (products of skewed waves, so no regular ripples show under the low sun)
    let h = 0.6 * Math.sin(x * 0.045 + 1.3) * Math.sin(z * 0.05 + 0.4) + 0.18 * Math.sin(x * 0.13 + z * 0.07) * Math.sin(z * 0.17 - x * 0.05 + 2.0);
    for (const c of this.craters) {
      const dx = x - c.x, dz = z - c.z;
      const q2 = (dx * dx + dz * dz) / (c.r * c.r);
      if (q2 > 2.56) continue;
      if (q2 < 1) h += c.d * (q2 - 1) + c.rim * q2 * q2 * q2; // bowl rising to the rim
      else { const k = (Math.sqrt(q2) - 1) / 0.6; h += c.rim * (1 - k) * (1 - k); } // rim falling off outside
    }
    for (const [px, pz, pr] of PADS) h *= smooth((Math.hypot(x - px, z - pz) - pr) / 5);
    return h - (x * x + z * z) / 6000; // curvature: the horizon falls away
  }

  // grey with darker "maria" patches
  shade(x, z) {
    const mare = smooth((Math.sin(x * 0.021 + 2.1) * Math.sin(z * 0.018 + 0.6) - 0.1) / 0.5);
    const speck = 0.04 * Math.sin(x * 2.3 + z * 1.7) * Math.sin(x * 1.1 - z * 2.9);
    return 0.42 - 0.13 * mare + speck;
  }

  buildTerrain() {
    // one disc: fine rings out to r = 62 where everything happens, then rings that widen out to the horizon
    const geo = new THREE.RingGeometry(0.001, 1, 220, 160);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const x0 = pos.getX(i), z0 = pos.getZ(i);
      const t = Math.hypot(x0, z0);
      const rad = t <= 0.625 ? (t / 0.625) * 62 : 62 * Math.pow(1000 / 62, (t - 0.625) / 0.375);
      const k = t > 0 ? rad / t : 0;
      const x = x0 * k, z = z0 * k;
      pos.setXYZ(i, x, this.height(x, z), z);
      const g = this.shade(x, z);
      col.push(g, g, g * 0.97);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
    this.scene.add(ground);
  }

  buildRocks() {
    const r = this.rand;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x77756f, roughness: 1, flatShading: true }), 260);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < 2000 && n < 260; i++) {
      const a = r(0, Math.PI * 2), d = r(3, 58), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!PADS.every(([px, pz, pr]) => Math.hypot(x - px, z - pz) > pr + 1)) continue;
      const k = r() < 0.9 ? r(0.15, 0.5) : r(0.6, 1.2);
      p.set(x, this.height(x, z) - k * 0.25, z);
      q.setFromEuler(new THREE.Euler(r(0, 3), r(0, 3), r(0, 3)));
      sc.set(k, k * r(0.5, 0.8), k * r(0.8, 1.2));
      rocks.setMatrixAt(n++, m4.compose(p, q, sc));
    }
    rocks.count = n;
    this.scene.add(rocks);
  }

  // ---------- Earth in the black sky ----------
  buildEarth() {
    this.earth = new THREE.Group();
    this.earth.position.copy(EARTH_POS);
    this.earthSurface = new THREE.Mesh(new THREE.SphereGeometry(30, 96, 48), earthMaterial(SUN_FAR));
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(30.36, 72, 36), cloudMaterial(SUN_FAR));
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(33.3, 48, 24), atmosphereMaterial(undefined, SUN_FAR));
    this.earthSurface.rotation.z = 0.41;
    this.clouds.rotation.z = 0.41;
    this.earth.add(this.earthSurface, this.clouds, atmo);
    this.scene.add(this.earth);
    const info = MOON.earth;
    this.targets.push({ id: 'earth', obj: this.earth, radius: 30, tag: info.tag, tagEn: info.tagEn, info });
  }

  // ---------- habitat domes + greenhouse + solar towers ----------
  buildBase() {
    const g = new THREE.Group();
    g.position.set(HUB.x, this.height(HUB.x, HUB.z), HUB.z);
    const regolith = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.4, roughness: 0.35 });
    const windows = new THREE.MeshBasicMaterial({ color: hdr(0xffcf8a, 2.2) });
    const domes = [[0, 0, 5.5], [9, -3, 3.6], [-7, 4, 3.8], [3, 8, 3.2]];
    for (const [x, z, r] of domes) {
      const d = dome(r, regolith);
      d.position.set(x, 0, z);
      g.add(d);
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.955 + 0.03, 0.11, 6, 64), windows);
      band.rotation.x = -Math.PI / 2;
      band.position.set(x, r * 0.3, z);
      g.add(band);
    }
    // corridors between the main dome and the others
    const up = new THREE.Vector3(0, 1, 0);
    for (const [x, z] of [...domes.slice(1), [-4, -8]]) {
      const dir = new THREE.Vector3(x, 0, z);
      const len = dir.length();
      const tube = cyl(0.9, 0.9, len, metal, 16);
      tube.quaternion.setFromUnitVectors(up, dir.normalize());
      tube.position.set(x / 2, 0.9, z / 2);
      g.add(tube);
    }
    // greenhouse: a glass dome full of green light
    const gh = new THREE.Group();
    gh.position.set(-4, 0, -8);
    gh.add(dome(3.4, new THREE.MeshStandardMaterial({ color: 0xbff5ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false })));
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3aa860, emissive: 0x3dff86, emissiveIntensity: 0.7, roughness: 0.8 });
    for (let i = -2; i <= 2; i++) gh.add(box(0.7, 0.8, 4.2 - Math.abs(i) * 0.7, leaf, i * 1.1, 0.4, 0)); // planting rows
    gh.add(at(glowSprite(0x7dffa8, 7), 0, 1.6, 0));
    g.add(gh);
    // solar towers: tall, near-vertical panels to catch the low polar sun
    const panel = new THREE.MeshStandardMaterial({ color: 0x1b2f6a, metalness: 0.8, roughness: 0.25, emissive: 0x0a1a55, emissiveIntensity: 0.4 });
    const face = Math.atan2(SUN_DIR.x, SUN_DIR.z);
    for (const [x, z] of [[-12, -3], [-11, 6], [12, 6]]) {
      const t = new THREE.Group();
      t.position.set(x, 0, z);
      const mast = cyl(0.18, 0.28, 12, metal, 10);
      mast.position.y = 6;
      t.add(mast);
      const p = box(4.2, 6, 0.14, panel, 0, 9, 0.2);
      p.rotation.y = face;
      p.rotation.x = -0.15;
      t.add(p);
      g.add(t);
    }
    this.scene.add(g);
    this.addHotspot('base', g, new THREE.Vector3(0, 8.5, 0), { focus: 45 });
  }

  // ---------- ice crater: permanent shadow, water ice, a mining rig ----------
  buildIce() {
    const r = this.rand;
    const floor = this.height(ICE.x, ICE.z);
    const ice = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({
      color: 0xd8f6ff, emissive: 0x3fd7ff, emissiveIntensity: 0.9, roughness: 0.2, flatShading: true,
    }), 70);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < 70; i++) {
      const a = r(0, Math.PI * 2), d = Math.sqrt(r()) * ICE.r * 0.7;
      const x = ICE.x + Math.cos(a) * d, z = ICE.z + Math.sin(a) * d;
      p.set(x, this.height(x, z) + 0.1, z);
      q.setFromEuler(new THREE.Euler(r(0, 3), r(0, 3), r(0, 3)));
      const k = r(0.5, 1.6);
      ice.setMatrixAt(i, m4.compose(p, q, sc.set(k, k * r(0.5, 1), k)));
    }
    ice.userData.noShadow = true;
    this.scene.add(ice);

    const g = new THREE.Group();
    g.position.set(ICE.x, floor, ICE.z);
    const metal = new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.5, roughness: 0.35 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = cyl(0.14, 0.14, 8.4, metal, 8);
      leg.position.set(Math.cos(a) * 1.4, 4, Math.sin(a) * 1.4);
      leg.rotation.set(Math.sin(a) * 0.17, 0, -Math.cos(a) * 0.17);
      g.add(leg);
    }
    g.add(box(1.8, 1.4, 1.8, metal, 0, 8.2, 0));
    const lamp = glowSprite(0x7fe9ff, 4);
    lamp.position.y = 7.3;
    g.add(lamp);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4.2, 7.2, 32, 1, true), new THREE.MeshBasicMaterial({
      color: hdr(0x5ff2ff, 0.6), transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    beam.position.y = 3.6;
    g.add(beam);
    this.scene.add(g);
    this.addHotspot('ice', g, new THREE.Vector3(0, 11, 0), { focus: 42 });

    // pipeline from the crater floor to the base
    const from = new THREE.Vector2(ICE.x - 2, ICE.z + 1.5), to = new THREE.Vector2(HUB.x + 9, HUB.z - 6);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const v = from.clone().lerp(to, i / 40);
      pts.push(new THREE.Vector3(v.x, this.height(v.x, v.y) + 0.35, v.y));
    }
    this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.22, 8), metal));
  }

  // ---------- spaceport with a shuttle that comes and goes ----------
  buildPort() {
    const g = new THREE.Group();
    g.position.set(PORT.x, this.height(PORT.x, PORT.z), PORT.z);
    g.add(at(cyl(6.5, 7, 0.4, new THREE.MeshStandardMaterial({ color: 0x55565b, roughness: 0.9 }), 48), 0, 0.2, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5, 0.09, 6, 80), new THREE.MeshBasicMaterial({ color: hdr(0xffd166, 2) }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.42;
    g.add(ring);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const b = glowSprite(0xffd166, 1.2);
      b.position.set(Math.cos(a) * 6.6, 0.6, Math.sin(a) * 6.6);
      g.add(b);
      this.blinkers.push({ s: b, phase: i * 0.6 });
    }

    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, metalness: 0.35, roughness: 0.3 });
    const ship = new THREE.Group();
    const profile = [[0, 0], [1.3, 0], [1.4, 0.6], [1.4, 6], [1.1, 7.6], [0.5, 8.8], [0, 9.3]].map(([x, y]) => new THREE.Vector2(x, y));
    ship.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 32), white));
    const win = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.35, 32, 1, true), new THREE.MeshBasicMaterial({ color: hdr(0x9ff8ff, 2) }));
    win.position.y = 6.3;
    ship.add(win);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = box(0.2, 2.6, 0.2, white, Math.cos(a) * 1.9, 0.9, Math.sin(a) * 1.9);
      leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      ship.add(leg);
    }
    this.flame = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 5, 16, 1, true), new THREE.MeshBasicMaterial({
      color: hdr(0xffa060, 2.5), transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    cone.rotation.x = Math.PI;
    cone.position.y = -2.5;
    this.flame.add(cone, glowSprite(0xffb070, 7));
    ship.add(this.flame);
    ship.position.y = 0.4;
    g.add(ship);
    this.ship = ship;
    this.scene.add(g);
    this.addHotspot('port', g, new THREE.Vector3(0, 12.5, 0), { focus: 42 });
  }

  // ---------- Apollo 11 landing site under a glass dome ----------
  buildApollo() {
    const g = new THREE.Group();
    g.position.set(APOLLO.x, this.height(APOLLO.x, APOLLO.z), APOLLO.z);
    g.add(dome(4.6, new THREE.MeshStandardMaterial({ color: 0xcfefff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false })));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(4.6, 0.16, 8, 64), new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.5, roughness: 0.3 }));
    rim.rotation.x = -Math.PI / 2;
    g.add(rim);
    // descent stage: gold-foil body on four legs
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a23f, metalness: 0.9, roughness: 0.35 });
    const body = cyl(0.95, 0.95, 0.9, gold, 8);
    body.position.y = 1.3;
    g.add(body);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = cyl(0.05, 0.05, 1.7, gold, 6);
      leg.position.set(Math.cos(a) * 1.25, 0.7, Math.sin(a) * 1.25);
      leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      g.add(leg);
      const foot = cyl(0.22, 0.22, 0.05, gold, 12);
      foot.position.set(Math.cos(a) * 1.6, 0.03, Math.sin(a) * 1.6);
      g.add(foot);
    }
    // flag
    const pole = cyl(0.025, 0.025, 2.2, new THREE.MeshStandardMaterial({ color: 0xdddddd }), 6);
    pole.position.set(2.2, 1.1, 0.6);
    g.add(pole);
    const fc = document.createElement('canvas');
    fc.width = 190; fc.height = 100;
    const fg = fc.getContext('2d');
    for (let i = 0; i < 13; i++) { fg.fillStyle = i % 2 ? '#ffffff' : '#c8102e'; fg.fillRect(0, (i * 100) / 13, 190, 100 / 13 + 1); }
    fg.fillStyle = '#0a3161';
    fg.fillRect(0, 0, 76, 54);
    const ftex = new THREE.CanvasTexture(fc);
    ftex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.53), new THREE.MeshStandardMaterial({ map: ftex, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(2.7, 1.9, 0.6);
    g.add(flag);
    // footprints wandering away from the lander
    const print = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    const fgeo = new THREE.CircleGeometry(0.1, 12);
    for (let i = 0; i < 18; i++) {
      const s = i * 0.32;
      const x = -1 + Math.cos(s * 0.5) * (1.4 + s * 0.45), z = 1 + Math.sin(s * 0.5) * (1.4 + s * 0.3);
      const f = new THREE.Mesh(fgeo, print);
      f.rotation.x = -Math.PI / 2;
      f.scale.set(1, 1.9, 1);
      f.position.set(x + (i % 2 ? 0.12 : -0.12), 0.02, z);
      f.userData.noShadow = true;
      g.add(f);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const l = glowSprite(0xfff1d6, 1.1);
      l.position.set(Math.cos(a) * 4.3, 0.25, Math.sin(a) * 4.3);
      g.add(l);
    }
    this.scene.add(g);
    this.addHotspot('apollo', g, new THREE.Vector3(0, 7, 0), { focus: 26 });
  }

  // ---------- message monument ----------
  buildMonument() {
    const g = new THREE.Group();
    g.position.set(MONUMENT.x, this.height(MONUMENT.x, MONUMENT.z), MONUMENT.z);
    g.add(at(cyl(1.2, 1.6, 1.2, new THREE.MeshStandardMaterial({ color: 0xdfe6f0, metalness: 0.4, roughness: 0.3 }), 6), 0, 0.6, 0));
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), new THREE.MeshStandardMaterial({
      color: 0xfff1f8, emissive: 0xff7ae6, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.1, flatShading: true,
    }));
    this.crystal.scale.y = 1.5;
    this.crystal.position.y = 4;
    this.crystal.userData.noShadow = true;
    g.add(this.crystal);
    const glow = glowSprite(0xff9ef0, 8);
    glow.position.y = 4;
    g.add(glow);
    this.scene.add(g);
    this.addHotspot('you', g, new THREE.Vector3(0, 8, 0), { focus: 28 });
  }

  // ---------- hologram of the Moon (facts) ----------
  buildHolo() {
    const g = new THREE.Group();
    g.position.set(HOLO.x, this.height(HOLO.x, HOLO.z), HOLO.z);
    g.add(at(cyl(1.6, 2.1, 1, new THREE.MeshStandardMaterial({ color: 0xdfe6f0, metalness: 0.4, roughness: 0.3 }), 32), 0, 0.5, 0));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 1.3, 5, 32, 1, true), new THREE.MeshBasicMaterial({
      color: hdr(0x5ff2ff, 0.5), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    beam.position.y = 3.5;
    g.add(beam);
    this.holo = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 3), new THREE.MeshBasicMaterial({ color: hdr(0x5ff2ff, 1.8), wireframe: true, transparent: true, opacity: 0.8 }));
    this.holo.position.y = 6.4;
    g.add(this.holo);
    this.scene.add(g);
    this.addHotspot('data', g, new THREE.Vector3(0, 10.5, 0), { focus: 30 });
  }

  // ---------- pressurized rover on a loop around the base ----------
  buildRover() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf0f2f6, metalness: 0.3, roughness: 0.35 });
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 3.0, 4, 16), white);
    shell.rotation.x = Math.PI / 2;
    shell.position.y = 1.5;
    g.add(shell);
    g.add(box(1.6, 0.4, 0.5, new THREE.MeshBasicMaterial({ color: hdr(0x9ff8ff, 2) }), 0, 1.9, 2.0));
    const tire = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.9 });
    this.wheels = [];
    for (const x of [-1.2, 1.2]) {
      for (const z of [-1.4, 0, 1.4]) {
        const w = cyl(0.55, 0.55, 0.4, tire, 16);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.55, z);
        g.add(w);
        this.wheels.push(w);
      }
    }
    for (const x of [-0.6, 0.6]) {
      const h = glowSprite(0xfff4d8, 2.2);
      h.position.set(x, 1.2, 2.7);
      g.add(h);
    }
    const beacon = glowSprite(0xffb347, 1.4);
    beacon.position.set(0, 2.75, -0.8);
    g.add(beacon);
    this.blinkers.push({ s: beacon, phase: 0 });
    this.scene.add(g);
    this.rover = g;
    this.roverAngle = 0.6;
    this.addHotspot('rover', g, new THREE.Vector3(0, 4.6, 0), { focus: 26 });
  }

  roverPos(a, out) {
    const x = ROVER.x + Math.cos(a) * ROVER.rx, z = ROVER.z + Math.sin(a) * ROVER.rz;
    return out.set(x, this.height(x, z), z);
  }

  back() { return false; }
  canGoBack() { return true; }
  selected() {}

  enter() { this.rig.reset(true); }
  exit() {}

  update(dt, t) {
    this.earthSurface.rotation.y += dt * 0.03;
    this.clouds.rotation.y += dt * 0.036;
    this.clouds.material.uniforms.time.value = t;

    // rover
    this.roverAngle += dt * 0.06;
    this.roverPos(this.roverAngle, this.rover.position);
    this.rover.lookAt(this.roverPos(this.roverAngle + 0.02, this.tmp));
    for (const w of this.wheels) w.rotation.x += dt * 2.2;

    // shuttle: rest, lift off out of sight, come back down on its engine
    const p = t % 30;
    let y = 0, burn = 0;
    if (p > 14 && p < 21) { const k = (p - 14) / 7; y = 120 * k * k; burn = 1; }
    else if (p >= 21 && p < 23) { y = 120; }
    else if (p >= 23) { const k = (p - 23) / 7; y = 120 * (1 - k) * (1 - k); burn = 1; }
    this.ship.position.y = 0.4 + y;
    this.flame.visible = burn > 0;
    this.flame.scale.setScalar(0.9 + 0.15 * Math.sin(t * 40));

    this.holo.rotation.y += dt * 0.5;
    this.crystal.rotation.y += dt * 0.9;
    this.crystal.position.y = 4 + Math.sin(t * 1.3) * 0.4;
    for (const b of this.blinkers) b.s.material.opacity = Math.sin(t * 2.5 + b.phase) > 0.2 ? 1 : 0.15;
    for (const m of this.markers) m.scale.setScalar(m.userData.baseSize * (1 + 0.14 * Math.sin(t * 3)));
    this.rig.update(dt);
  }
}
