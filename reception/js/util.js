import * as THREE from 'three';

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const damp = (dt, rate) => 1 - Math.exp(-dt * rate);

// Seeded random so dioramas look the same on every visit.
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return (a = 0, b = 1) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return a + (s / 4294967296) * (b - a);
  };
}

// ---------- camera rig: orbit around a target, driven by drag / zoom ----------
export class OrbitRig {
  constructor(camera, o = {}) {
    this.camera = camera;
    this.target = (o.target || new THREE.Vector3()).clone();
    this.goalTarget = this.target.clone();
    this.yaw = this.goalYaw = o.yaw ?? 0;
    this.pitch = this.goalPitch = o.pitch ?? 0.2;
    this.dist = this.goalDist = o.distance ?? 50;
    this.minPitch = o.minPitch ?? -1.2;
    this.maxPitch = o.maxPitch ?? 1.2;
    this.minDist = o.minDist ?? 5;
    this.maxDist = o.maxDist ?? 400;
    this.autoSpin = o.autoSpin ?? 0.03;   // rad/s when nobody is dragging
    this.follow = null;                    // Object3D to keep centered
    this.idle = 0;
    this.home = { target: this.target.clone(), yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  }
  drag(dx, dy) {
    this.goalYaw -= dx * 0.004;
    this.goalPitch = clamp(this.goalPitch + dy * 0.003, this.minPitch, this.maxPitch);
    this.idle = 0;
  }
  zoom(step) {
    this.goalDist = clamp(this.goalDist * (1 + step * 0.12), this.minDist, this.maxDist);
  }
  focusOn(obj, dist) {
    this.follow = obj;
    this.goalDist = clamp(dist, this.minDist, this.maxDist);
  }
  focusPoint(v, dist) {
    this.follow = null;
    this.goalTarget.copy(v);
    if (dist) this.goalDist = clamp(dist, this.minDist, this.maxDist);
  }
  // stop following a selected thing and drift back to the overview distance
  release() {
    this.follow = null;
    this.goalTarget.copy(this.home.target);
    this.goalDist = this.home.dist;
  }
  reset(instant = false) {
    this.follow = null;
    this.goalTarget.copy(this.home.target);
    this.goalYaw = this.home.yaw; this.goalPitch = this.home.pitch; this.goalDist = this.home.dist;
    if (instant) {
      this.target.copy(this.goalTarget);
      this.yaw = this.goalYaw; this.pitch = this.goalPitch; this.dist = this.goalDist;
    }
  }
  update(dt) {
    this.idle += dt;
    if (this.idle > 2) this.goalYaw += this.autoSpin * dt;
    if (this.follow) this.follow.getWorldPosition(this.goalTarget);
    const k = damp(dt, 3.2);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.dist += (this.goalDist - this.dist) * damp(dt, 2.2);
    this.target.lerp(this.goalTarget, damp(dt, 2.6));
    const yaw = this.yaw, pitch = this.pitch;
    const c = Math.cos(pitch);
    this.camera.position.set(
      this.target.x + this.dist * c * Math.sin(yaw),
      this.target.y + this.dist * Math.sin(pitch),
      this.target.z + this.dist * c * Math.cos(yaw),
    );
    this.camera.lookAt(this.target);
  }
}

// ---------- textures ----------
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softDotTexture() {
  return glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64);
}

// Text rendered to a sprite (always faces the camera).
export function textSprite(lines, { color = '#fff', glow = '#8fd3ff', width = 512, height = 256, scale = 10 } = {}) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = glow;
  g.shadowBlur = 24;
  g.fillStyle = color;
  const font = '"Noto Sans JP","Yu Gothic UI","Yu Gothic","Meiryo",sans-serif';
  let y = height * 0.5 - (lines.length - 1) * height * 0.17;
  for (const [i, line] of lines.entries()) {
    const size = i === 0 ? height * 0.42 : height * 0.16;
    g.font = `${i === 0 ? 900 : 700} ${size}px ${font}`;
    g.fillText(line, width / 2, y);
    y += i === 0 ? height * 0.36 : height * 0.2;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale * height / width, 1);
  return s;
}

// ---------- starfield ----------
export function starfield({ count = 6000, radius = 900, size = 2.2, band = true } = {}) {
  const pos = [], col = [];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    let v;
    if (band && i < count * 0.45) {
      // a milky-way band tilted across the sky
      const a = rand(0, Math.PI * 2);
      v = new THREE.Vector3(Math.cos(a), rand(-0.12, 0.12) * (1 + Math.random()), Math.sin(a)).normalize();
      v.applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 0.9);
    } else {
      v = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    }
    v.multiplyScalar(radius * rand(0.85, 1));
    pos.push(v.x, v.y, v.z);
    color.setHSL(rand(0.55, 0.7) + (Math.random() < 0.15 ? -0.5 : 0), rand(0.2, 0.7), rand(0.65, 1));
    col.push(color.r, color.g, color.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, sizeAttenuation: false, vertexColors: true, map: softDotTexture(),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

// Vertical gradient sky dome.
export function skyDome(top, bottom, radius = 600, exponent = 0.8) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, ex: { value: exponent } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float ex; varying vec3 vP; void main(){ float h = pow(clamp(vP.y*0.5+0.5,0.,1.), ex); gl_FragColor = vec4(mix(bottom, top, h), 1.); }',
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
}

// ---------- smoke / steam particles ----------
export class Smoke {
  constructor(parent, { count = 120, color = 0xdddddd, opacity = 0.5, life = 4, rise = 2.2, grow = 2.5, blending = THREE.NormalBlending } = {}) {
    this.tex = softDotTexture();
    this.parts = [];
    this.emitters = [];
    this.life = life; this.rise = rise; this.grow = grow; this.opacity = opacity;
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, opacity: 0, depthWrite: false, blending });
      const s = new THREE.Sprite(m);
      s.visible = false;
      parent.add(s);
      this.parts.push({ s, age: 0, alive: false, vel: new THREE.Vector3(), size: 1 });
    }
    this.cursor = 0;
  }
  // getPos: () => Vector3 in parent space; rate = particles per second
  addEmitter(getPos, rate = 6, size = 1) {
    const e = { getPos, rate, size, acc: 0 };
    this.emitters.push(e);
    return e; // change e.rate later to throttle it
  }
  spawn(pos, size) {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.parts.length;
    p.alive = true; p.age = 0; p.size = size;
    p.s.position.copy(pos);
    p.vel.set(rand(-0.3, 0.3), this.rise * rand(0.7, 1.2), rand(-0.3, 0.3));
    p.s.visible = true;
  }
  update(dt) {
    for (const e of this.emitters) {
      e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; this.spawn(e.getPos(), e.size); }
    }
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.age += dt;
      const t = p.age / this.life;
      if (t >= 1) { p.alive = false; p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.x += 0.25 * dt; // gentle wind
      const sc = p.size * (0.6 + t * this.grow);
      p.s.scale.set(sc, sc, 1);
      p.s.material.opacity = this.opacity * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - t);
    }
  }
}

// ---------- hotspot marker (pulsing ring sprite) ----------
export function hotspotMarker(color = 0xffffff, size = 2.2) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 9;
  g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(64, 64, 16, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.setScalar(size);
  s.renderOrder = 10;
  s.userData.baseSize = size;
  return s;
}

// 3D simplex noise (Ashima / Stefan Gustavson), used by the planet shaders.
export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.03; a*=0.5; } return s; }
`;
