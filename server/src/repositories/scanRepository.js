const fs = require('node:fs/promises');
const path = require('node:path');

class ScanRepository {
  constructor({ databaseUrl = process.env.DATABASE_URL, filePath = process.env.SCAN_STORE_PATH || path.join(__dirname, '../../data/scans.sqlite') } = {}) {
    this.databaseUrl = databaseUrl;
    this.filePath = filePath;
    this.pool = null;
    this.database = null;
  }

  async init() {
    if (this.databaseUrl) {
      const { Pool } = require('pg');
      this.pool = new Pool({ ...postgresConnectionOptions(this.databaseUrl), max: 5 });
      await verifyPostgresSchema(this.pool);
    } else {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const { DatabaseSync } = require('node:sqlite');
      this.database = new DatabaseSync(this.filePath);
      this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL, submitted_url TEXT NOT NULL, score INTEGER NOT NULL, scan TEXT NOT NULL, owner_id TEXT NULL REFERENCES users(id));');
      const columns = this.database.prepare('PRAGMA table_info(scans)').all().map((column) => column.name);
      if (!columns.includes('owner_id')) this.database.exec('ALTER TABLE scans ADD COLUMN owner_id TEXT NULL REFERENCES users(id)');
      this.database.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS scans_scanned_at_idx ON scans (scanned_at DESC); CREATE INDEX IF NOT EXISTS scans_owner_scanned_at_idx ON scans (owner_id, scanned_at DESC); CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);');
    }
  }

  async list(ownerId, includeLegacy = false) {
    if (ownerId === undefined) {
      if (this.pool) return (await this.pool.query('SELECT scan FROM scans ORDER BY scanned_at DESC')).rows.map((row) => row.scan);
      return this.database.prepare('SELECT scan FROM scans ORDER BY scanned_at DESC').all().map((row) => JSON.parse(row.scan));
    }
    const where = includeLegacy ? '(owner_id = ? OR owner_id IS NULL)' : 'owner_id = ?';
    if (this.pool) return (await this.pool.query(`SELECT scan FROM scans WHERE ${includeLegacy ? '(owner_id = $1 OR owner_id IS NULL)' : 'owner_id = $1'} ORDER BY scanned_at DESC`, [ownerId])).rows.map((row) => row.scan);
    return this.database.prepare(`SELECT scan FROM scans WHERE ${where} ORDER BY scanned_at DESC`).all(ownerId).map((row) => JSON.parse(row.scan));
  }

  async get(id) {
    if (this.pool) return (await this.pool.query('SELECT scan FROM scans WHERE id = $1', [id])).rows[0]?.scan || null;
    const row = this.database.prepare('SELECT scan FROM scans WHERE id = ?').get(id);
    return row ? JSON.parse(row.scan) : null;
  }

  async save(scan, ownerId = null) {
    if (this.pool) {
      await this.pool.query('INSERT INTO scans (id, scanned_at, submitted_url, score, scan, owner_id) VALUES ($1, $2, $3, $4, $5, $6)', [scan.id, scan.scannedAt, scan.submittedUrl, scan.score.value, scan, ownerId]);
    } else {
      this.database.prepare('INSERT INTO scans (id, scanned_at, submitted_url, score, scan, owner_id) VALUES (?, ?, ?, ?, ?, ?)').run(scan.id, scan.scannedAt, scan.submittedUrl, scan.score.value, JSON.stringify(scan), ownerId);
    }
    return scan;
  }

  async deleteAll() {
    if (this.pool) { await this.pool.query('DELETE FROM scans'); return; }
    this.database.prepare('DELETE FROM scans').run();
  }

  async getForOwner(id, ownerId, includeLegacy = false) {
    if (this.pool) {
      const result = await this.pool.query(`SELECT scan FROM scans WHERE id = $1 AND ${includeLegacy ? '(owner_id = $2 OR owner_id IS NULL)' : 'owner_id = $2'}`, [id, ownerId]);
      return result.rows[0]?.scan || null;
    }
    const row = this.database.prepare(`SELECT scan FROM scans WHERE id = ? AND ${includeLegacy ? '(owner_id = ? OR owner_id IS NULL)' : 'owner_id = ?'}`).get(id, ownerId);
    return row ? JSON.parse(row.scan) : null;
  }

  async deleteForOwner(ownerId, includeLegacy = false) {
    if (this.pool) {
      await this.pool.query(`DELETE FROM scans WHERE ${includeLegacy ? '(owner_id = $1 OR owner_id IS NULL)' : 'owner_id = $1'}`, [ownerId]);
      return;
    }
    this.database.prepare(`DELETE FROM scans WHERE ${includeLegacy ? '(owner_id = ? OR owner_id IS NULL)' : 'owner_id = ?'}`).run(ownerId);
  }

  async createUser({ id, email, passwordHash }) {
    if (this.pool) await this.pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [id, email, passwordHash]);
    else this.database.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, passwordHash);
  }

  async getUserByEmail(email) {
    if (this.pool) return (await this.pool.query('SELECT id, email, password_hash AS "passwordHash" FROM users WHERE email = $1', [email])).rows[0] || null;
    return this.database.prepare('SELECT id, email, password_hash AS passwordHash FROM users WHERE email = ?').get(email) || null;
  }

  async createSession({ tokenHash, userId = null, csrfToken, expiresAt }) {
    if (this.pool) {
      await this.pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
      await this.pool.query('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, $4)', [tokenHash, userId, csrfToken, expiresAt]);
    } else {
      this.database.prepare("DELETE FROM sessions WHERE julianday(expires_at) <= julianday('now')").run();
      this.database.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, csrfToken, expiresAt);
    }
  }

  async getSession(tokenHash) {
    if (this.pool) return (await this.pool.query('SELECT s.token_hash AS "tokenHash", s.user_id AS "userId", s.csrf_token AS "csrfToken", s.expires_at AS "expiresAt", u.email FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()', [tokenHash])).rows[0] || null;
    return this.database.prepare("SELECT s.token_hash AS tokenHash, s.user_id AS userId, s.csrf_token AS csrfToken, s.expires_at AS expiresAt, u.email FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND julianday(s.expires_at) > julianday('now')").get(tokenHash) || null;
  }

  async deleteSession(tokenHash) {
    if (this.pool) await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    else this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  get mode() { return this.pool ? 'postgres' : 'sqlite'; }
  async check() {
    if (this.pool) await verifyPostgresSchema(this.pool);
    else this.database.prepare('SELECT 1 AS ready').get();
    return true;
  }
  async close() {
    const pool = this.pool;
    const database = this.database;
    this.pool = null;
    this.database = null;
    if (pool) await pool.end();
    if (database) database.close();
  }
}

