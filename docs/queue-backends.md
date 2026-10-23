# Queue backends

The phone registration page (`hosting/register/`), the operator page (`reception/operator.html`) and the booth
(`reception/js/main.js`) only talk to the queue client in `hosting/js/queue/` (URL `/js/queue/index.js`). Which database stores the tickets is decided by the **environment**, a constant in
`js/queue/config.js`. Each environment names its backend and that backend's settings:

```js
export const ENVIRONMENT = 'product';          // 'product' (default, the exhibition) or 'dev'
export const ENVIRONMENTS = {
  product: { backend: 'firebase', firebase: { …web app config… }, registerUrl: null },
  dev:     { backend: 'local', registerUrl: null },
};
```

The environment is set in this file only. No URL parameter or page can choose it, so nobody can point the phone
page or the booth at another database by editing a link. To test with the local server, set
`ENVIRONMENT = 'dev'` on that PC (and set it back before deploying the phone page).

Server databases (MariaDB, PostgreSQL, …) can't be reached from a browser. For those, the pages keep using the
`local` backend (the HTTP API of `server/server.mjs`) and the database is chosen where the server runs, with
`QUEUE_STORE` (`server/README.md`). MariaDB is already there.

Backends today:

| Name | File | Where tickets live | Staff sign-in (`auth.method`) |
| --- | --- | --- | --- |
| `local` | `local.js` | `server/server.mjs` on the reception PC, `data/queue.json` | `none`, or `key` when the server has `OPERATOR_KEY` |
| `firebase` | `firebase.js` | Cloud Firestore (`firebase/README-firebase.md`) | `account` (Google, listed in `meta/operators`) |

## Switching to another database

1. Write `js/queue/<name>.js` that exports `connect(opts)` and resolves to the object below. Copy `local.js` or
   `firebase.js` as a starting point. Import shared pieces from `common.js` (not `index.js`).
2. Add it to `ADAPTERS` in `js/queue/index.js`: `<name>: () => import('./<name>.js').then((m) => m.connect),`
3. In `config.js`, give an environment `backend: '<name>'` plus whatever settings the adapter reads from
   `opts.settings` (for example add a `staging` environment first, or change `product` when you switch).
4. Host `register/` together with `js/queue/` on any static host, and point the QR code at it (the environment's
   `registerUrl`). Everything the phone page needs is in `hosting/`; publish that folder as it is.
5. Run the contract test against that environment: `npm start`, then open http://localhost:8000/tools/queue-test.html.
   It tests whatever `ENVIRONMENT` selects. Against anything other than the local server it asks first, because it
   writes ten test tickets (named テスト) and marks them done; it never calls a real visitor.

Nothing else changes: the pages check `auth.method` and error codes, never the backend name.

## The interface

```js
const q = await connectQueue();   // rejects with QueueError('unavailable') within ~4 s if unreachable
```

| Member | Meaning |
| --- | --- |
| `q.environment` / `q.backend` | the environment and its backend's name (set by `index.js`) |
| `q.storage` | optional: where the tickets end up, for display (`'json'`, `'mariadb'`, `'firestore'`) |
| `q.registerUrl` | absolute URL of the phone registration page, for the QR code; or `null` |
| `q.auth.method` | how staff prove who they are: `'none'`, `'key'` (a shared secret) or `'account'` (sign in) |
| `q.auth.providers` | `account`: the sign-in options to offer, e.g. `['google', 'password']`; otherwise `[]` |
| `q.auth.required` | `true` while staff actions would be refused (not signed in, or the account's email isn't verified) |
| `q.auth.user` | the signed-in staff account (shown on the operator page), or `null` |
| `q.auth.verified` | `false` while a signed-in account's email still needs verifying |
| `q.auth.signIn(secret?)` | `key`: remember the key. `account`: `signIn({ provider: 'google' })` or `signIn({ provider: 'password', email, password })` |
| `q.auth.signOut()` | forget the key / sign out |
| `q.auth.sendVerification()`, `q.auth.refresh()`, `q.auth.resetPassword(email)` | `account` with email + password: send the verification mail, re-check after its link was opened, send a password-reset mail |
| `q.createTicket(nickname)` | new `waiting` ticket with the next number, owned by this phone. May include `ownerToken`: keep it with the ticket id and pass it back to `checkIn` (local backend; Firebase uses the sign-in). Visitors, no sign-in |
| `q.getTicket(id)` | the ticket, or `null` if there is no such ticket |
| `q.watchTicket(id, cb)` | calls `cb(ticket \| null)` right away and on every change; returns unsubscribe |
| `q.watchQueue(cb)` | calls `cb({ serving, waiting, updatedAt })` right away and on every change; returns unsubscribe |
| `q.callNext()` | lowest-number `waiting` ticket → `called`; returns it, or `null` if nobody waits. Staff |
| `q.setStatus(id, status)` | sets the status; returns the updated ticket. Staff |
| `q.checkIn(id, { picc, cmac, ownerToken })` | NFC check-in with the two values from the tag's URL. Resolves with `{ status, reason, ticket }`: `accepted`, `already`, `rejected` (+ reason), or `pending` when the checker hasn't answered yet. Visitors, own ticket only |
| `q.checkInManual(id)` | staff check a visitor in by hand; same result shape. Staff |
| `q.listTickets()` | every ticket (also finished ones), ascending number, for records / CSV. Staff (local backend) |
| `q.close()` | stops all watchers |

```
Ticket = { id: string, number: integer, nickname: string,
           status: 'waiting' | 'called' | 'playing' | 'done' | 'noshow',
           createdAt: ms, updatedAt: ms, checkedInAt: ms | null }
serving = the lowest-number ticket that is 'called' or 'playing', or null
waiting = the 'waiting' tickets, ascending by number          (sortQueue() in common.js builds both)
```

Rules every backend must keep:
- Ticket numbers come from one counter: never reused, even when two phones register at the same moment.
- Only a nickname is stored. Clean it with `cleanNickname()` (`nickname.js`) before saving.
- Visitors can create and read tickets; only staff can `callNext` / `setStatus`.
- Check-in decisions follow `server/checkin.mjs` and the tag signature is verified with keys that exist only on the
  reception PC (`server/sdm.mjs`); never in a page. Rejection reasons: `malformed`, `bad-picc`, `bad-signature`,
  `not-configured`, `no-ticket`, `not-owner`, `closed`, `replayed`. See `docs/nfc-checkin.md`.

## Errors

Every failure reaches the pages as a `QueueError` (from `common.js`) with one of these `code`s. Map the
database's own errors onto them in the adapter:

| Code | When |
| --- | --- |
| `unauthenticated` | a staff action without signing in (or without the key) |
| `forbidden` | signed in, but this account is not staff |
| `rate-limited` | too many registrations; try again shortly |
| `invalid` | empty nickname, unknown status, malformed request |
| `not-found` | no such ticket (`getTicket` returns `null` instead) |
| `unavailable` | the backend can't be reached, or anything unexpected |
