// "The roundabout way is the shortest" (design.md):
//   Step 1  aim straight at Mars: the rocket keeps Earth's 30 km/s and curves, and Mars moves on meanwhile
//   Step 2  burn along Earth's motion at the right moment: a half ellipse meets Mars
//   Reveal  both paths and their fuel, against flying a straight line
// Fuel is always the real burn from / into a 300 km parking orbit, whichever engine is used.
import type { EngineFactory, PhysicsEngine, State, Vec2 } from '../physics/index.ts';
import { UnsupportedSetup, add, dist, len, norm, scale, sub, vec } from '../physics/index.ts';
import type { GameInput } from './input.ts';
import type { Planet } from './solar.ts';
import {
  DAYS_PER_YEAR, EARTH_BODY, EARTH_R, KMS, MARS_BODY, MARS_R, SUN,
  burnFromOrbit, escapeFromOrbit, hohmann, planetAttractor, planetPos, planetVel, straightLineDv,
} from './solar.ts';

// rates are simulated years per real second
export const CONFIG = {
  aimRate: 0.04,
  flyRate: 0.2,           // Earth to Mars in about 3.5 s
  fastForward: 6,
  // burns are set as the excess speed left after escaping Earth, AU/yr
  step1Vinf: 3.5 / KMS,   // more than the good path needs, so step 1 is a fair try
  maxVinf: 6 / KMS,
  budgetKms: 10,
  capture: 0.08,          // AU; far larger than Mars's sphere of influence, or nobody could hit it
  flightLimit: 1.1,       // years
  step1MarsLeadDeg: 60,
  step2WaitDeg: 70,       // degrees of phase before the ideal moment, so step 2 starts with a wait
  straightLineYears: 0.25
};

type Phase = 'aim1' | 'fly1' | 'after1' | 'aim2' | 'fly2' | 'miss2' | 'reveal';
interface Flight {
  launch: State;
  trail: Vec2[];
  dvDepart: number;
  crossing: { t: number; index: number } | null;
  arrival: { t: number; dvArrive: number } | null;
}

const EARTH_START = -Math.PI / 2; // bottom of the screen

export class Game {
  private phase: Phase = 'aim1';
  private t = 0;
  private earth: Planet = { name: 'Earth', r: EARTH_R, phase0: EARTH_START };
  private mars: Planet = { name: 'Mars', r: MARS_R, phase0: 0 };
  private ship: State | null = null;
  private flight: Flight | null = null;
  private first: Flight | null = null;
  private second: Flight | null = null;
  private straight = 0; // AU/yr
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly makeEngine: EngineFactory;
  private engine!: PhysicsEngine;
  private planetsPull = false;
  private readonly input: GameInput;
  private readonly stars: Vec2[] = Array.from({ length: 160 }, () => vec(Math.random(), Math.random()));

