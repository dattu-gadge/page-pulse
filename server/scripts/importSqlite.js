const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { postgresConnectionOptions } = require('../src/repositories/scanRepository');

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function iso(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Import stopped: report ${field} is not a valid timestamp.`);
  return date.toISOString();
}

function readSqliteRows(sourcePath) {
  const absolutePath = path.resolve(sourcePath);
  const database = new DatabaseSync(absolutePath, { readOnly: true });
  try {
    const columns = database.prepare('PRAGMA table_info(scans)').all().map((column) => column.name);
    const required = ['id', 'scanned_at', 'submitted_url', 'score', 'scan'];
    if (!required.every((column) => columns.includes(column))) throw new Error('Import stopped: source SQLite scans table is missing required columns.');
    const owner = columns.includes('owner_id') ? 'owner_id' : 'NULL AS owner_id';
    return database.prepare(`SELECT id, scanned_at, submitted_url, score, scan, ${owner} FROM scans ORDER BY id`).all().map((row) => {
      let scan;
      try { scan = typeof row.scan === 'string' ? JSON.parse(row.scan) : row.scan; }
      catch { throw new Error(`Import stopped: report ${row.id} contains malformed JSON.`); }
      const scannedAt = iso(row.scanned_at, 'timestamp');
      if (!scan || typeof scan !== 'object' || scan.id !== row.id || scan.submittedUrl !== row.submitted_url || iso(scan.scannedAt, 'document timestamp') !== scannedAt || Number(scan.score?.value) !== Number(row.score)) {
        throw new Error(`Import stopped: report ${row.id} has inconsistent stored fields.`);
      }
      if (row.owner_id !== null && row.owner_id !== undefined) throw new Error(`Import stopped: report ${row.id} has owner_id. This import preserves unowned local reports only; establish an explicit account identity mapping before moving owned reports.`);
      return { id: row.id, scannedAt, submittedUrl: row.submitted_url, score: Number(row.score), scan, ownerId: null };
    });
  } finally { database.close(); }
}

function matches(existing, expected) {
  if (!existing || existing.id !== expected.id) return false;
  return existing.id === expected.id
    && iso(existing.scanned_at ?? existing.scannedAt, 'destination timestamp') === expected.scannedAt
    && existing.submitted_url === expected.submittedUrl
    && Number(existing.score) === expected.score
    && (existing.owner_id ?? existing.ownerId ?? null) === null
    && stable(existing.scan) === stable(expected.scan);
}

async function importRows(rows, client, { dryRun = false } = {}) {
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error('Import stopped: the SQLite source contains duplicate report IDs.');
  const found = ids.length ? (await client.query('SELECT id, scanned_at, submitted_url, score, scan, owner_id FROM scans WHERE id = ANY($1::text[])', [ids])).rows : [];
  const byId = new Map(found.map((row) => [row.id, row]));
  const pending = [];
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing && !matches(existing, row)) throw new Error(`Import stopped: destination already contains a different report with ID ${row.id}. No source records were changed.`);
    if (!existing) pending.push(row);
  }
  if (dryRun) return { sourceCount: rows.length, alreadyPresent: rows.length - pending.length, imported: 0, verified: rows.length - pending.length };

  await client.query('BEGIN');
  try {
    for (const row of pending) {
      await client.query('INSERT INTO scans (id, scanned_at, submitted_url, score, scan, owner_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [row.id, row.scannedAt, row.submittedUrl, row.score, JSON.stringify(row.scan), row.ownerId]);
    }
    const verification = ids.length ? (await client.query('SELECT id, scanned_at, submitted_url, score, scan, owner_id FROM scans WHERE id = ANY($1::text[])', [ids])).rows : [];
    const verified = new Map(verification.map((row) => [row.id, row]));
    if (verified.size !== rows.length || rows.some((row) => !matches(verified.get(row.id) || {}, row))) throw new Error('Import verification failed: destination IDs or report fields do not match the SQLite source.');
    await client.query('COMMIT');
    return { sourceCount: rows.length, alreadyPresent: rows.length - pending.length, imported: pending.length, verified: verified.size };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function runImport({ sourcePath = process.env.SQLITE_IMPORT_SOURCE, databaseUrl = process.env.DATABASE_URL, dryRun = process.argv.includes('--dry-run') } = {}) {
  if (!sourcePath) throw new Error('Set SQLITE_IMPORT_SOURCE to the explicit path of the SQLite database to import.');
  if (!databaseUrl) throw new Error('DATABASE_URL must explicitly identify the PostgreSQL destination.');
  const rows = readSqliteRows(sourcePath);
  const pool = new Pool({ ...postgresConnectionOptions(databaseUrl), max: 1 });
  let client;
  try {
    client = await pool.connect();
    const result = await importRows(rows, client, { dryRun });
    console.log(`${dryRun ? 'Preflight' : 'Import'} complete: source=${result.sourceCount}, already present=${result.alreadyPresent}, imported=${result.imported}, verified IDs=${result.verified}.`);
    if (dryRun) console.log('Dry run: no PostgreSQL records were written.');
    return result;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (require.main === module) runImport().catch((error) => {
  const safe = /^(Import stopped:|Import verification failed:|Set SQLITE_IMPORT_SOURCE|DATABASE_URL must explicitly|DATABASE_SSL must be explicitly|Remove TLS query parameters|DATABASE_URL must be a valid|DATABASE_URL must use the PostgreSQL)/.test(error.message);
  console.error(safe ? error.message : `Import failed (${error.code || 'IMPORT_FAILED'}). Database connection details were withheld.`);
  process.exitCode = 1;
});

module.exports = { readSqliteRows, importRows, runImport };
