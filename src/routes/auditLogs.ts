import { Router, Request, Response } from 'express';
import { query } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/audit — admin: full audit log with filters
router.get('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { admin_id, action, search } = req.query;

  const rows = await query(
    `SELECT * FROM audit_logs
     WHERE
       ($1::uuid IS NULL OR admin_id = $1::uuid)
       AND ($2::text IS NULL OR action = $2)
       AND ($3::text IS NULL
            OR target ILIKE '%' || $3 || '%'
            OR details ILIKE '%' || $3 || '%'
            OR action ILIKE '%' || $3 || '%')
     ORDER BY created_at DESC
     LIMIT 500`,
    [admin_id ? String(admin_id) : null, action ? String(action) : null, search ? String(search) : null]
  );

  res.json({ success: true, data: rows });
}));

export default router;
