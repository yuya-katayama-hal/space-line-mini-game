import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { ERAS, FLOW } from './content.js';
import { DESTINATIONS } from './destinations.js';
import { LaunchScene } from './scenes/launch.js';
import { SpaceScene } from './scenes/space.js';

// ---- Experience timing (adjust on site) ----
const SETTINGS = {
  dwellMs: 1400,        // hold the cursor still on something this long to select it
  pinchLookbackMs: 200, // select what was hovered just before the fingers closed
  turnIdleMs: 45000,    // during a turn, no hand for this long ends it (seated visitors rest their hands while reading)
  finaleMs: 20000,      // the closing message ends the turn after this long, or on a fist
  homecomingMs: 6000,   // on the way home, Earth grows in the window for this long
};
// fist hold time, mouse idle time and the swipe-up gesture are in js/input.js → CONFIG

// The story is set in 2126: the visitor already lives then, so no scene changes the year.
const YEAR = +ERAS.launch.year;

// One turn: attract → launch → space (pick a gate) → destination → return → finale → attract.
// Back (fist / Esc / button) never goes "up a level" any more: from space or a destination it flies home.

// ---------- renderer ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const DEST = Object.fromEntries(DESTINATIONS.map((d) => [d.id, d]));
const scenes = { launch: new LaunchScene(), space: new SpaceScene(DESTINATIONS) };
for (const d of DESTINATIONS) scenes[d.id] = new d.Scene();
let activeKey = 'launch';
let active = scenes.launch;

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(active.scene, active.camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.8, 0.5, 0.7);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// compile every scene up front so the first warp doesn't stutter
for (const s of Object.values(scenes)) renderer.compile(s.scene, s.camera);

// ---------- input + UI ----------
const ui = new UI();
const input = new Input({
  video: document.getElementById('cam'),
  overlay: document.getElementById('cam-overlay'),
  status: document.getElementById('cam-status'),
});
const pointer = input.pointer;
input.start().catch((err) => {
  console.error(err);
  input.hand.status('手の認識を開始できません — マウスで操作できます / Hand tracking failed — use the mouse');
});

// ---------- registration queue (optional: the booth runs walk-in only if it can't connect) ----------
// Staff sign-in for the booth (it marks tickets playing / done) depends on the backend: with a shared key
// (local server with OPERATOR_KEY) open the booth as /?key=<the key>; with accounts (Firebase) sign in once on
// operator.html in the same browser profile. The backend comes from ENVIRONMENT in js/queue/config.js only.
let queue = null, queueState = null;
import('./queue/index.js')
  .then((m) => m.connectQueue())
  .then(async (q) => {
    const key = new URLSearchParams(location.search).get('key');
    if (key && q.auth.method === 'key') await q.auth.signIn(key);
    queue = q;
    ui.setQueue(null, q.registerUrl);
    q.watchQueue((s) => { queueState = s; ui.setQueue(s, q.registerUrl); bindCalledTicket(); });
  })
  .catch((err) => console.warn('Queue unavailable, walk-in only:', err));
const queueCall = (p) => p && p.catch((err) => console.warn('Queue update failed:', err));

// DOM buttons are targets too, so they can be hovered / pinched like 3D objects.
const BACK_T = { id: 'back', kind: 'dom', el: ui.backEl, action: 'back' };
const CLOSE_T = { id: 'close', kind: 'dom', el: ui.closeEl, action: 'close', tag: 'とじる' };

