// Queue store: MariaDB (or MySQL). Select it with QUEUE_STORE=mariadb and
// MARIADB_URL=mariadb://user:password@host:3306/database. Tables are created (and upgraded) on first start.
// Needs the optional npm package "mariadb" (loaded only when this store is used).
import { decideCheckIn } from './checkin.mjs';

const ACTIVE = "('waiting','called','playing')";

const toTicket = (r) => (r ? {
  id: r.id, number: Number(r.number), nickname: r.nickname, status: r.status,
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  checkedInAt: r.checked_in_at == null ? null : Number(r.checked_in_at),
  ownerHash: r.owner_hash || null,
} : null);

export async function openStore({ url }) {
  if (!url) throw new Error('QUEUE_STORE=mariadb needs MARIADB_URL=mariadb://user:password@host:3306/database');
  let mariadb;
  try { mariadb = (await import('mariadb')).default; } catch {
    throw new Error('the "mariadb" npm package is not installed (npm install)');
  }
  const u = new URL(url);
  const pool = mariadb.createPool({
    host: u.hostname, port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: 5, bigIntAsNumber: true, charset: 'utf8mb4',
  });

  // schema: times are ms since 1970 (BIGINT), like the Ticket shape the pages use
  await pool.query(`CREATE TABLE IF NOT EXISTS queue_counter (
    id TINYINT PRIMARY KEY, next INT NOT NULL) ENGINE=InnoDB`);
  await pool.query('INSERT IGNORE INTO queue_counter (id, next) VALUES (1, 1)');
  await pool.query(`CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(40) PRIMARY KEY,
    number INT NOT NULL UNIQUE,
    nickname VARCHAR(64) NOT NULL,
    status VARCHAR(10) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    INDEX by_status (status, number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // NFC check-in (added later; IF NOT EXISTS upgrades a database created before it)
  await pool.query('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS owner_hash CHAR(64) NULL, ADD COLUMN IF NOT EXISTS checked_in_at BIGINT NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS nfc_tags (
    uid CHAR(14) PRIMARY KEY, last_counter INT NOT NULL) ENGINE=InnoDB`);

  const get = async (id) => toTicket((await pool.query('SELECT * FROM tickets WHERE id = ?', [id]))[0]);

  // run fn(conn) in a transaction on one connection
  async function tx(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  return {
    name: 'mariadb',
    async active() {
      return (await pool.query(`SELECT * FROM tickets WHERE status IN ${ACTIVE} ORDER BY number`)).map(toTicket);
    },
    async list() { return (await pool.query('SELECT * FROM tickets ORDER BY number')).map(toTicket); },
    get,
    async create({ id, nickname, ownerHash = null, now }) {
      // the counter row is locked until commit, so two registrations at the same moment get different numbers
      return tx(async (conn) => {
        const [{ next }] = await conn.query('SELECT next FROM queue_counter WHERE id = 1 FOR UPDATE');
        await conn.query('UPDATE queue_counter SET next = ? WHERE id = 1', [next + 1]);
        await conn.query('INSERT INTO tickets (id, number, nickname, status, created_at, updated_at, owner_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, next, nickname, 'waiting', now, now, ownerHash]);
        return { id, number: next, nickname, status: 'waiting', createdAt: now, updatedAt: now, checkedInAt: null, ownerHash };
      });
    },
    async setStatus(id, status, now) {
      const r = await pool.query('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', [status, now, id]);
      return r.affectedRows ? get(id) : null;
    },
    async callNext(now) {
      // lock the lowest waiting ticket nobody else has locked (SKIP LOCKED, MariaDB 10.6+ / MySQL 8+), so two
      // operators pressing at the same moment call two different visitors instead of one twice
      const id = await tx(async (conn) => {
        const [row] = await conn.query("SELECT id FROM tickets WHERE status = 'waiting' ORDER BY number LIMIT 1 FOR UPDATE SKIP LOCKED");
        if (row) await conn.query("UPDATE tickets SET status = 'called', updated_at = ? WHERE id = ?", [now, row.id]);
        return row ? row.id : null;
      });
      return id ? get(id) : null;
    },
    async checkIn({ id, manual = false, ownerHash = null, tagUid = null, counter = -1, now }) {
      // the ticket row and the tag row stay locked until commit, so two taps can't both pass the counter check
      const out = await tx(async (conn) => {
        const t = toTicket((await conn.query('SELECT * FROM tickets WHERE id = ? FOR UPDATE', [id]))[0]);
        let last = -1;
        if (!manual && tagUid) {
          await conn.query('INSERT IGNORE INTO nfc_tags (uid, last_counter) VALUES (?, -1)', [tagUid]);
          [{ last_counter: last }] = await conn.query('SELECT last_counter FROM nfc_tags WHERE uid = ? FOR UPDATE', [tagUid]);
        }
        const d = decideCheckIn({ ticket: t, manual, ownerMatches: !!t && !!t.ownerHash && t.ownerHash === ownerHash, counter, lastCounter: Number(last) });
        if (d.status !== 'rejected') {
          if (d.lastCounter !== undefined) await conn.query('UPDATE nfc_tags SET last_counter = ? WHERE uid = ?', [d.lastCounter, tagUid]);
          if (!t.checkedInAt) await conn.query('UPDATE tickets SET checked_in_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
        }
        return d;
      });
      return { status: out.status, reason: out.reason, ticket: await get(id) };
    },
    async close() { await pool.end(); },
  };
}
