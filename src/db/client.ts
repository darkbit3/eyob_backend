import { Pool, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill in your PostgreSQL connection string.'
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,

  // Pool tuning for Neon — keep connections alive, don't pay cold-start per request
  max: 10,                      // Increased from 5 to handle more concurrent requests
  min: 1,                      // Always keep 1 warm connection ready
  idleTimeoutMillis: 60_000,   // Keep idle connections for 60s (Neon idles after 5min)
  connectionTimeoutMillis: 15_000,  // Increased from 8s to 15s to reduce timeout errors
  statement_timeout: 30_000,   // Statement timeout: 30s per query
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// Warm the pool on startup — sends one cheap query so first real request is instant
export async function warmPool(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('  ✅  DB pool warmed');
  } catch (err: any) {
    console.error('  ❌  DB warm-up failed:', err.message);
  }
}

// Helper: run a query and return all rows
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, values);
    return result.rows;
  } catch (err: any) {
    // Retry once on connection timeout errors
    if (err.message?.includes('timeout') || err.message?.includes('Connection terminated')) {
      console.warn('Query timeout, retrying once...', { query: text.substring(0, 50) });
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await pool.query<T>(text, values);
      return result.rows;
    }
    throw err;
  }
}

// Helper: run a query and return a single row or null
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}
