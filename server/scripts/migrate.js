const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { postgresConnectionOptions } = require('../src/repositories/scanRepository');

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run PostgreSQL migrations.');
  const pool = new Pool({ ...postgresConnectionOptions(process.env.DATABASE_URL), max: 5 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    for (const name of ['001_create_scans.sql', '002_auth_and_ownership.sql']) {
      const migration = await fs.readFile(path.join(__dirname, '../migrations', name), 'utf8');
      await client.query(migration);
    }
    await client.query('COMMIT');
    console.log('Page Pulse database migrations completed.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (require.main === module) migrate().catch((error) => { console.error(`Migration failed (${error.code || 'MIGRATION_FAILED'}). Check database configuration; connection details were withheld.`); process.exitCode = 1; });

module.exports = { migrate };
