import 'dotenv/config';
import { createApp } from './app.js';
import { pool } from './db/pool.js';

const app = createApp();
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => console.log(`BUP API listening on http://localhost:${port}`));

function shutdown(signal) {
  console.log(`${signal} received; shutting down.`);
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
