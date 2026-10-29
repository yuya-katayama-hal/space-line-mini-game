# SPACE LINE — スペースライン

A hand-gesture booth for 未来創造展. The goal (see `design.md`) is to show visitors how precious Earth is.
The story is set in **2126**: the visitor already lives then (there is no time travel). A seated visitor
launches a rocket with a hand gesture, picks a destination in space, explores it, and flies home to Earth. A webcam tracks one hand (MediaPipe Hand Landmarker) in Chrome.

**One turn:** attract screen → launch pad (swipe up to launch) → space (pick a gate) → destination
(the Moon or Mars) → fly home (Earth grows in the window, the capsule lands) → closing message
→ attract screen for the next visitor.

## What goes where

Everything is TypeScript. The project is split by **where it runs**:

| Folder | Runs on | Public? |
| --- | --- | --- |
| `hosting/` | Firebase Hosting (phone registration page), built into `dist/hosting/` | **Yes**: `dist/hosting/` is published with `npm run deploy:hosting`. Nothing else is ever published |
| `reception/` | the reception PC (booth + operator page), built into `dist/reception/` and served by `server/server.ts` | No |
| `shared/` | the queue client both of the above use (bundled into each page) | Only as part of the phone page bundle |
| `server/` | the reception PC (`server.ts`: static files, the dev queue API, queue stores) | No (not even served) |
| `firebase/` | Firestore rules and setup notes (`firebase.json` at the top level points here) | Rules are deployed, not served |
| `tools/`, `tests/`, `docs/` | command-line tools / tests / documentation | No |

The pages are bundled with Vite into `dist/`; the server serves only `dist/`, with the phone page at the same URL as on
Firebase, so the booth and the dev environment use exactly the files that get published. The server, tools and tests
need no build: **Node.js 24 or newer** runs their `.ts` files directly. Keep secrets (keys, service-account files)
**outside this folder**.

## Run it

