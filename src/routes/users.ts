import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/users — admin: list all users
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const users = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.photo_url, u.role, u.status,
            u.wallet_balance, u.credits, u.joined_at,
            COALESCE(json_agg(uwa.auction_id) FILTER (WHERE uwa.auction_id IS NOT NULL), '[]') AS won_auctions
     FROM users u
     LEFT JOIN user_won_auctions uwa ON uwa.user_id = u.id
     GROUP BY u.id
     ORDER BY u.joined_at DESC`
  );
  res.json({ success: true, data: users });
}));

// GET /api/users/me — get current user profile
router.get('/me', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const user = await queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.photo_url, u.role, u.status,
            u.wallet_balance, u.joined_at
     FROM users u
     WHERE u.id = $1`,
    [userId]
  );

  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  
  // Add cache header
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ success: true, data: user });
}));

// GET /api/users/:id — admin: get specific user
router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const user = await queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.photo_url, u.role, u.status,
            u.wallet_balance, u.credits, u.joined_at,
            COALESCE(json_agg(uwa.auction_id) FILTER (WHERE uwa.auction_id IS NOT NULL), '[]') AS won_auctions
     FROM users u
     LEFT JOIN user_won_auctions uwa ON uwa.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [req.params.id]
  );
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  res.json({ success: true, data: user });
}));

// PATCH /api/users/:id/status — admin: suspend or activate user
router.patch('/:id/status', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) {
    res.status(400).json({ success: false, message: 'status must be active or suspended' });
    return;
  }

  const user = await queryOne(
    `UPDATE users SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, status`,
    [status, req.params.id]
  );
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Audit log
  const adminId = (req as any).user.userId;
  const adminName = (req as any).user.email;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      adminId,
      adminName,
      status === 'suspended' ? 'Suspended User' : 'Activated User',
      `${user.name} (${req.params.id})`,
      `Status changed to ${status.toUpperCase()}`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({ success: true, message: `User ${status}`, data: user });
}));

// DELETE /api/users/:id — super admin: delete user
router.delete('/:id', authenticate, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
  const user = await queryOne(
    `DELETE FROM users WHERE id = $1 RETURNING id, name`,
    [req.params.id]
  );
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Deleted User Account', $3, 'User removed from platform registry.', $4)`,
    [adminId, (req as any).user.email, `${user.name} (${req.params.id})`, req.ip || '0.0.0.0']
  );

  res.json({ success: true, message: 'User deleted', data: user });
}));

// PATCH /api/users/:id/wallet — admin: manual wallet or credit adjustment
router.patch('/:id/wallet', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { amount, reason, type } = req.body; // type: 'wallet' | 'credits'

  if (amount === undefined || !reason || !type) {
    res.status(400).json({ success: false, message: 'amount, reason, and type (wallet|credits) are required' });
    return;
  }

  const numAmount = Number(amount);
  const targetUser = await queryOne(`SELECT id, name, wallet_balance, credits FROM users WHERE id = $1`, [req.params.id]);
  if (!targetUser) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  // Check sufficient user balance if withdrawing
  if (type === 'wallet' && numAmount < 0) {
    const currentBalance = Number(targetUser.wallet_balance || 0);
    const withdrawAmount = Math.abs(numAmount);
    if (currentBalance < withdrawAmount) {
      res.status(400).json({
        success: false,
        message: `Insufficient user wallet balance (${currentBalance} ETB available). Cannot withdraw ${withdrawAmount} ETB.`
      });
      return;
    }
  }

  let updatedUser;
  if (type === 'credits') {
    updatedUser = await queryOne(
      `UPDATE users SET credits = GREATEST(0, credits + $1), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, wallet_balance, credits`,
      [numAmount, req.params.id]
    );
  } else {
    updatedUser = await queryOne(
      `UPDATE users SET wallet_balance = GREATEST(0, wallet_balance + $1), updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, wallet_balance, credits`,
      [numAmount, req.params.id]
    );
  }

  if (!updatedUser) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Log transaction
  const txType = numAmount < 0 ? 'manual_withdrawal' : 'manual_adjustment';
  const desc = numAmount < 0
    ? `Admin manual withdrawal: ${reason}`
    : `Admin manual deposit (${type}): ${reason}`;

  await query(
    `INSERT INTO transactions (user_id, user_name, type, amount, description, status)
     VALUES ($1, $2, $3, $4, $5, 'completed')`,
    [req.params.id, updatedUser.name as string, txType, numAmount, desc]
  );

  // Update admin/platform wallet: when admin credits a user (+numAmount) deduct from admin; when admin withdraws (-numAmount) add to admin balance!
  if (type === 'wallet') {
    try {
      await query(
        `UPDATE users SET
           wallet_balance = GREATEST(0, wallet_balance - $1),
           updated_at = NOW()
         WHERE id = $2`,
        [numAmount, (req as any).user.userId]
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('Failed to update admin wallet for manual adjustment', message);
    }
  }

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      adminId,
      (req as any).user.email,
      numAmount < 0 ? 'Manual Wallet Withdrawal' : 'Manual Wallet Deposit',
      `${updatedUser.name} (${req.params.id})`,
      `Adjusted ${numAmount > 0 ? '+' : ''}${numAmount} ${type}. Reason: ${reason}`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({
    success: true,
    message: numAmount < 0 ? 'Wallet withdrawal processed successfully' : 'Wallet deposit processed successfully',
    data: updatedUser
  });
}));

// POST /api/users/:id/reset-password — admin: set a temporary password for user
router.post('/:id/reset-password', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const temp = req.body.tempPassword || `Temp${Math.random().toString(36).slice(2,8)}A!`;

  const hash = await bcrypt.hash(String(temp), Number(process.env.BCRYPT_SALT_ROUNDS) || 10);

  const updated = await queryOne(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, email, phone`,
    [hash, req.params.id]
  );

  if (!updated) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Audit
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Reset Password', $3, $4, $5)`,
    [ (req as any).user.userId, (req as any).user.email, `${updated.name} (${req.params.id})`, `Temporary password issued`, req.ip || '0.0.0.0' ]
  );

  res.json({ success: true, message: 'Temporary password set', data: { temp } });
}));

export default router;

