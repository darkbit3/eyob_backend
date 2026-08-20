import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/settings/permissions — staff: load role permissions
router.get('/permissions', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query('SELECT role, permissions FROM role_permissions');
  const permissions = Object.fromEntries(rows.map((row: any) => [row.role, row.permissions || {}]));
  res.json({ success: true, data: permissions });
}));

// PUT /api/settings/permissions — admin: replace role permissions
router.put('/permissions', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  if ((req as any).user.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Only admins can update role permissions' });
    return;
  }
  const permissions = req.body?.permissions;
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    res.status(400).json({ success: false, message: 'A permissions object is required' });
    return;
  }

  for (const [role, rolePermissions] of Object.entries(permissions)) {
    if (!role || !rolePermissions || typeof rolePermissions !== 'object' || Array.isArray(rolePermissions)) continue;
    await query(
      `INSERT INTO role_permissions (role, permissions, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
      [role, JSON.stringify(rolePermissions)]
    );
  }
  res.json({ success: true, message: 'Role permissions saved' });
}));

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
    max_bids_per_user,
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
       max_bids_per_user        = COALESCE($9, max_bids_per_user),
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
      max_bids_per_user != null ? Math.max(0, Math.floor(Number(max_bids_per_user) || 0)) : null,
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

// ── Admin Official Bank Accounts & Deposit Methods ────────────────────────────

// GET /api/settings/bank-accounts — Public & Admin get list of official admin bank accounts
router.get('/bank-accounts', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query('SELECT * FROM admin_bank_accounts ORDER BY created_at ASC');
  res.json({ success: true, data: rows });
}));

// POST /api/settings/bank-accounts — Admin create new bank account
router.post('/bank-accounts', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { method_name, account_number, account_holder } = req.body;
  if (!method_name || !account_number || !account_holder) {
    res.status(400).json({ success: false, message: 'method_name, account_number, and account_holder are required' });
    return;
  }
  const row = await queryOne(
    `INSERT INTO admin_bank_accounts (method_name, account_number, account_holder)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [method_name, account_number, account_holder]
  );
  res.status(201).json({ success: true, message: 'Official bank account added successfully!', data: row });
}));

// PUT /api/settings/bank-accounts/:id — Admin update bank account
router.put('/bank-accounts/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { method_name, account_number, account_holder, is_active } = req.body;
  const row = await queryOne(
    `UPDATE admin_bank_accounts SET
       method_name    = COALESCE($1, method_name),
       account_number = COALESCE($2, account_number),
       account_holder = COALESCE($3, account_holder),
       is_active      = COALESCE($4, is_active),
       updated_at     = NOW()
     WHERE id = $5
     RETURNING *`,
    [method_name || null, account_number || null, account_holder || null, is_active !== undefined ? is_active : null, id]
  );
  if (!row) {
    res.status(404).json({ success: false, message: 'Bank account not found' });
    return;
  }
  res.json({ success: true, message: 'Bank account updated successfully!', data: row });
}));

// DELETE /api/settings/bank-accounts/:id — Admin delete bank account
router.delete('/bank-accounts/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  await query('DELETE FROM admin_bank_accounts WHERE id = $1', [id]);
  res.json({ success: true, message: 'Bank account deleted successfully!' });
}));

export default router;
