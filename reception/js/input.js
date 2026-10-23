// Visitor input. Each source (webcam hand, mouse) keeps its own state; `Input` picks the active one
// and publishes it on a single `Pointer`. The rest of the app only reads `input.pointer`:
//   x, y, present, pressed, fist, backProgress   and events: press | release | zoom | back | swipeup
import { FilesetResolver, HandLandmarker } from '../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

// ---- Tuning knobs (adjust these on site) ----
export const CONFIG = {
  // Part of the camera frame (0..1, mirrored) that maps to the whole screen,
  // so visitors don't need to reach the edges of the camera view.
  // TODO(on site): visitors are seated, so their hands sit lower in the camera image than a standing
  // visitor's. With the real chair and camera in place, adjust y0 / y1 (and x0 / x1) until a relaxed
  // hand reaches every edge of the screen. The dashed box in the camera preview (key c) shows this region.
  region: { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.7 },
  smoothMin: 0.16,      // cursor smoothing when the hand is almost still (lower = steadier)
  smoothMax: 0.7,       // cursor smoothing when the hand moves fast (higher = snappier)
  // Pinch = thumb tip–index tip distance ÷ palm length (wrist → middle knuckle), measured in 3D,
  // so it works the same whether the hand faces the camera or is tilted.
  // The live value is shown as a bar in the camera preview — watch it while pinching to tune.
  pinchOn: 0.42,        // below this a pinch starts
  pinchOff: 0.6,        // above this (for pinchReleaseMs) it ends
  pinchReleaseMs: 90,   // ignore one-frame tracking glitches so a drag doesn't break
  handLostMs: 400,      // how long a hand may vanish before we treat it as gone
  fistHoldMs: 900,      // hold a fist this long to go back
  mouseIdleMs: 15000,   // mouse / keyboard counts as "a visitor is here" this long after the last use
  // launch gesture: a real down-to-up movement. Holding a raised hand still never counts.
  swipeFromFrac: 0.5,   // the movement must start in the lower part of the screen (below this fraction of its height)...
  swipeUpFrac: 0.3,     // ...rise at least this fraction of the screen height...
  swipeUpMs: 700,       // ...within this long, with an open hand
};

const FINGERS = [ // [tip, pip] for index, middle, ring, pinky
  [8, 6], [12, 10], [16, 14], [20, 18],
];

// What the app reads.
export class Pointer {
  constructor() {
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    this.source = 'none';      // 'hand' | 'mouse' | 'none'
    this.present = false;      // someone is controlling the cursor
    this.pressed = false;      // pinch (hand) or button down (mouse)
    this.fist = false;
    this.backProgress = 0;     // 0..1 while a fist is held, before 'back' fires
    this.events = [];          // {type:'press'|'release'|'zoom'|'back', ...}
  }
  push(e) { this.events.push(e); }
  drain() { const e = this.events; this.events = []; return e; }
}

// Shared shape of an input source: position, state, and its own event queue.
class Source {
  constructor(name) {
    this.name = name;
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    this.present = false;
    this.pressed = false;
    this.fist = false;
    this.events = [];
  }
  press() { if (!this.pressed) { this.pressed = true; this.events.push({ type: 'press' }); } }
  release() { if (this.pressed) { this.pressed = false; this.events.push({ type: 'release' }); } }
  drain() { const e = this.events; this.events = []; return e; }
}

export class HandInput extends Source {
  constructor({ video, overlay, status }) {
    super('hand');
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.statusEl = status;
    this.ready = false;
    this.lastVideoTime = -1;
    this.lastHandAt = -Infinity;
    this.raw = { x: this.x, y: this.y };
    this.pinchRatio = null;
    this.pinchHighSince = null;
    this.pinchPoint = null;
  }

