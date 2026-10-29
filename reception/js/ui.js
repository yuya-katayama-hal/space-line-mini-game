// DOM overlay: hand cursor, floating tags, info card, era header, attract screen, warp transition,
// flow captions / countdown / closing message, and the queue panel (QR + next visitor).
import * as THREE from 'three';
import qrcode from 'qrcode-generator';
import { FLOW } from './content.js';

const $ = (id) => document.getElementById(id);
const RING = 251.3; // circumference of the cursor ring (r = 40)

export class UI {
  constructor() {
    this.cursor = $('cursor');
    this.cursorRing = this.cursor.querySelector('.ring');
    this.cursorLabel = $('cursor-label');
    this.tagsEl = $('tags');
    this.card = $('card');
    this.backEl = $('back');
    this.closeEl = $('card-close');
    this.attract = $('attract');
    this.warpCanvas = $('warp');
    this.warpYear = $('warp-year');
    this.era = 'space';
    this.tags = new Map();
    this.v = new THREE.Vector3();
    this.cardOpen = false;
  }

  setEra(key, info) {
    this.era = key;
    document.body.classList.remove(...[...document.body.classList].filter((c) => c.startsWith('era-')));
    document.body.classList.add(`era-${key}`);
    $('era-year').textContent = info.year;
    $('era-name').innerHTML = `${info.name} <small>${info.en}</small>`;
  }

  setBack(visible, jp = '宇宙へもどる', en = 'Back to space') {
    this.backEl.classList.toggle('hidden', !visible);
    this.backEl.querySelector('b').textContent = jp;
    this.backEl.querySelector('small').textContent = en;
    this.backEl.dataset.label = jp;
  }

  // ---------- floating tags + screen projection of 3D targets ----------
  buildTags(targets) {
    this.tagsEl.innerHTML = '';
    this.tags.clear();
    for (const t of targets) {
      if (t.noTag) continue;
      const el = document.createElement('div');
      el.className = 'tag off';
      el.innerHTML = `${t.tag}<small>${t.tagEn || ''}</small>`;
      this.tagsEl.appendChild(el);
      this.tags.set(t, el);
    }
  }

  // Projects every target to screen space (stores _x, _y, _r, _vis on it) and positions its tag.
  project(targets, camera, occluders = [], hovered = null) {
    const W = innerWidth, H = innerHeight;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const camPos = camera.position;
    for (const t of targets) {
      const p = t.obj.getWorldPosition(this.v);
      const dist = camPos.distanceTo(p);
      const ndcZ = this.v.project(camera).z;
      const x = (this.v.x + 1) / 2 * W, y = (1 - this.v.y) / 2 * H;
      const enabled = t.enabled ? t.enabled() : true;
      let vis = enabled && ndcZ > -1 && ndcZ < 1 && x > -50 && x < W + 50 && y > -50 && y < H + 50;
      if (vis && occluders.length) vis = !isOccluded(t, camPos, t.obj.getWorldPosition(new THREE.Vector3()), occluders);
      t._x = x; t._y = y; t._vis = vis;
      t._r = (t.radius / (dist * tanHalf)) * (H / 2);
      const el = this.tags.get(t);
      if (el) {
        el.classList.toggle('off', !vis);
        el.classList.toggle('hover', t === hovered);
        if (vis) el.style.transform = `translate(${x}px, ${y - t._r - 8}px) translate(-50%, -100%)`;
      }
    }
  }

  // ---------- info card ----------
  showCard(info) {
    $('card-kicker').textContent = info.kicker || '';
    $('card-title').textContent = info.title || '';
    $('card-sub').textContent = info.sub || '';
    $('card-body').textContent = info.body || '';
    $('card-en').textContent = info.en || '';
    $('card-note').textContent = info.note || '';
    this.card.classList.remove('hidden');
    this.cardOpen = true;
  }
  hideCard() {
    this.card.classList.add('hidden');
    this.cardOpen = false;
  }

  setAttract(on) {
    this.attract.classList.toggle('off', !on);
    document.body.classList.toggle('in-attract', on);
  }

  // ---------- flow overlays: caption, countdown, closing message ----------
  caption(text, ms = 0) {
    const el = $('caption');
    clearTimeout(this.captionTimer);
    el.textContent = text;
    el.classList.toggle('off', !text);
    if (text && ms) this.captionTimer = setTimeout(() => el.classList.add('off'), ms);
  }

  countdown(text) {
    const el = $('countdown');
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth; // restart the pop animation
    el.classList.toggle('pop', !!text);
  }

  showFinale(f, name) {
    $('finale-title').textContent = name ? f.titleNamed(name) : f.title;
    $('finale-sub').textContent = f.sub;
    $('finale-body').textContent = f.body;
    $('finale-en').textContent = f.en;
    $('finale-end').textContent = f.end;
    $('finale').classList.remove('off');
    document.body.classList.add('in-finale');
  }
  hideFinale() {
    $('finale').classList.add('off');
    document.body.classList.remove('in-finale');
  }

