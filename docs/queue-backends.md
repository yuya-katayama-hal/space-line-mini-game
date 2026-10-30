# Queue backends

The phone registration page (`hosting/register/`), the operator page (`reception/operator.html`) and the booth
(`reception/js/main.ts`) only talk to the queue client in `shared/queue/` (`index.ts`; the types are in `types.ts`).
Which database stores the tickets is decided by the **environment**. The environments are defined in
`shared/queue/config.ts`; each names its backend and that backend's settings:

```ts
export const ENVIRONMENTS: Record<string, EnvSettings> = {
  product: { backend: 'firebase', firebase: { …web app config… }, registerUrl: null },
  dev:     { backend: 'local', registerUrl: null },
};
```

Which one a page uses is fixed when it is built: `npm run build` → `product` (the exhibition, default),
`npm run build:dev` → `dev`. No URL parameter or page can choose it, so nobody can point the phone page or the booth
at another database by editing a link. `npm run deploy:hosting` always builds `product` first.

Server databases (MariaDB, PostgreSQL, …) can't be reached from a browser. For those, the pages keep using the
`local` backend (the HTTP API of `server/server.ts`) and the database is chosen where the server runs, with
`QUEUE_STORE` (`server/README.md`). MariaDB is already there.

Backends today:

| Name | File | Where tickets live | Staff sign-in (`auth.method`) |
| --- | --- | --- | --- |
| `local` | `local.ts` | `server/server.ts` on the reception PC, `data/queue.json` | `none`, or `key` when the server has `OPERATOR_KEY` |
| `firebase` | `firebase.ts` | Cloud Firestore (`firebase/README-firebase.md`) | `account` (Google or email + password, listed in `meta/operators`) |

## Switching to another database

1. Write `shared/queue/<name>.ts` that exports `connect(opts: ConnectOptions): Promise<QueueConnection>`. Copy
   `local.ts` or `firebase.ts` as a starting point. Import shared pieces from `common.ts` (not `index.ts`).
   The type checker (`npm run typecheck`) tells you if the object is missing anything below.
2. Add it to `ADAPTERS` in `shared/queue/index.ts`: `<name>: () => import('./<name>.ts').then((m) => m.connect),`
3. In `config.ts`, give an environment `backend: '<name>'` plus whatever settings the adapter reads from
   `opts.settings` (for example add a `staging` environment first, or change `product` when you switch). A new
   environment also needs to be accepted by `scripts/build.ts`.
4. Host the built phone page (`dist/hosting/`) on any static host, and point the QR code at it (the environment's
   `registerUrl`).
5. Run the contract test against that environment: build it, `npm start`, then open
   http://localhost:8000/tools/queue-test.html. It tests the environment the pages were built for. Against anything
   other than the local server it asks first, because it writes ten test tickets (named テスト) and marks them done;
   it never calls a real visitor.

Nothing else changes: the pages check `auth.method` and error codes, never the backend name.

## The interface

```ts
const q: QueueClient = await connectQueue();   // rejects with QueueError('unavailable') within ~4 s if unreachable
```

| Member | Meaning |
| --- | --- |
| `q.environment` / `q.backend` | the environment and its backend's name (set by `index.ts`) |
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
| `q.cancelTicket(id, { ownerToken })` | the visitor withdraws their own ticket while it is `waiting` or `called`. Resolves with `{ status: 'cancelled' \| 'rejected', reason, ticket }` (reasons `not-owner`, `closed`, `no-ticket`). Staff cancel with `setStatus(id, 'cancelled')` |
| `q.listTickets()` | every ticket (also finished ones), ascending number, for records / CSV. Staff (local backend) |
| `q.close()` | stops all watchers |

```
Ticket = { id: string, number: integer, nickname: string,
           status: 'waiting' | 'called' | 'playing' | 'done' | 'noshow' | 'cancelled',
           createdAt: ms, updatedAt: ms, checkedInAt: ms | null }
serving = the lowest-number ticket that is 'called' or 'playing', or null
waiting = the 'waiting' tickets, ascending by number          (sortQueue() in common.ts builds both)
```

Rules every backend must keep:
- Ticket numbers come from one counter: never reused, even when two phones register at the same moment.
- Only a nickname is stored. Clean it with `cleanNickname()` (`nickname.ts`) before saving.
- Visitors can create and read tickets; only staff can `callNext` / `setStatus`.
- Check-in decisions follow `server/checkin.ts` and the tag signature is verified with keys that exist only on the
  reception PC (`server/sdm.ts`); never in a page. Rejection reasons: `malformed`, `bad-picc`, `bad-signature`,
  `not-configured`, `no-ticket`, `not-owner`, `closed`, `replayed`. See `docs/nfc-checkin.md`.

## Errors

Every failure reaches the pages as a `QueueError` (from `common.ts`) with one of these `code`s. Map the
database's own errors onto them in the adapter:

| Code | When |
| --- | --- |
| `unauthenticated` | a staff action without signing in (or without the key) |
| `forbidden` | signed in, but this account is not staff |
| `rate-limited` | too many registrations; try again shortly |
| `invalid` | empty nickname, unknown status, malformed request |
| `not-found` | no such ticket (`getTicket` returns `null` instead) |
| `unavailable` | the backend can't be reached, or anything unexpected |
