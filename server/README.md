# Queue stores (server side)

`server/server.ts` runs on the reception PC (Node 24+ runs the TypeScript directly). It serves the built pages in
`dist/` (the booth and operator page, and the phone page for the dev environment) and the queue API that the `local`
backend of `shared/queue/` talks to. Where it keeps the tickets
is the **queue store**, chosen when the server starts:

| `QUEUE_STORE` | File | Needs |
| --- | --- | --- |
| `json` (default) | `store-json.ts` | nothing: tickets in `data/queue.json` (`DATA_DIR`) |
| `mariadb` | `store-mariadb.ts` | MariaDB 10.6+ or MySQL 8+, `MARIADB_URL`, the optional npm package `mariadb` |

```
QUEUE_STORE=mariadb MARIADB_URL=mariadb://user:password@host:3306/database npm start
```

Tables are created on first start. The store name shows in `/api/info` and on the operator page
(`開発 / dev · ローカル / Local (mariadb)`). The store is chosen by whoever starts the server (an environment
variable on that machine), never by a visitor or a URL.

## Two layers

- **Browser → backend** (the environment the pages were built for, `shared/queue/config.ts`): Firebase, or the HTTP API of this server
  (`backend: 'local'`). Browsers can talk to Firebase directly; they can't talk to MariaDB, PostgreSQL and so on.
- **This server → database** (`QUEUE_STORE`): for server databases. The pages don't change at all; they keep
  using `backend: 'local'`, and the database is swapped here.

## The store interface

The types are in `server/store.ts` (`Store`, `StoredTicket`).

```ts
export async function openStore({ dataDir, url }: StoreOptions): Promise<Store> → {
  name,                               // shown in /api/info
  active(),                           // waiting / called / playing tickets, ascending number
  list(),                             // every ticket, ascending number (records / CSV)
  get(id),                            // Ticket or null
  create({ id, nickname, ownerHash, now }),   // new 'waiting' Ticket with the next number (atomic!)
  setStatus(id, status, now),         // updated Ticket, or null if there is no such ticket
  callNext(now),                      // lowest 'waiting' → 'called' (atomic!), or null
  checkIn({ id, manual, ownerHash, tagUid, counter, now }),   // NFC check-in (atomic!): see below
  cancel({ id, ownerHash, now }),     // the owner withdraws a waiting / called ticket (atomic; decideCancel() in checkin.ts)
  close(),
}
```

Tickets have the shape in `docs/queue-backends.md` (times are ms since 1970). `server.ts` already checks the nickname,
the status value, the operator key and the rate limit, and pushes changes to the pages; a store only stores.

Two rules a database store must keep (the JSON store gets them for free because Node runs one request at a time):
- **Numbers are unique under load.** Two registrations at the same moment must never get the same number
  (MariaDB: lock the counter row with `SELECT … FOR UPDATE` inside a transaction).
- **A visitor is called once.** Two operators pressing "call next" together must call two different visitors
  (MariaDB: `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction).
- **A tap counts once.** `checkIn` decides with `decideCheckIn()` from `checkin.ts` and, if accepted, stores the
  tag's new counter and the ticket's `checkedInAt` in one atomic step (MariaDB: ticket row and tag row locked with
  `FOR UPDATE`). The tag signature is already verified by `server.ts` (`sdm.ts`) before the store is called.
  `ownerHash` (SHA-256 of the owner token the phone received at registration) stays inside the store: the server
  never sends it to a browser.

To add a store (PostgreSQL, SQLite, …): write `server/store-<name>.ts` (implementing `Store`), add it to `STORES` in `server.ts`, and run
the contract test (`/tools/queue-test.html`) with `QUEUE_STORE=<name>`.

## Limitation

Live updates to phones and the operator page come from the server process that made the change. Run **one**
`server.ts` per database; a second server on the same database would not see the first one's changes until reload.
