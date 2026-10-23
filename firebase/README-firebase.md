# Registration on Firebase

> **Working (2026-10-23, project `space-line-54818`).** Deployed and working: the hosted phone page
> (anonymous sign-in, ticket creation and numbering, live status), the booth / operator page reading the
> queue, and staff Google sign-in with status changes from the operator page. Still to check: steps 2–4 of
> "Test before the event" below, and the booth marking tickets playing / done from the kiosk profile.
> If staff get "Missing or insufficient permissions", the signed-in address (shown on the operator page)
> is missing from the `emails` array in `meta/operators`.

Firebase is the backend of the `product` environment (the default). `ENVIRONMENT = 'dev'` in
`hosting/js/queue/config.js` switches to the **local queue** in `server/server.mjs` (`npm run start:lan` / `start-lan.bat`).
Keep `ENVIRONMENT = 'product'` when you deploy, since the hosted page uses the same file.
The pages and the booth use the same interface either way (`docs/queue-backends.md`).

## What runs where

| Part | Where |
| --- | --- |
| Phone registration page: the folder `hosting/` (`register/` + `js/queue/`) | Firebase Hosting, `https://<project-id>.web.app/register/` (the QR code points here). Everything in `hosting/` is public, and nothing else is |
| Tickets | Cloud Firestore: `tickets/{id}`, `meta/counter`, `meta/operators` |
| Booth and operator page: the folder `reception/` | the reception PC only, served by `server/server.mjs`, talking to Firestore directly (the PC is online). Never deployed |

Stored per ticket: `number`, `nickname`, `status`, `createdAt`, `updatedAt`, `owner` (an anonymous sign-in id),
`checkedInAt`. Also `checkins/{id}` (check-in requests and their answers) and `tags/{uid}` (last accepted tap
counter per NFC tag). No personal data.

Who can do what (`firestore.rules`):
- Anyone can read tickets (needed for the live "N ahead / now serving" view).
- Visitors sign in **anonymously** (automatic, invisible) and can only create a `waiting` ticket whose number
  comes from `meta/counter` in the same transaction.
- Staff and the booth sign in with **Google** or **email + password** (`staffSignIn` in `hosting/js/queue/config.js`).
  Only **verified** emails listed in `meta/operators` can change a status. Anyone can create an email + password
  account with the public web config, but nobody can verify an address they don't own, which is why the rules
  (and the operator page) insist on `email_verified`.
- NFC check-in (`docs/nfc-checkin.md`): a ticket records its creator's anonymous sign-in id (`owner`). Only that
  sign-in can file a check-in request in `checkins/` for it; staff can file manual ones. The reception PC answers
  them with a service account, which is the only writer of `tickets/*.checkedInAt` and `tags/` (no browser can
  write those, staff included).

## Set up (once)

1. Create a project at <https://console.firebase.google.com> (Google Analytics not needed).
2. **Build → Firestore Database → Create database** (production mode, region `asia-northeast1` Tokyo).
3. **Build → Authentication → Get started**, then enable the **Anonymous**, **Google** and **Email/Password**
   sign-in providers (Email/Password: the first switch only; "Email link" is not used).
4. **Project settings → General → Your apps → Web (`</>`)**: register an app (no need to tick Hosting here).
   Copy the `firebaseConfig` object into `hosting/js/queue/config.js` as `ENVIRONMENTS.product.firebase`
   (`apiKey`, `authDomain`, `projectId`, `appId` are enough). The web config is not a secret.
5. In **Firestore → Data**, create document `meta/operators` with a field `emails` (array) listing the staff
   accounts (Google or email + password) and the account the booth PC signs in with.
   - **Email + password staff:** create each account in **Authentication → Users → Add user** (email + a strong
     password), add the email to `meta/operators`, then verify it once (see "At the booth").
   - Recommended: in **Authentication → Settings → User actions**, turn off **Enable create (sign-up)** if your
     console shows it, so accounts can only be made in the console. Staff access does not depend on it (the
     allowlist + verification already decide), but it keeps strangers from creating accounts at all.
6. **Authentication → Settings → Authorized domains**: `localhost` is there by default (operator page and
   booth). Add any other host you use.
7. Install the CLI and log in (Node is already installed):
   ```
   npm install -g firebase-tools
   firebase login
   ```

## Deploy

From the project folder (`firebase.json` and `.firebaserc` are there; the project is `space-line-54818`):
```
npm run deploy:hosting          # publishes the folder hosting/ as it is (no build step)
npm run deploy                  # rules (firebase/firestore.rules) + hosting
```
Only `hosting/` is published (Markdown files in it are skipped). `reception/`, `server/` and everything else stay
on the reception PC.

## At the booth

- The reception PC runs `start.bat` (`server/server.mjs`). With `ENVIRONMENT = 'product'`, the operator page and the
  booth read the queue from Firestore.
- Open `http://localhost:8000/operator.html` and sign in with an allowlisted account: **Googleでサインイン**, or the
  email + password form.
  - **First time with email + password:** the page says the address is not verified yet. Press
    **確認メールを送る**, open the link in that email, then press **確認した**. Only needed once per account.
  - **パスワードを忘れた** sends a reset email to the address typed in the form.
  - **サインアウト** (top right) switches to another account.
  The sign-in is kept in the browser profile; the kiosk uses its own profile
  (`%TEMP%\voyage-kiosk` in `start.bat`), so sign in once inside the kiosk profile as well if the booth itself
  marks tickets playing / done.
- Print the QR code shown on the operator page (it points to the hosted registration page).

## Test before the event

1. Rules: in **Firestore → Rules → Rules Playground**, check that an anonymous user can create
   `tickets/x` with `{number: 1, nickname: "test", status: "waiting", createdAt: 1, updatedAt: 1}` when
   `meta/counter.next` becomes 2, and cannot create one with `status: "done"` or update a status.
2. On a phone (mobile data, not the venue Wi-Fi), scan the QR, register, and see the ticket number.
3. On the operator page, sign in, press 次を呼ぶ, and check the phone flips to 順番です!
4. Register from two phones at the same moment and check the numbers differ.

## Known limits (prototype)

- Anyone with the URL can create tickets (anonymous auth only slows scripts down). If spam is a concern,
  enable **App Check** with reCAPTCHA Enterprise.
- No automatic cleanup: delete old tickets in the console after the event, and reset `meta/counter` to start
  numbering from 1 again.