function postgresConnectionOptions(databaseUrl, sslSetting = process.env.DATABASE_SSL) {
  if (sslSetting !== 'true' && sslSetting !== 'false') {
    throw new Error('DATABASE_SSL must be explicitly set to true (verified TLS) or false (private/local connection).');
  }
  let parsed;
  try { parsed = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL must use the PostgreSQL scheme.');
  const tlsParameters = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'];
  if (tlsParameters.some((parameter) => parsed.searchParams.has(parameter))) {
    throw new Error('Remove TLS query parameters from DATABASE_URL and configure TLS with DATABASE_SSL.');
  }
  return { connectionString: databaseUrl, ssl: sslSetting === 'true' ? { rejectUnauthorized: true } : undefined };
}

async function verifyPostgresSchema(pool) {
  const result = await pool.query("SELECT to_regclass('public.scans') AS scans, to_regclass('public.users') AS users, to_regclass('public.sessions') AS sessions, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scans' AND column_name = 'owner_id') AS scan_owner_id");
  const schema = result.rows[0];
  if (!schema || !schema.scans || !schema.users || !schema.sessions || !schema.scan_owner_id) {
    throw new Error('PostgreSQL schema is not initialized. Run the explicit database migration before starting the API.');
  }
  return true;
}

module.exports = { ScanRepository, postgresConnectionOptions, verifyPostgresSchema };
