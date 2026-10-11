const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readSqliteRows, importRows } = require('../scripts/importSqlite');

class FakePostgresClient {
  constructor(initial = []) { this.records = new Map(initial.map((row) => [row.id, row])); this.pending = null; this.calls = []; }
  async query(sql, values = []) {
    this.calls.push(sql);
    if (sql.startsWith('SELECT')) {
      const source = this.pending || this.records;
      return { rows: values[0].map((id) => source.get(id)).filter(Boolean) };
    }
    if (sql === 'BEGIN') { this.pending = new Map(this.records); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO scans')) {
      const [id, scannedAt, submittedUrl, score, json, ownerId] = values;
      if (this.pending.has(id)) { const error = new Error('duplicate'); error.code = '23505'; throw error; }
      this.pending.set(id, { id, scanned_at: new Date(scannedAt), submitted_url: submittedUrl, score, scan: JSON.parse(json), owner_id: ownerId });
      return { rows: [] };
    }
    if (sql === 'COMMIT') { this.records = this.pending; this.pending = null; return { rows: [] }; }
    if (sql === 'ROLLBACK') { this.pending = null; return { rows: [] }; }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  }
}

describe('SQLite to PostgreSQL report import', () => {
  let directory;
  let sourcePath;
  let source;
  let scan;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'page-pulse-import-'));
    sourcePath = path.join(directory, 'source.sqlite');
    scan = {
      id: 'legacy-id-1', submittedUrl: 'https://example.test/', scannedAt: '2025-02-03T04:05:06.000Z',
      status: 'completed', httpStatus: 200, score: { value: 62, outOf: 100, breakdown: [{ id: 'title', points: 2 }] },
      metrics: { title: { text: 'Stored title' } }, issues: [{ issueId: 'title.missing', severity: 'high' }],
      recommendations: [{ issueId: 'title.missing', message: 'Add a title.' }], limitations: ['HTML only'],
    };
    source = new DatabaseSync(sourcePath);
    source.exec('CREATE TABLE scans (id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL, submitted_url TEXT NOT NULL, score INTEGER NOT NULL, scan TEXT NOT NULL, owner_id TEXT NULL)');
    source.prepare('INSERT INTO scans VALUES (?, ?, ?, ?, ?, ?)').run(scan.id, scan.scannedAt, scan.submittedUrl, scan.score.value, JSON.stringify(scan), null);
  });
  afterEach(async () => { source?.close(); await fs.rm(directory, { recursive: true, force: true }); });

  test('imports the existing unowned report with its ID, timestamp, score, findings, recommendations, and full document; safely reruns', async () => {
    const rows = readSqliteRows(sourcePath);
    const destination = new FakePostgresClient();
    await expect(importRows(rows, destination)).resolves.toEqual({ sourceCount: 1, alreadyPresent: 0, imported: 1, verified: 1 });
    expect(destination.records.get(scan.id)).toMatchObject({ id: scan.id, submitted_url: scan.submittedUrl, score: 62, owner_id: null, scan });
    await expect(importRows(rows, destination)).resolves.toEqual({ sourceCount: 1, alreadyPresent: 1, imported: 0, verified: 1 });
    expect(source.prepare('SELECT owner_id, scan FROM scans WHERE id = ?').get(scan.id)).toMatchObject({ owner_id: null, scan: JSON.stringify(scan) });
  });

  test('dry-run verifies the source without beginning a destination transaction', async () => {
    const destination = new FakePostgresClient();
    await expect(importRows(readSqliteRows(sourcePath), destination, { dryRun: true })).resolves.toEqual({ sourceCount: 1, alreadyPresent: 0, imported: 0, verified: 0 });
    expect(destination.calls).not.toContain('BEGIN');
    expect(destination.records.size).toBe(0);
  });

  test('rejects a conflicting duplicate ID without changing destination records', async () => {
    const destination = new FakePostgresClient([{ id: scan.id, scanned_at: new Date(scan.scannedAt), submitted_url: scan.submittedUrl, score: 50, scan: { ...scan, score: { value: 50 } }, owner_id: null }]);
    await expect(importRows(readSqliteRows(sourcePath), destination)).rejects.toThrow(`destination already contains a different report with ID ${scan.id}`);
    expect(destination.records.get(scan.id).score).toBe(50);
    expect(destination.calls).not.toContain('BEGIN');
  });

  test('rolls back the PostgreSQL transaction when an insert fails', async () => {
    const destination = new FakePostgresClient();
    const query = destination.query.bind(destination);
    destination.query = async (sql, values) => {
      if (sql.startsWith('INSERT INTO scans')) throw Object.assign(new Error('controlled insert failure'), { code: '23514' });
      return query(sql, values);
    };
    await expect(importRows(readSqliteRows(sourcePath), destination)).rejects.toThrow('controlled insert failure');
    expect(destination.calls).toContain('BEGIN');
    expect(destination.calls).toContain('ROLLBACK');
    expect(destination.records.size).toBe(0);
    expect(destination.pending).toBeNull();
  });

  test('refuses reports with an owner instead of reassigning them', () => {
    source.prepare('UPDATE scans SET owner_id = ? WHERE id = ?').run('user-owned-elsewhere', scan.id);
    expect(() => readSqliteRows(sourcePath)).toThrow('establish an explicit account identity mapping');
  });
});