  // ---------- registration queue on the attract screen ----------
  // state: { serving, waiting } from the queue (or null); url: the phone registration page
  setQueue(state, url) {
    const box = $('attract-queue');
    if (url && url !== this.qrUrl) {
      const q = qrcode(0, 'M');
      q.addData(url);
      q.make();
      $('qr').innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
      this.qrUrl = url;
    }
    const next = state && (state.serving && state.serving.status === 'called' ? state.serving : state.waiting[0]);
    const needsTap = next && next.status === 'called' && !next.checkedInAt;
    $('next-up').textContent = next ? FLOW.nextUp(next.number, next.nickname) + (needsTap ? `\n${FLOW.tapTag}` : '') : '';
    box.classList.toggle('off', !url);
  }

  // ---------- cursor ----------
  updateCursor(pointer, { visible, hover, progress = 0, mode = 'dwell', dragging = false }) {
    const c = this.cursor;
    c.classList.toggle('gone', !visible);
    c.style.transform = `translate(${pointer.x}px, ${pointer.y}px)`;
    c.classList.toggle('hover', !!hover);
    c.classList.toggle('pinch', pointer.pressed);
    c.classList.toggle('drag', dragging);
    this.cursorRing.style.strokeDashoffset = RING * (1 - Math.min(1, progress));
    this.cursorRing.style.stroke = mode === 'fist' ? '#ff8a5c' : '';
    const label = mode === 'fist' && progress > 0 ? 'もどる…' : hover ? (hover.tag || hover.el?.dataset.label || '') : '';
    if (this.cursorLabel.textContent !== label) this.cursorLabel.textContent = label;
    for (const el of [this.backEl, this.closeEl]) el.classList.toggle('hover', hover?.el === el);
  }

  // ---------- warp transition: streaking stars + rolling year counter ----------
  warp(fromYear, toYear, subtitle, color, onMid) {
    return new Promise((resolve) => {
      const c = this.warpCanvas;
      const g = c.getContext('2d');
      c.width = innerWidth; c.height = innerHeight;
      const cx = c.width / 2, cy = c.height / 2;
      const maxR = Math.hypot(cx, cy);
      const stars = Array.from({ length: 420 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random() * maxR, w: 0.5 + Math.random() * 2 }));
      const D = 2800;
      const start = performance.now();
      let last = start, swapped = false;
      const step = (now) => {
        const t = Math.min(1, (now - start) / D);
        const dt = (now - last) / 1000; last = now;
        c.style.opacity = t < 0.3 ? t / 0.3 : t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
        g.fillStyle = 'rgba(0,0,6,0.32)';
        g.fillRect(0, 0, c.width, c.height);
        const speed = 120 + 2600 * Math.sin(Math.PI * t);
        g.strokeStyle = color;
        g.lineCap = 'round';
        for (const s of stars) {
          const r0 = s.r;
          s.r += speed * dt * (0.15 + s.r / maxR);
          if (s.r > maxR) { s.r = Math.random() * 40; s.a = Math.random() * Math.PI * 2; continue; }
          g.lineWidth = s.w;
          g.globalAlpha = Math.min(1, s.r / 200);
          g.beginPath();
          g.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
          g.lineTo(cx + Math.cos(s.a) * s.r, cy + Math.sin(s.a) * s.r);
          g.stroke();
        }
        g.globalAlpha = 1;
        const k = Math.min(1, Math.max(0, (t - 0.08) / 0.62));
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const year = Math.round(fromYear + (toYear - fromYear) * e);
        this.warpYear.innerHTML = `<div>${year}<small>${subtitle}</small></div>`;
        this.warpYear.style.opacity = t < 0.08 ? t / 0.08 : t > 0.82 ? Math.max(0, 1 - (t - 0.82) / 0.18) : 1;
        if (!swapped && t >= 0.45) { swapped = true; onMid(); }
        if (t < 1) requestAnimationFrame(step);
        else { c.style.opacity = 0; this.warpYear.style.opacity = 0; resolve(); }
      };
      requestAnimationFrame(step);
    });
  }
}

// Is the straight line from the camera to the target blocked by a planet?
function isOccluded(target, cam, p, occluders) {
  const dir = p.clone().sub(cam);
  const len = dir.length();
  dir.divideScalar(len);
  const c = new THREE.Vector3();
  for (const o of occluders) {
    if (o.obj === target.obj) continue;
    o.obj.getWorldPosition(c).sub(cam);
    const tca = c.dot(dir);
    if (tca < 0 || tca > len) continue;
    const d2 = c.lengthSq() - tca * tca;
    if (d2 > o.radius * o.radius) continue;
    const t0 = tca - Math.sqrt(o.radius * o.radius - d2);
    if (t0 < len - target.radius * 0.5) return true;
  }
  return false;
}
