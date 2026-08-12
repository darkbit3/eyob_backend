import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/settings — admin: get system settings
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const row = await queryOne('SELECT * FROM system_settings LIMIT 1');
  res.json({ success: true, data: row });
}));

// PATCH /api/settings — admin: update system settings
router.patch('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const {
    platform_name, support_email, currency,
    min_bid_price, max_bid_price, default_bid_step,
    auto_winner_verification, maintenance_mode,
  } = req.body;

  const row = await queryOne(
    `UPDATE system_settings SET
       platform_name            = COALESCE($1, platform_name),
       support_email            = COALESCE($2, support_email),
       currency                 = COALESCE($3, currency),
       min_bid_price            = COALESCE($4, min_bid_price),
       max_bid_price            = COALESCE($5, max_bid_price),
       default_bid_step         = COALESCE($6, default_bid_step),
       auto_winner_verification = COALESCE($7, auto_winner_verification),
       maintenance_mode         = COALESCE($8, maintenance_mode),
       updated_at               = NOW()
     WHERE id = 1
     RETURNING *`,
    [
      platform_name || null, support_email || null, currency || null,
      min_bid_price != null ? Number(min_bid_price) : null,
      max_bid_price != null ? Number(max_bid_price) : null,
      default_bid_step != null ? Number(default_bid_step) : null,
      auto_winner_verification != null ? Boolean(auto_winner_verification) : null,
      maintenance_mode != null ? Boolean(maintenance_mode) : null,
    ]
  );

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Updated Settings', 'Platform Core', $3, $4)`,
    [
      adminId,
      (req as any).user.email,
      `Updated parameters: ${Object.keys(req.body).join(', ')}`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({ success: true, message: 'Settings updated', data: row });
}));

export default router;
