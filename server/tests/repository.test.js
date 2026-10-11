const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ScanRepository, postgresConnectionOptions, verifyPostgresSchema } = require('../src/repositories/scanRepository');

describe('local scan repository', () => {
  let directory;
  let repository;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'page-pulse-test-'));
    repository = new ScanRepository({ databaseUrl: '', filePath: path.join(directory, 'scans.sqlite') });
    await repository.init();
  });
  afterEach(async () => { await repository.close(); await fs.rm(directory, { recursive: true, force: true }); });

  test('persists reports and serializes concurrent writes without losing entries', async () => {
    const scans = Array.from({ length: 8 }, (_, index) => ({ id: `scan-${index}`, scannedAt: new Date(Date.now() + index).toISOString(), submittedUrl: `https://example${index}.test`, score: { value: index } }));
    await Promise.all(scans.map((scan) => repository.save(scan)));
    const loadedRepository = new ScanRepository({ databaseUrl: '', filePath: repository.filePath });
    await loadedRepository.init();
    const loaded = await loadedRepository.list();
    expect(loaded).toHaveLength(8);
    expect(await loadedRepository.get('scan-4')).toMatchObject({ submittedUrl: 'https://example4.test' });
    expect(await loadedRepository.get('missing-scan')).toBeNull();
    await loadedRepository.close();
  });

  test('clears saved reports', async () => {
    await repository.save({ id: 'scan-1', scannedAt: new Date().toISOString(), submittedUrl: 'https://example.test', score: { value: 80 } });
    await repository.deleteAll();
    expect(await repository.list()).toEqual([]);
  });

  test('checks local database readiness and closes idempotently', async () => {
    await expect(repository.check()).resolves.toBe(true);
    await repository.close();
    await expect(repository.close()).resolves.toBeUndefined();
  });

  test('requires explicit PostgreSQL TLS mode and rejects connection-string TLS overrides', () => {
    expect(() => postgresConnectionOptions('postgresql://user:pass@localhost/db', undefined)).toThrow('DATABASE_SSL must be explicitly set');
    expect(postgresConnectionOptions('postgresql://user:pass@localhost/db', 'false').ssl).toBeUndefined();
    expect(postgresConnectionOptions('postgresql://user:pass@localhost/db', 'true').ssl).toEqual({ rejectUnauthorized: true });
    expect(() => postgresConnectionOptions('postgresql://user:pass@localhost/db?sslmode=require', 'true')).toThrow('Remove TLS query parameters');
    expect(() => postgresConnectionOptions('https://example.com', 'false')).toThrow('PostgreSQL scheme');
  });

  test('requires the explicit migrated PostgreSQL schema without issuing DDL', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ scans: 'scans', users: 'users', sessions: 'sessions', scan_owner_id: true }] }) };
    await expect(verifyPostgresSchema(pool)).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/to_regclass/);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/CREATE|ALTER|DROP/i);
    await expect(verifyPostgresSchema({ query: async () => ({ rows: [{ scans: 'scans', users: 'users', sessions: 'sessions', scan_owner_id: false }] }) })).rejects.toThrow('Run the explicit database migration');
  });

  test('adds nullable ownership to a legacy SQLite database without changing saved reports', async () => {
    await repository.close();
    const { DatabaseSync } = require('node:sqlite');
    const filePath = repository.filePath;
    await fs.rm(filePath, { force: true });
    const legacy = new DatabaseSync(filePath);
    const scan = { id: 'legacy-report', scannedAt: new Date().toISOString(), submittedUrl: 'https://legacy.example', score: { value: 62 } };
    legacy.exec('CREATE TABLE scans (id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL, submitted_url TEXT NOT NULL, score INTEGER NOT NULL, scan TEXT NOT NULL)');
    legacy.prepare('INSERT INTO scans (id, scanned_at, submitted_url, score, scan) VALUES (?, ?, ?, ?, ?)').run(scan.id, scan.scannedAt, scan.submittedUrl, 62, JSON.stringify(scan));
    legacy.close();
    repository = new ScanRepository({ databaseUrl: '', filePath });
    await repository.init();
    expect(await repository.get(scan.id)).toEqual(scan);
    expect(await repository.list()).toEqual([scan]);
    expect(await repository.list('new-user')).toEqual([]);
    expect(repository.database.prepare('SELECT owner_id FROM scans WHERE id = ?').get(scan.id).owner_id).toBeNull();
  });
});