  status(text) { this.statusEl.textContent = text; }

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();
    } catch (err) {
      console.warn('Camera unavailable:', err);
      this.status('カメラが使えません — マウスで操作できます / No camera — use the mouse');
      return false;
    }

    this.status('手の認識を準備中… / Loading hand tracking…');
    const fileset = await FilesetResolver.forVisionTasks('./node_modules/@mediapipe/tasks-vision/wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: './models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      console.warn('GPU delegate failed, using CPU:', err);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
    this.overlay.width = this.video.videoWidth || 640;
    this.overlay.height = this.video.videoHeight || 480;
    this.status('');
    this.ready = true;
    return true;
  }

  // Call once per animation frame.
  update(now) {
    if (!this.ready || this.video.readyState < 2) return;
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, now);
      const hand = result.landmarks && result.landmarks[0];
      const world = result.worldLandmarks && result.worldLandmarks[0];
      if (hand) this.readHand(hand, now, world);
      this.draw(hand);
    }

    // hand vanished
    if (this.present && now - this.lastHandAt > CONFIG.handLostMs) {
      this.release();
      this.fist = false;
      this.present = false;
    }

    // smooth the cursor toward the raw fingertip position
    if (this.present) {
      const dx = this.raw.x - this.x, dy = this.raw.y - this.y;
      const d = Math.hypot(dx, dy);
      const a = Math.min(CONFIG.smoothMax, CONFIG.smoothMin + d / 260);
      this.x += dx * a;
      this.y += dy * a;
    }
  }

  // lm: normalized image landmarks (for the cursor); world: metric 3D landmarks (for gestures)
  readHand(lm, now, world) {
    const W = this.overlay.width, H = this.overlay.height;
    const d3 = world
      ? (a, b) => Math.hypot(world[a].x - world[b].x, world[a].y - world[b].y, world[a].z - world[b].z)
      : (a, b) => Math.hypot((lm[a].x - lm[b].x) * W, (lm[a].y - lm[b].y) * H);

    // cursor = point between thumb tip and index tip. It barely moves when the fingers close,
    // so pinching doesn't knock the cursor off what you're pointing at.
    const cx = (lm[4].x + lm[8].x) / 2, cy = (lm[4].y + lm[8].y) / 2;
    this.pinchPoint = { x: cx, y: cy };
    const r = CONFIG.region;
    this.raw.x = clamp((1 - cx - r.x0) / (r.x1 - r.x0), 0, 1) * innerWidth;
    this.raw.y = clamp((cy - r.y0) / (r.y1 - r.y0), 0, 1) * innerHeight;

    if (!this.present) { // hand just appeared: jump instead of sliding in
      this.x = this.raw.x; this.y = this.raw.y;
    }
    this.present = true;
    this.lastHandAt = now;

    const palm = d3(0, 9) || 1;
    const ratio = d3(4, 8) / palm;
    this.pinchRatio = ratio;

    // fist: all four fingertips clearly closer to the wrist than their middle joints
    const curled = FINGERS.every(([tip, pip]) => d3(tip, 0) < d3(pip, 0) * 0.9);

    if (!this.pressed) {
      if (ratio < CONFIG.pinchOn && !curled) this.press();
      this.pinchHighSince = null;
    } else if (ratio > CONFIG.pinchOff) {
      // release only after the fingers stay apart briefly
      if (this.pinchHighSince === null) this.pinchHighSince = now;
      if (now - this.pinchHighSince >= CONFIG.pinchReleaseMs) {
        this.release();
        this.pinchHighSince = null;
      }
    } else {
      this.pinchHighSince = null;
    }
    this.fist = curled && !this.pressed;
  }

  draw(hand) {
    const { ctx } = this;
    const W = this.overlay.width, H = this.overlay.height;
    ctx.clearRect(0, 0, W, H);
    const r = CONFIG.region;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect((1 - r.x1) * W, r.y0 * H, (r.x1 - r.x0) * W, (r.y1 - r.y0) * H);
    ctx.setLineDash([]);
    if (!hand) return;
    ctx.strokeStyle = 'rgba(143,211,255,0.9)';
    ctx.lineWidth = 3;
    for (const c of HandLandmarker.HAND_CONNECTIONS) {
      const a = hand[c.start], b = hand[c.end];
      ctx.beginPath();
      ctx.moveTo(a.x * W, a.y * H);
      ctx.lineTo(b.x * W, b.y * H);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const l of hand) {
      ctx.beginPath(); ctx.arc(l.x * W, l.y * H, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    const pp = this.pinchPoint || hand[8];
    ctx.fillStyle = this.pressed ? '#ffd166' : '#5ff2ff';
    ctx.beginPath(); ctx.arc(pp.x * W, pp.y * H, 8, 0, Math.PI * 2); ctx.fill();

    // pinch meter (left edge of the mirrored preview): bar = current thumb–index ratio,
    // yellow line = pinchOn, white line = pinchOff. The bar must drop below yellow to pinch.
    if (this.pinchRatio !== null) {
      const max = 1.2, bw = 14, bx = W - bw - 6, top = 10, bh = H - 20;
      const y = (v) => top + bh * (1 - Math.min(v, max) / max);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, top, bw, bh);
      ctx.fillStyle = this.pressed ? '#ffd166' : '#5ff2ff';
      ctx.fillRect(bx, y(this.pinchRatio), bw, top + bh - y(this.pinchRatio));
      ctx.fillStyle = '#ffd166'; ctx.fillRect(bx - 4, y(CONFIG.pinchOn) - 1.5, bw + 8, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - 4, y(CONFIG.pinchOff) - 1.5, bw + 8, 3);
    }
  }
}