1. Install [Node.js](https://nodejs.org/) **24 or newer**, then run `npm install` once in this folder.
2. Double-click **`start.bat`**. It builds the pages if `dist/` is missing, starts the local server and opens Chrome
   fullscreen (kiosk) at `http://localhost:8000`, with the camera permission prompt skipped.
   - Or run `npm run build` and `npm start`, and open http://localhost:8000 yourself.
   - Opening `reception/index.html` directly (file://) will **not** work. Camera, modules and wasm need a server.
3. To quit kiosk mode press **Alt+F4**, then close the minimized server window. While it is open, the server restarts by
   itself if it ever stops (`server/keep-running.bat`); it runs the queue and the NFC check-in checker, so keep it open.

After changing any page, run `npm run build` again (the server serves what was built). Packages (three.js 0.170,
MediaPipe tasks-vision 0.10.14, Firebase 12.19.0, qrcode-generator 1.4.4) come from npm at pinned versions and are
bundled into the pages; the MediaPipe wasm files and `reception/public/models/hand_landmarker.task` are copied into
`dist/reception/` by the build.

## Develop and test

| Command | Does |
| --- | --- |
| `npm run typecheck` | type checks the browser code (`tsconfig.web.json`) and the Node code (`tsconfig.node.json`) |
| `npm test` | unit tests (Vitest, `tests/unit/`): tag crypto, check-in rules, the JSON store, the Firebase check-in checker, queue helpers |
| `npm run build` / `npm run build:dev` | type check, then build the pages for the `product` / `dev` environment into `dist/` |
| `npm run test:integration` | the server API and NFC check-in races against a real server (`tests/integration/`) |
| `npm run test:e2e` | the pages in headless Chrome with a fake camera (`tests/e2e/`): phone + operator, contract test, check-in, cancel, a full booth turn |
| `npm run test:all` | all of the above, in order |

GitHub Actions (`.github/workflows/ci.yml`) runs the type check, unit tests, build and integration tests on every push
and pull request. Run `npm run test:e2e` on a PC with Chrome before merging.

## Registration queue (prototype)

Visitors scan a QR code, enter a nickname on their phone and get a ticket number that updates live
("あと N 人", "順番です!"). Staff call visitors from the operator page. A ticket can be cancelled before its turn,
by the visitor (受付をキャンセル on the phone; 新しく登録 also cancels the old ticket) or by staff (取消 / キャンセル on
the operator page); cancellations are counted separately from no-shows. When a called visitor starts a
turn, the booth greets them by name and marks the ticket done at the end.

- **Phone page:** `/register/` · **Operator page:** `/operator.html` · **Booth:** `/` (shows the QR and "次は #N" on the attract screen)
- **Dev environment (local server):** `start-lan.bat` / `npm run start:lan` lets phones on the same Wi-Fi reach the
  server and prints the address the QR uses. Plain `start.bat` stays on this PC only (`localhost`), so its QR
  only works on the PC itself. Tickets are kept in `data/queue.json`.
- **Operator key:** set `OPERATOR_KEY` so that only staff can call / finish tickets, then open the booth as
  `http://localhost:8000/?key=<key>` and enter the key on the operator page. Without it, anyone on the network can.
- **Which database:** the environment the pages were built for: `npm run build` → `product` (Firebase), `npm run
  build:dev` → `dev` (the local server). It is fixed in the build; no URL can change it. The environments are defined in
  `shared/queue/config.ts`, and the operator page shows which one is running. To move to another database, follow
  `docs/queue-backends.md` and check it with the contract test at `/tools/queue-test.html`.
- **Server databases (MariaDB etc.):** with the dev environment, the local server can keep tickets in MariaDB instead
  of `data/queue.json`: `QUEUE_STORE=mariadb MARIADB_URL=mariadb://user:password@host:3306/db npm start`.
  See `server/README.md`.
- **Firebase (live):** project `space-line-54818`; setup and deploy steps are in `firebase/README-firebase.md`.
- If the queue can't be reached, the booth keeps running for walk-in visitors.

## NFC check-in

Visitors prove they came by tapping their phone on an **NTAG 424 DNA** tag at the booth. The tag signs every tap;
the reception PC checks the signature with keys that exist only on that PC, accepts a tap only from the phone that
registered and only once (tap counter), and records the arrival time. The booth binds the called visitor's turn
only after check-in, and the operator page shows ✔, counts and a CSV export. Setup (keys, tags, service account),
operation and testing without a tag: **`docs/nfc-checkin.md`**.

Secrets (tag keys, Firebase service account) live in a folder **outside the project**:
`<home>/spaceline-secrets/` (or `SPACELINE_SECRETS`). The server refuses a secrets folder inside the project.

## Gestures

| Gesture | Does |
| --- | --- |
| ✋ Move your hand | Moves the cursor (index fingertip) |
| 🚀 Move your hand from low to high (launch pad) | Launches the rocket. It must start in the lower half of the screen and rise quickly; a hand held up high never launches |
| ⏳ Hold still on something (1.4 s) | Selects it. This is the main way to select, since many people never pinch reliably |
| 🤏 Pinch on something | Selects it right away |
| 🤏 Pinch on empty space and move | Rotates the view |
| ✊ Fist (0.9 s) | At a destination: closes the card and zooms out first, then flies home. In space: back to Earth from another planet, then flies home. At the closing message: finishes the turn |

A turn ends 20 s after the closing message (or on a fist), or after 45 s with no hand in view.
After a turn the booth waits until the visitor leaves (no hand) before the next turn can start.

**Mouse fallback:** move = cursor, click = pinch, drag = rotate, wheel = zoom, fast upward move = swipe.
**Operator keys:** `l` launch · `1` space · `2` Moon · `3` Mars · `h` fly home · `r` end the turn / reset ·
`Esc` back · `c` camera preview · `g` guide bar · `f` fullscreen.

## Tuning on site

- `reception/js/input.ts` → `CONFIG`
  - `region`: which part of the camera image maps to the full screen. **Retune it for seated visitors**
    (see the TODO there): with the chair and camera in place, adjust it until a relaxed hand reaches every
    edge of the screen. The dashed box in the camera preview (`c`) shows the region.
  - `smoothMin` / `smoothMax`: cursor steadiness vs. responsiveness.
  - `pinchOn` / `pinchOff`: pinch sensitivity. The bar at the edge of the camera preview shows the live
    thumb–index value. Pinch and watch it: it must drop below the yellow line to start a pinch and rise
    above the white line to release. If it never reaches yellow, raise `pinchOn`. If pinches fire by
    accident, lower it.
  - `fistHoldMs`: how long a fist must be held to go back.
  - `swipeFromFrac` / `swipeUpFrac` / `swipeUpMs`: where the launch swipe must start (below this fraction of the
    screen height), how far it must rise, and how fast.
  - `mouseIdleMs`: how long after the last mouse or key use a visitor still counts as present.
- `reception/js/main.ts` → `SETTINGS`: dwell time, `turnIdleMs`, `finaleMs`, `homecomingMs`.
- Camera placement: put it above or below the screen, facing the seated visitor. Even front lighting helps tracking.

## Editing content

All visitor-facing booth text (JP + EN) is in **`reception/js/content.ts`**: card texts per scene, gate labels
(`GATES`) and the flow captions and closing message (`FLOW`). The 3D scenes are built procedurally in
`reception/js/scenes/`; there are no image assets. The phone page's text is in `hosting/register/`.

**Adding a destination** (all under `reception/`): write `js/scenes/<name>.ts`, a class implementing `BoothScene`
(`js/scene.ts`) like `moon.ts`, add `ERAS.<name>`, `GATES.<name>` and its cards to `js/content.ts`, add an entry to
`js/destinations.ts`, and a `body.era-<name>` color block to `css/style.css`. The space scene makes one gate per entry.
Rebuild (`npm run build`) to see it.

## Files

```
hosting/register/               ── the phone registration page, published to Firebase Hosting (built into dist/hosting) ──
reception/                      ── reception PC only (built into dist/reception) ──
  index.html, css/style.css     booth page + overlay UI
  js/main.ts                    render loop, turn flow (launch → space → destination → home), selection, idle reset
  js/input.ts                   hand + mouse sources merged into one pointer; fist and swipe-up gestures
  js/ui.ts                      cursor, tags, info card, warp effect, captions, countdown, closing message, queue panel
  js/util.ts                    camera rig, stars, sky, smoke, textures, noise shader
  js/scene.ts                   the interface every scene implements, and selectable targets
  js/content.ts                 all booth text
  js/destinations.ts            the list of destinations
  js/scenes/                    launch.ts (Earth), space.ts, moon.ts, mars.ts
  public/models/                MediaPipe hand model (copied into the build)
  operator.html, operator/      staff operator page
  tools/queue-test.html         contract test for queue backends (served on the reception PC)
shared/queue/                   queue client used by every page: index.ts (entry), types.ts, config.ts (environments),
                                one file per backend (local.ts, firebase.ts), common.ts, nickname.ts
server/                         ── reception PC only, never served ──
  server.ts                     static files (dist/) + the local queue API
  store.ts                      the queue store interface
  store-json.ts, store-mariadb.ts   where the local queue keeps tickets
  sdm.ts, checkin.ts            NFC tag signature check, check-in rules (shared by every store)
  checkin-firestore.ts          answers check-ins from Firestore in the product environment
  keep-running.bat              restarts the server if it stops (started by start.bat)
tools/new-keys.ts, check-tap.ts create the tag keys / check a URL from a real tag tap (node tools/<name>.ts)
tools/fake-tap.ts               make a tag-tap URL with test keys (dev, no tag needed)
tests/unit/                     Vitest unit tests (npm test)
tests/integration/, tests/e2e/  server and browser tests (npm run test:integration / test:e2e), helpers in tests/lib.ts
scripts/build.ts                type check + Vite build of the pages into dist/ (npm run build / build:dev)
vite.hosting.config.ts, vite.reception.config.ts   how each side is bundled
tsconfig.web.json, tsconfig.node.json   type checking for browser code / Node code
firebase/                       Firestore rules, setup notes
firebase.json, .firebaserc      Firebase deploy config (builds, then publishes dist/hosting only)
.github/workflows/ci.yml        CI: type check, unit tests, build, integration tests
docs/queue-backends.md          the queue interface and how to switch databases
docs/nfc-checkin.md             NFC check-in: how it works, tag setup, operation
start.bat, start-lan.bat        kiosk launcher / LAN server for the dev environment
```
