Ultimate goal is tell visitors "how the earth is worthy to us".

Backstory: the visitor already lives in 2126. No time travel: Earth, space, the Moon and Mars are all 2126.

## Principle: offline first, online as an extra
* The booth works with no network at all. If the venue Wi-Fi or a visitor's phone goes offline, everyone can still play.
* Anything online (hosted pages, saving, sharing, rankings) only adds to that and is never required.
* No reception system: no queue server, no operator screen, no NFC check-in. The earlier version, which had them,
  is kept on the `with-reception` branch.

## Two phases
* **Phase 1: for anyone walking by.** Enter a nickname, then a short mini-game or interactive moment.
  It should also teach the hand gestures phase 2 uses.
* **Phase 2: for those who got interested.** Reuses the nickname from phase 1. The full experience as before:
  sit down, launch the rocket with a low-to-high hand swipe, pick a destination in space (the Moon or Mars, more
  later), explore it, fly home to Earth, "おかえりなさい".
  The booth code on `with-reception` (scenes, hand input, gestures) is the starting point.

## Phase 1 mini-game: 遠回りが、いちばんの近道 (the roundabout way is the shortest)
Educational and interactive: send a rocket from Earth to Mars (top-down view of the Sun, Earth and Mars).
* Step 1: aim straight at Mars and launch. The rocket curves around the Sun (it keeps Earth's 30 km/s), and by the
  time it reaches Mars's orbit, Mars has moved on.
* Step 2: burn forward along Earth's motion; pick the strength and the moment (a live predicted path and "Mars when
  you arrive" show when). A half ellipse (Hohmann transfer) meets Mars.
* Reveal: both paths and their fuel (speed change from low Earth orbit into low Mars orbit), against flying a
  straight line (~100 km/s), and the Earth message: reaching even our neighbour takes months and most of the fuel.
* Small print "for nerds": how it is computed (below).
* Prototype: `npm run dev` (mouse). Tuning numbers are in `CONFIG` in src/minigame/game.ts.

## Physics engine
* Swappable: the game talks only to the `PhysicsEngine` interface (src/physics/engine.ts); engines are listed in
  `ENGINES` (src/physics/index.ts) and the shared tests run on all of them.
* No time steps. The game uses **patched conics**: the general three-body problem has no closed-form solution
  (Poincaré), so the flight is split at the planets' spheres of influence and each piece is solved exactly as a
  two-body (Kepler) problem. The boundary crossings are found exactly as well. The physics is approximate only in
  that the ship feels one body at a time; that is how real missions are first planned.
* Also available: `kepler` (exact, Sun only) and `leapfrog` (fixed steps, any bodies; kept for comparison).
* Game simplifications: 2D, circular coplanar planet orbits, instant burns, a generous arrival zone around Mars.

## Phase 2 explore: the Moon as an ordinary tourist spot
* In 2126 the Moon is lived in and is one of many tourist spots. Getting around is easy and automatic: the
  visitor picks the next stop on a map and a shuttle / rover takes them there, so travel is felt, not steered.
* The stone stall is one stop on that map. Core activity, optional: take moon stones from many artificial bins
  and cases set out for tourists (「ご自由にお取りください」). It is staged on purpose ("this is set up"), not
  natural ground. Every stop must also work with no interaction at all.
* Input: the hand chooses where (smoothed 2D position), an open or closed hand chooses when. Never depend on
  hand speed, depth or precise timing (which is why throwing games were rejected).
  * At the stall a closed hand grabs a stone and opening it lets go, so the booth's fist-to-go-back gesture is
    off there. Visitors leave by holding still on a "board the shuttle" sign.
  * Exception, by choice: a stone let go while moving keeps the carry's velocity, averaged over about 0.08 s so a
    twitch as the hand opens doesn't count, and capped at 1.5 m/s. The drop guide draws the resulting arc.
* Stone physics: two engines behind one interface, switchable (STALL_CONFIG.engine, P key). "exact": closed-form
  throws and falls at 1/6 g (the first contact found by conservative advancement), no rolling, and an exact drop
  guide. "jolt": Jolt Physics (jolt-physics 1.1.0, WASM, fixed 1/60 s steps) for rolling, tumbling and real stone
  shapes; its drop guide shows only where a throw first touches. Which one the exhibition uses is still open.
  Orbits stay on the exact engine (src/physics).
* Containers are an original design. If Jolt is used, the credit may read "physics: Jolt Physics, the library
  also used in DEATH STRANDING 2", pending the organizers' rules on third-party names.
* Still open: the other stops on the map; how long a visitor may wander and how a turn ends; container style
  (logistics crate or gift-shop crate); a pouch limit (e.g. 3) or none; how phase 2's "travel is easy" sits
  with phase 1's "even our neighbour takes months and most of the fuel" (to revisit with phase 1).

## Nickname, phone to booth
* Main path (online): a printed QR at the booth opens a small static phone page. The visitor types a nickname on
  their own phone (Japanese input works), and the page shows a nickname QR. The booth's webcam reads it, with a
  bundled decoder so the booth needs no network.
  * The phone page needs the internet only to load once. After that it works by itself.
  * The nickname QR holds only the nickname (12 characters at most), so it is small and quick to read.
* Fallback (offline): the visitor picks a call sign on the booth with hand gestures (e.g. 「そらとぶ」+「ネコ」).
  No keyboard and no bad-word filtering needed.
* Nickname only, no personal data.

## Still open
* One screen or two: can phase 1 and phase 2 run at the same time (two PCs, or one PC with two screens)?
* How long phase 1 lasts, and what the mini-game is
* Does the mini-game keep a score or ranking (e.g. shown on the attract screen)?
* Does phase 2 change for someone who skipped phase 1 (a short gesture tutorial first)?
* Which online extras are worth having, if any (e.g. a souvenir page of the visitor's trip, an online ranking)