const state = {
  phase: 'attract',     // attract | launch | space | dest | return | finale
  hover: null,
  history: [],          // recent hover targets, for pinch lookback
  dwellTarget: null, dwellStart: 0, dwellLocked: null,
  dragging: false, dragLast: { x: 0, y: 0 },
  transitioning: false,
  lastPresent: -Infinity,
  needAbsence: false,   // after a turn, wait for the visitor to leave before the next one starts
};
const turn = { active: false, token: 0, ticket: null, finaleAt: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (fn) => new Promise((r) => { const tick = () => (fn() ? r() : requestAnimationFrame(tick)); tick(); });

function activate(key) {
  active.exit();
  activeKey = key;
  active = scenes[key];
  renderPass.scene = active.scene;
  renderPass.camera = active.camera;
  bloom.strength = active.bloom.strength;
  bloom.radius = active.bloom.radius;
  bloom.threshold = active.bloom.threshold;
  renderer.toneMappingExposure = active.exposure;
  active.enter();
  ui.setEra(key, ERAS[key]);
  ui.buildTags(active.targets);
  ui.hideCard();
  state.hover = null;
  state.dwellLocked = null;
  updateBack();
}

function updateBack() {
  const p = state.phase;
  if (p === 'space') ui.setBack(true, ...(active.canGoBack() ? FLOW.backEarthView : FLOW.backHome));
  else if (p === 'dest') ui.setBack(true, ...FLOW.backHome);
  else if (p === 'finale') ui.setBack(true, ...FLOW.finish);
  else ui.setBack(false);
}

function setPhase(p) {
  state.phase = p;
  updateBack();
}

const canBack = () => ['space', 'dest', 'finale'].includes(state.phase) && !state.transitioning;

// ---------- the turn ----------
function startTurn() {
  turn.active = true;
  turn.token++;
  turn.ticket = null;
  activate('launch');
  scenes.launch.reset();
  setPhase('launch');
  ui.caption(FLOW.launchHint);
  bindCalledTicket();
}

// The called visitor's ticket becomes this turn's only after they have checked in on the NFC tag (proof that the
// person who registered is here). Until then the booth asks for the tap; if it arrives during the turn, it binds then.
function bindCalledTicket() {
  if (!turn.active || turn.ticket || !queue || !['launch', 'space', 'dest'].includes(state.phase)) return;
  const s = queueState && queueState.serving;
  if (!s || s.status !== 'called') return;
  if (!s.checkedInAt) {
    if (state.phase === 'launch' && !state.transitioning) ui.caption(`${FLOW.needCheckin(s.number, s.nickname)}\n${FLOW.launchHint}`);
    return;
  }
  turn.ticket = s;
  queueCall(queue.setStatus(s.id, 'playing'));
  if (state.phase === 'launch' && !state.transitioning) ui.caption(`${FLOW.welcome(s.nickname)}\n${FLOW.launchHint}`);
}

function endTurn() {
  if (turn.ticket && queue) queueCall(queue.setStatus(turn.ticket.id, 'done'));
  turn.active = false;
  turn.ticket = null;
  turn.token++; // cancels any sequence still running
  state.transitioning = false;
  state.dragging = false;
  state.needAbsence = true;
  ui.hideFinale();
  ui.caption('');
  ui.countdown('');
  activate('launch');
  scenes.launch.reset();
  setPhase('attract');
}

async function launch() {
  if (state.phase !== 'launch' || state.transitioning) return;
  const tok = turn.token;
  state.transitioning = true;
  ui.caption('');
  for (const n of ['3', '2', '1']) {
    ui.countdown(n);
    await sleep(1000);
    if (tok !== turn.token) return;
  }
  ui.countdown(FLOW.liftoff);
  scenes.launch.liftoff();
  await sleep(1500);
  ui.countdown('');
  await sleep(2500);
  if (tok !== turn.token) return;
  await ui.warp(YEAR, YEAR, FLOW.toSpace, '#ffffff', () => { if (tok === turn.token) { activate('space'); setPhase('space'); } });
  if (tok !== turn.token) return;
  state.transitioning = false;
  ui.caption(FLOW.chooseHint, 7000);
}

// fly to a scene: a destination id (from a gate), or 'space' (operator key)
async function travel(to) {
  if (state.transitioning || to === activeKey || !scenes[to] || to === 'launch') return;
  if (!turn.active) startTurn();
  const d = DEST[to];
  const tok = turn.token;
  state.transitioning = true;
  state.dragging = false;
  ui.hideCard();
  ui.caption('');
  ui.countdown('');
  await ui.warp(+ERAS[activeKey].year, +ERAS[to].year, d ? d.gate.warp : FLOW.toSpace, d ? d.warpColor : '#ffffff',
    () => { if (tok === turn.token) { activate(to); setPhase(d ? 'dest' : 'space'); } });
  if (tok === turn.token) state.transitioning = false;
}

// the return trip: Earth grows in the window, re-entry, the capsule lands, then the closing message
async function goHome() {
  if (state.transitioning || !['space', 'dest'].includes(state.phase)) return;
  const tok = turn.token;
  state.transitioning = true;
  state.dragging = false;
  ui.hideCard();
  ui.caption('');
  setPhase('return');
  await ui.warp(YEAR, YEAR, FLOW.homeWarp, '#9fd8ff', () => {
    if (tok === turn.token) { activate('space'); scenes.space.startHomecoming(SETTINGS.homecomingMs / 1000); }
  });
  if (tok !== turn.token) return;
  ui.caption(FLOW.homeCaption);
  await until(() => scenes.space.homecomingDone || tok !== turn.token);
  if (tok !== turn.token) return;
  await ui.warp(YEAR, YEAR, FLOW.landing, '#ffb070', () => {
    if (tok === turn.token) { activate('launch'); scenes.launch.startLanding(); ui.caption(''); }
  });
  await until(() => scenes.launch.landed || tok !== turn.token);
  await sleep(1500);
  if (tok !== turn.token) return;
  state.transitioning = false;
  turn.finaleAt = performance.now();
  setPhase('finale');
  ui.showFinale(FLOW.finale, turn.ticket && turn.ticket.nickname);
}

// soft = fist / Esc: at a destination, first close the card and zoom back out; next time, fly home
function goBack(soft = false) {
  if (state.transitioning) return;
  const p = state.phase;
  if (p === 'finale') { endTurn(); return; }
  if (p === 'dest') {
    if (soft && (ui.cardOpen || active.rig.follow)) { closeCard(); return; }
    goHome();
  } else if (p === 'space') {
    ui.hideCard();
    if (active.back()) { updateBack(); return; } // looking at another planet → back to Earth first
    goHome();
  }
}

function closeCard() {
  ui.hideCard();
  if (activeKey !== 'space') active.rig.release();
}

function select(t) {
  state.dwellLocked = t;
  if (t.kind === 'dom') {
    if (t.action === 'back') goBack();
    else if (t.action === 'close') closeCard();
    return;
  }
  if (t.action === 'launch') { launch(); return; }
  if (t.action === 'travel') { travel(t.to); return; }
  active.selected(t);
  if (t.info && t.info.title) ui.showCard(t.info);
  if (t.focus) active.rig.focusOn(t.obj, t.focus);
  if (t.onSelect) t.onSelect();
  updateBack();
}

// ---------- hit testing ----------
function hitDom(t, x, y, pad = 14) {
  if (t.el.classList.contains('hidden')) return false;
  const r = t.el.getBoundingClientRect();
  return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
}

function findHover(x, y) {
  if (ui.cardOpen) {
    if (hitDom(CLOSE_T, x, y)) return CLOSE_T;
    if (hitDom({ el: ui.card }, x, y, 0)) return null; // reading the card shouldn't select what's behind it
  }
  if (hitDom(BACK_T, x, y)) return BACK_T;
  if (state.phase === 'finale') return null;
  let best = null, bestScore = Infinity;
  for (const t of active.targets) {
    if (!t._vis) continue;
    const r = Math.max(t._r * 1.1, 46);
    const d = Math.hypot(t._x - x, t._y - y);
    if (d < r && d / r < bestScore) { best = t; bestScore = d / r; }
  }
  return best;
}

function hoverAt(time) {
  for (let i = state.history.length - 1; i >= 0; i--) if (state.history[i].time <= time) return state.history[i].target;
  return state.hover;
}

// ---------- keyboard (operator shortcuts) ----------
addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (e.key === '1') travel('space');
  else if (n >= 2 && DESTINATIONS[n - 2]) travel(DESTINATIONS[n - 2].id);
  else if (e.key === 'l') { if (!turn.active) startTurn(); launch(); }
  else if (e.key === 'h') goHome();
  else if (e.key === 'r') endTurn();
  else if (e.key === 'Escape' || e.key === 'Backspace') goBack(true);
  else if (e.key === 'c') document.getElementById('cam-wrap').classList.toggle('hidden');
  else if (e.key === 'g') document.getElementById('guide').classList.toggle('hidden');
  else if (e.key === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  for (const s of Object.values(scenes)) {
    s.camera.aspect = innerWidth / innerHeight;
    s.camera.updateProjectionMatrix();
  }
});

