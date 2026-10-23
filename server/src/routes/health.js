import { Router } from 'express';
import { pool } from '../db/pool.js';
const router = Router();
router.get('/health', (_req, res) => res.json({ status: 'ok', message: 'API is online', databaseConfigured: Boolean(pool) }));
export default router;