// Mouse fallback (handy for development, or if the camera fails at the venue).
// Keyboard use also counts as activity, so operator keys keep the attract screen away.
export class MouseInput extends Source {
  constructor() {
    super('mouse');
    this.lastActive = -Infinity;
    const touch = () => { this.lastActive = performance.now(); };
    addEventListener('mousemove', (e) => { this.x = e.clientX; this.y = e.clientY; touch(); });
    addEventListener('mousedown', (e) => { if (e.button === 0) { touch(); this.press(); } });
    addEventListener('mouseup', () => this.release());
    addEventListener('wheel', (e) => {
      touch();
      this.events.push({ type: 'zoom', delta: Math.sign(e.deltaY) });
    }, { passive: true });
    addEventListener('keydown', touch);
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(now) { this.present = now - this.lastActive < CONFIG.mouseIdleMs; }
}

// Picks the active source (a hand wins over the mouse) and turns a held fist into a 'back' event.
export class Input {
  constructor({ video, overlay, status }) {
    this.pointer = new Pointer();
    this.hand = new HandInput({ video, overlay, status });
    this.mouse = new MouseInput();
    this.active = null;
    this.fistSince = null;
    this.fistDone = false;
    this.trail = [];       // recent cursor heights, for the swipe-up gesture
    this.swipeReadyAt = 0;
  }

  start() { return this.hand.start(); }

  // Call once per animation frame.
  update(now) {
    const p = this.pointer;
    try { this.hand.update(now); } catch (err) { console.error('hand tracking error', err); }
    this.mouse.update(now);

    const src = this.hand.present ? this.hand : this.mouse.present ? this.mouse : null;
    if (src !== this.active) {
      // a new source must press on its own; never carry a press (or a drag) across
      if (p.pressed) { p.pressed = false; p.push({ type: 'release' }); }
      this.active = src;
    }

    const handEvents = this.hand.drain(), mouseEvents = this.mouse.drain();
    for (const e of [...handEvents, ...mouseEvents]) {
      if (e.type === 'zoom') p.push(e); // the wheel works whoever is pointing
    }
    for (const e of src === this.hand ? handEvents : src === this.mouse ? mouseEvents : []) {
      if (e.type === 'press' && !p.pressed) { p.pressed = true; p.push(e); }
      else if (e.type === 'release' && p.pressed) { p.pressed = false; p.push(e); }
    }

    p.source = src ? src.name : 'none';
    p.present = !!src;
    if (src) { p.x = src.x; p.y = src.y; }
    p.fist = !!src && src.fist;

    // swipe up (launch): the cursor starts low and rises far and fast with an open hand
    if (src && !p.pressed && !p.fist) {
      this.trail.push({ t: now, y: p.y });
      while (this.trail[0].t < now - CONFIG.swipeUpMs) this.trail.shift();
      const lowest = Math.max(...this.trail.map((s) => s.y));
      if (lowest > CONFIG.swipeFromFrac * innerHeight && lowest - p.y > CONFIG.swipeUpFrac * innerHeight && now >= this.swipeReadyAt) {
        p.push({ type: 'swipeup' });
        this.trail = [];
        this.swipeReadyAt = now + 1000;
      }
    } else {
      this.trail = [];
    }

    // fist held → 'back' once, then wait until the hand opens again
    if (p.fist) {
      if (this.fistSince === null) this.fistSince = now;
      const k = (now - this.fistSince) / CONFIG.fistHoldMs;
      if (!this.fistDone && k >= 1) { this.fistDone = true; p.push({ type: 'back' }); }
      p.backProgress = this.fistDone ? 0 : Math.min(k, 1);
    } else {
      this.fistSince = null;
      this.fistDone = false;
      p.backProgress = 0;
    }
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