// ---------- main loop ----------
activate('launch');
setPhase('attract');
let last = performance.now();
const clock0 = last;

function frame() {
  requestAnimationFrame(frame); // schedule first, so one bad frame can't stop the exhibit
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - clock0) / 1000;

  input.update(now);

  // is someone there? start / end turns
  const present = pointer.present;
  if (present) state.lastPresent = now;
  else state.needAbsence = false;
  if (state.phase === 'attract') {
    if (present && !state.needAbsence) startTurn();
  } else if (now - state.lastPresent > SETTINGS.turnIdleMs) {
    endTurn();
  } else if (state.phase === 'finale' && now - turn.finaleAt > SETTINGS.finaleMs) {
    endTurn();
  }
  ui.setAttract(state.phase === 'attract');

  // the scene slowly auto-rotates only while nobody is there, so targets don't drift away from a hand
  if (present) active.rig.idle = 0;

  active.update(dt, t, state.hover);
  active.camera.updateMatrixWorld();
  ui.project(active.targets, active.camera, active.occluders, state.hover);

  // hover + history
  const live = present && !state.transitioning && state.phase !== 'attract';
  const hover = live ? findHover(pointer.x, pointer.y) : null;
  state.hover = hover;
  state.history.push({ time: now, target: hover });
  while (state.history.length && state.history[0].time < now - 500) state.history.shift();
  if (state.dwellLocked && hover !== state.dwellLocked) state.dwellLocked = null;

  // pinch / zoom / back / swipe events
  for (const e of pointer.drain()) {
    if (!live) continue;
    if (e.type === 'press') {
      const target = hoverAt(now - SETTINGS.pinchLookbackMs) || hover;
      if (target) select(target);
      else { state.dragging = true; state.dragLast = { x: pointer.x, y: pointer.y }; }
    } else if (e.type === 'release') {
      state.dragging = false;
    } else if (e.type === 'zoom') {
      active.rig.zoom(e.delta);
    } else if (e.type === 'back' && canBack()) {
      goBack(true);
    } else if (e.type === 'swipeup' && state.phase === 'launch') {
      launch();
    }
  }
  if (!live) state.dragging = false;
  if (state.dragging) {
    active.rig.drag(pointer.x - state.dragLast.x, pointer.y - state.dragLast.y);
    state.dragLast = { x: pointer.x, y: pointer.y };
  }

  // dwell to select
  let progress = 0, mode = 'dwell';
  if (hover && !state.dragging && !pointer.pressed && !pointer.fist && hover !== state.dwellLocked) {
    if (hover !== state.dwellTarget) { state.dwellTarget = hover; state.dwellStart = now; }
    progress = (now - state.dwellStart) / SETTINGS.dwellMs;
    if (progress >= 1) { select(hover); progress = 0; state.dwellTarget = null; }
  } else {
    state.dwellTarget = null;
  }

  // fist to go back: input times the hold and sends 'back' (handled above); show its progress here
  if (pointer.backProgress > 0 && canBack()) {
    mode = 'fist';
    progress = pointer.backProgress;
  }

  composer.render();
  ui.updateCursor(pointer, { visible: present && state.phase !== 'attract', hover, progress, mode, dragging: state.dragging });
}
requestAnimationFrame(frame);

// handy for testing from the browser console
window.voyage = {
  travel, goBack, goHome, launch, startTurn, endTurn, scenes, state, turn, input, pointer, ui, SETTINGS,
  get queue() { return queue; },
};
