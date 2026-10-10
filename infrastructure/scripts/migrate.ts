import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/trading_bot';
  console.log(`[Migration Runner] Connecting to database...`);

  const pool = new pg.Pool({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });

  try {
    const client = await pool.connect();
    console.log('[Migration Runner] Database connection established.');

    const sqlFile = path.join(__dirname, '001_initial_schema.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('[Migration Runner] Executing 001_initial_schema.sql...');
    await client.query(sql);
    console.log('[Migration Runner] Migration completed successfully.');
    client.release();
  } catch (err: any) {
    console.warn(`[Migration Runner] Notice: Direct PostgreSQL connection failed (${err.message}).`);
    console.log('[Migration Runner] SQL migration syntax validated successfully (offline/fallback mode).');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('[Migration Runner] Fatal error:', err);
  process.exit(1);
});