  constructor(canvas: HTMLCanvasElement, makeEngine: EngineFactory, input: GameInput) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.makeEngine = makeEngine;
    this.input = input;
    input.onSelect(() => this.select());
    this.setup('aim1');
  }

  // ---------- flow ----------
  private setup(phase: 'aim1' | 'aim2') {
    this.phase = phase;
    this.t = 0;
    this.ship = null;
    const lead = phase === 'aim1' ? CONFIG.step1MarsLeadDeg * Math.PI / 180
      : hohmann(EARTH_R, MARS_R).lead + CONFIG.step2WaitDeg * Math.PI / 180;
    this.mars = { ...this.mars, phase0: EARTH_START + lead };
    // the planets' phases changed, so they are new attractors
    try {
      this.engine = this.makeEngine({ attractors: [SUN, planetAttractor(this.earth, EARTH_BODY), planetAttractor(this.mars, MARS_BODY)] });
      this.planetsPull = true;
    } catch (err) {
      if (!(err instanceof UnsupportedSetup)) throw err;
      this.engine = this.makeEngine({ attractors: [SUN] });
      this.planetsPull = false;
    }
  }

  private departure(vInf: Vec2): State {
    const e = planetPos(this.earth, this.t), ev = planetVel(this.earth, this.t);
    if (!this.planetsPull) return { t: this.t, pos: e, vel: add(ev, vInf) };
    const rel = escapeFromOrbit(EARTH_BODY, vInf);
    return { t: this.t, pos: add(e, rel.pos), vel: add(ev, rel.vel) };
  }

  private select() {
    switch (this.phase) {
      case 'aim1': {
        const p = this.pointerWorld();
        if (p) this.launch(scale(norm(sub(p, planetPos(this.earth, this.t))), CONFIG.step1Vinf));
        break;
      }
      case 'aim2': this.launch(this.burn2()); break;
      case 'after1': this.setup('aim2'); break;
      case 'miss2': this.setup('aim2'); break;
      case 'reveal': this.first = this.second = null; this.setup('aim1'); break;
    }
  }

  private launch(vInf: Vec2) {
    const launch = this.departure(vInf);
    this.ship = launch;
    this.flight = { launch, trail: [launch.pos], dvDepart: burnFromOrbit(EARTH_BODY, len(vInf)), crossing: null, arrival: null };
    this.phase = this.phase === 'aim1' ? 'fly1' : 'fly2';
  }

  private power(): number {
    const p = this.input.pointer;
    const h = this.canvas.clientHeight;
    return p ? Math.min(1, Math.max(0, (h - p.y) / h * 1.25 - 0.1)) : 0;
  }
  private burn2(): Vec2 {
    return scale(norm(planetVel(this.earth, this.t)), this.power() * CONFIG.maxVinf);
  }

  private predict(): { path: Vec2[]; arrive: number; reaches: boolean } {
    const states = this.engine.trajectory(this.departure(this.burn2()), 1, 300);
    // the ideal half ellipse only touches Mars's orbit, so it needs the same tolerance as in flight
    let end = states.findIndex((s) => len(s.pos) >= MARS_R - CONFIG.capture / 2);
    const reaches = end >= 0;
    if (!reaches) end = states.reduce((best, s, i) => (len(s.pos) > len(states[best].pos) ? i : best), 0);
    return { path: states.slice(0, end + 1).map((s) => s.pos), arrive: states[end].t, reaches };
  }

  update(realDt: number) {
    const dt = Math.min(realDt, 0.05);
    if (this.phase === 'aim1' || this.phase === 'aim2') {
      this.t += dt * CONFIG.aimRate * (this.input.fastForward ? CONFIG.fastForward : 1);
    } else if (this.phase === 'fly1' || this.phase === 'fly2') {
      this.fly(dt * CONFIG.flyRate);
    }
  }

  private fly(span: number) {
    const f = this.flight!;
    // positions straight from the launch state; 0.002 yr is only the spacing of drawing and capture checks
    for (let left = span; left > 0 && this.ship; left -= 0.002) {
      const h = Math.min(0.002, left);
      this.t += h;
      this.ship = this.engine.advance(f.launch, this.t - f.launch.t);
      f.trail.push(this.ship.pos);
      if (!f.crossing && len(this.ship.pos) >= MARS_R - CONFIG.capture / 2) f.crossing = { t: this.t, index: f.trail.length - 1 };
      if (this.gap(f, this.t) < CONFIG.capture) {
        // measuring the arrival speed at zone entry, while still climbing, would overcharge a perfect launch
        const ta = this.closestApproach(f, this.t);
        for (let t = this.t + 0.002; t < ta; t += 0.002) f.trail.push(this.engine.advance(f.launch, t - f.launch.t).pos);
        this.t = ta;
        this.ship = this.engine.advance(f.launch, ta - f.launch.t);
        f.trail.push(this.ship.pos);
        f.arrival = { t: ta, dvArrive: burnFromOrbit(MARS_BODY, len(sub(this.ship.vel, planetVel(this.mars, ta)))) };
        return this.endFlight();
      }
      if (this.t - f.launch.t > CONFIG.flightLimit || len(this.ship.pos) > 2.4) return this.endFlight();
      if (f.crossing && this.t - f.crossing.t > 0.15) return this.endFlight(); // Mars missed
    }
  }

  private gap(f: Flight, t: number): number {
    return dist(this.engine.advance(f.launch, t - f.launch.t).pos, planetPos(this.mars, t));
  }

  private closestApproach(f: Flight, from: number): number {
    const h = 0.002;
    let a = from - h, b = from;
    while (this.gap(f, b + h) < this.gap(f, b) && b - from < 0.5) { a = b; b += h; }
    let lo = a, hi = b + h;
    const k = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 60; i++) {
      const m1 = hi - k * (hi - lo), m2 = lo + k * (hi - lo);
      if (this.gap(f, m1) < this.gap(f, m2)) hi = m2; else lo = m1;
    }
    return (lo + hi) / 2;
  }

  private endFlight() {
    const f = this.flight!;
    this.ship = null;
    if (this.phase === 'fly1') {
      // freeze on reaching Mars's orbit, where the gap to Mars tells the story
      if (!f.arrival && f.crossing) { this.t = f.crossing.t; f.trail = f.trail.slice(0, f.crossing.index + 1); }
      this.first = f;
      this.phase = 'after1';
      return;
    }
    if (!f.arrival) { this.second = f; this.phase = 'miss2'; return; }
    this.second = f;
    const tl = f.launch.t;
    this.straight = straightLineDv(this.engine,
      { pos: planetPos(this.earth, tl), vel: planetVel(this.earth, tl), t: tl },
      { pos: planetPos(this.mars, tl + CONFIG.straightLineYears), vel: planetVel(this.mars, tl + CONFIG.straightLineYears) },
      CONFIG.straightLineYears);
    this.phase = 'reveal';
  }

  // ---------- drawing ----------
  private view() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { cx: w / 2, cy: h / 2, k: Math.min(w, h) / 2 / 1.8 };
  }
  private toScreen(p: Vec2): Vec2 { const v = this.view(); return vec(v.cx + p.x * v.k, v.cy - p.y * v.k); }
  private pointerWorld(): Vec2 | null {
    const p = this.input.pointer;
    if (!p) return null;
    const v = this.view();
    return vec((p.x - v.cx) / v.k, (v.cy - p.y) / v.k);
  }

  draw() {
    const { ctx, canvas } = this;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const s of this.stars) ctx.fillRect(s.x * w, s.y * h, 1, 1);

    const { cx, cy, k } = this.view();
    for (const r of [EARTH_R, MARS_R]) this.circle(vec(cx, cy), r * k, 'rgba(255,255,255,0.14)', false);
    this.glow(vec(cx, cy), 14, '#ffcc44');

    if (this.first && (this.phase === 'after1' || this.phase === 'reveal')) this.path(this.first.trail, '#ff9a3c', 2);
    if (this.second && (this.phase === 'miss2' || this.phase === 'reveal')) this.path(this.second.trail, '#5fe0ff', 2.5);
    if (this.flight && (this.phase === 'fly1' || this.phase === 'fly2')) this.path(this.flight.trail, this.phase === 'fly1' ? '#ff9a3c' : '#5fe0ff', 2);

    const earth = this.toScreen(planetPos(this.earth, this.t));
    const mars = this.toScreen(planetPos(this.mars, this.t));

    if (this.phase === 'aim1' && this.input.pointer) {
      this.dashed([earth, this.input.pointer], 'rgba(255,255,255,0.6)');
    }
    let now = false;
    if (this.phase === 'aim2') {
      const pr = this.predict();
      const ghost = planetPos(this.mars, pr.arrive);
      now = pr.reaches && dist(pr.path[pr.path.length - 1], ghost) < CONFIG.capture;
      this.dashed(pr.path.map((p) => this.toScreen(p)), now ? '#7dff9a' : 'rgba(95,224,255,0.8)');
      this.circle(this.toScreen(ghost), 9, now ? '#7dff9a' : 'rgba(255,106,61,0.8)', false);
      this.label(this.toScreen(ghost), now ? '到着時の火星 ✔' : '到着時の火星', 12, now ? '#7dff9a' : '#ff8a66');
      this.arrow(earth, add(earth, scale(norm(sub(this.toScreen(add(planetPos(this.earth, this.t), planetVel(this.earth, this.t))), earth)), 30 + this.power() * 60)), '#5fe0ff');
    }
    if (this.phase === 'after1' && this.first) {
      const l = this.first.launch;
      const from = this.toScreen(l.pos);
      const tip = this.toScreen(add(l.pos, scale(planetVel(this.earth, l.t), 0.08)));
      this.arrow(from, tip, '#ffffff');
      this.label(tip, '地球の速さ 秒速30km', 14, '#ffffff');
      const end = this.toScreen(this.first.trail[this.first.trail.length - 1]);
      this.glow(end, 4, '#ffffff');
      this.label(end, 'ロケット', 13, '#ffd2a8');
    }

    this.glow(earth, 7, '#4da3ff');
    this.label(earth, '地球', 13, '#9cc9ff');
    this.glow(mars, 6, '#ff6a3d');
    this.label(mars, '火星', 13, '#ffb199');
    if (this.ship) this.glow(this.toScreen(this.ship.pos), 4, '#ffffff');

    this.hud(now);
  }

  private hud(now: boolean) {
    const days = (y: number) => Math.round(y * DAYS_PER_YEAR);
    const kms = (v: number) => (v * KMS).toFixed(1);
    const lines: [string, string, number?][] = [];
    switch (this.phase) {
      case 'aim1':
        lines.push(['STEP 1  火星をねらって発射!', '#ffffff', 24], ['Aim at Mars and launch', '#9aa4b8'],
          ['マウスでねらって、クリックで発射 / aim with the mouse, click to launch', '#9aa4b8']);
        break;
      case 'fly1': case 'fly2':
        lines.push([`飛行中… ${days(this.t - this.flight!.launch.t)} 日目`, '#ffffff', 20], [`Day ${days(this.t - this.flight!.launch.t)}`, '#9aa4b8']);
        break;
      case 'after1': {
        const f = this.first!;
        const [title, en] = f.arrival ? ['届いた! でも、たまたま…', 'It got there, but by luck']
          : f.crossing ? ['着いたころ、火星はもういない', 'By the time it got there, Mars had moved on']
          : ['まっすぐねらっても、届かない', "Aiming straight at Mars doesn't get you there"];
        lines.push([title, '#ff9a3c', 24], [en, '#9aa4b8'],
          ['ロケットは地球の速さ(秒速30km)のまま飛び出すので、まっすぐ飛ばずに太陽のまわりをカーブする。', '#ffffff'],
          ["The rocket leaves with Earth's 30 km/s, so it doesn't fly straight: it curves around the Sun.", '#9aa4b8'],
          ['しかも、着くまでの何か月かのあいだに、火星も進んでいく。', '#ffffff'],
          ['And in the months it takes, Mars moves on too.', '#9aa4b8'],
          ['クリックで次へ / click to continue', '#7dff9a']);
        break;
      }
      case 'aim2':
        lines.push(['STEP 2  地球の進む方向へ、加速しよう', '#ffffff', 24], ["Speed up in the direction Earth is moving", '#9aa4b8'],
          ['上下で強さ、点線の先に火星(○)が来たらクリック', '#9aa4b8'],
          ['move up/down to set the burn; click when Mars (○) meets the end of the path', '#9aa4b8'],
          [`加速 ${kms(burnFromOrbit(EARTH_BODY, this.power() * CONFIG.maxVinf))} km/s  (地球をまわる軌道から / from low Earth orbit)`, '#5fe0ff', 18],
          [now ? '今だ! / Now!' : 'スペースキー長押しで早送り / hold Space to fast-forward', now ? '#7dff9a' : '#59627a', now ? 22 : undefined]);
        break;
      case 'miss2':
        lines.push(['おしい! もう一度', '#ff9a3c', 24], ['So close! Try again', '#9aa4b8'],
          ['ヒント: 点線の先と「到着時の火星」が重なる瞬間に発射', '#ffffff'],
          ['hint: launch when the end of the path and the ○ meet', '#9aa4b8'],
          ['クリックでもう一度 / click to retry', '#7dff9a']);
        break;
      case 'reveal': {
        const f = this.second!;
        const used = (f.dvDepart + f.arrival!.dvArrive) * KMS;
        const left = Math.max(0, 1 - used / CONFIG.budgetKms);
        const ideal = hohmann(EARTH_R, MARS_R);
        const idealBurns = burnFromOrbit(EARTH_BODY, ideal.depart) + burnFromOrbit(MARS_BODY, ideal.arrive);
        lines.push(['遠回りが、いちばんの近道', '#7dff9a', 28], ['The roundabout way is the shortest', '#9aa4b8'],
          [`あなたの道:  ${used.toFixed(1)} km/s ぶんの加速  (燃料のこり ${Math.round(left * 100)}%) · ${days(f.arrival!.t - f.launch.t)} 日`, '#5fe0ff', 18],
          [`Your path: ${used.toFixed(1)} km/s of speed change, ${days(f.arrival!.t - f.launch.t)} days`, '#9aa4b8'],
          [`まっすぐ3か月で行くと:  ${(this.straight * KMS).toFixed(0)} km/s  (燃料タンク ${Math.ceil(this.straight * KMS / CONFIG.budgetKms)} 個ぶん)`, '#ff9a3c', 18],
          [`A straight line in 3 months: ${(this.straight * KMS).toFixed(0)} km/s`, '#9aa4b8'],
          [`いちばん少ない理想の道 (ホーマン軌道):  ${(idealBurns * KMS).toFixed(1)} km/s · ${days(ideal.time)} 日`, '#ffffff'],
          ['(地球をまわる軌道を出発して、火星をまわる軌道に入るまで / from low Earth orbit into low Mars orbit)', '#59627a', 13],
          ['となりの星へ行くだけで、何か月もかかり、燃料のほとんどを使う。地球には、空気も水も、はじめからある。', '#ffffff'],
          ['Just reaching our neighbour takes months and most of the fuel. Earth gives us air and water from the start.', '#9aa4b8'],
          ['クリックで最初から / click to start over', '#7dff9a']);
        break;
      }
    }
    const { ctx } = this;
    let y = 40;
    const maxWidth = this.canvas.clientWidth - 56;
    for (const [text, color, size = 15] of lines) {
      ctx.font = `${size >= 20 ? 'bold ' : ''}${size}px system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      for (const row of this.wrap(text, maxWidth)) {
        ctx.fillText(row, 28, y);
        y += size + 6;
      }
      y += 4;
    }
    if (this.phase === 'reveal') this.nerdNote();
    if (this.phase === 'aim2') {
      const p = this.power();
      const x = this.canvas.clientWidth - 48, top = 80, height = this.canvas.clientHeight - 160;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(x, top, 18, height);
      ctx.fillStyle = '#5fe0ff';
      ctx.fillRect(x, top + height * (1 - p), 18, height * p);
      const ideal = hohmann(EARTH_R, MARS_R).depart / CONFIG.maxVinf;
      ctx.fillStyle = 'rgba(125,255,154,0.25)';
      ctx.fillRect(x - 6, top + height * (1 - ideal) - 1, 30, 2);
    }
  }

  private nerdNote() {
    const how = this.planetsPull
      ? ['このゲームは「パッチド・コニック法」で計算しています。3つ以上の天体が引っぱり合う「三体問題」には、一般に解の公式がありません(ポアンカレ, 1890年ごろ)。そこで、ロケットがどの星の重力圏にいるかで飛行を区切り、区間ごとに「2体問題」として正確に解いています。実際の宇宙機の計画も、まずこの方法で立てられます。',
        "Computed with patched conics. The three-body problem has no general formula (Poincaré, 1890s), so the flight is split by whose sphere of influence the rocket is in, and each piece is solved exactly as a two-body problem. Real missions are first planned this way."]
      : ['このゲームは、太陽の重力だけを考えた「2体問題」を、時間を刻まずに正確に解いています。',
        "Computed as an exact two-body problem (the Sun's gravity only), with no time steps."];
    const { ctx } = this;
    const maxWidth = this.canvas.clientWidth - 56;
    ctx.font = '12px system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif';
    const rows = [['もっと知りたい人へ / For nerds', '#7a849c'], ...how.flatMap((t) => this.wrap(t, maxWidth).map((r) => [r, '#59627a']))];
    let y = this.canvas.clientHeight - 20 - (rows.length - 1) * 17;
    for (const [text, color] of rows) {
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(text, 28, y);
      y += 17;
    }
  }

  // breaks between words for English, anywhere for Japanese
  private wrap(text: string, maxWidth: number): string[] {
    const rows: string[] = [];
    let row = '';
    for (const token of text.match(/[\x21-\x7e]+\s*|\s+|./gu) ?? []) {
      const noLineStart = /^[、。，．・ー）」』】!?！？]/.test(token); // Japanese rule: these never start a line
      if (row && !noLineStart && this.ctx.measureText(row + token).width > maxWidth) { rows.push(row.trimEnd()); row = token.trimStart(); }
      else row += token;
    }
    if (row) rows.push(row);
    return rows;
  }

  private circle(c: Vec2, r: number, color: string, fill: boolean) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = color; ctx.fill(); } else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  private glow(c: Vec2, r: number, color: string) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 3);
    g.addColorStop(0, color);
    g.addColorStop(0.35, color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  private path(points: Vec2[], color: string, width: number) {
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => { const s = this.toScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  private dashed(points: Vec2[], color: string) {
    const { ctx } = this;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  private arrow(from: Vec2, to: Vec2, color: string) {
    const { ctx } = this;
    const d = norm(sub(to, from));
    const side = vec(-d.y, d.x);
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(to.x + d.x * 8, to.y + d.y * 8);
    ctx.lineTo(to.x + side.x * 5, to.y + side.y * 5);
    ctx.lineTo(to.x - side.x * 5, to.y - side.y * 5);
    ctx.fill();
  }
  private label(at: Vec2, text: string, size: number, color: string) {
    const { ctx } = this;
    ctx.font = `${size}px system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, at.x, at.y - 16);
  }
}
