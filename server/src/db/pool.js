import pg from 'pg';
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
export let pool = connectionString ? new Pool({ connectionString, ssl: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined, max: Number(process.env.DATABASE_POOL_MAX || 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 }) : null;
if (pool) pool.on('error', (error) => console.error('Unexpected idle PostgreSQL client error:', error.message));

export function configurePoolForTests(testPool) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test pool injection is only available when NODE_ENV=test.');
  pool = testPool;
}
