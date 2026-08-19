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

// POST /api/users/create — admin: create a new user (admin or customer)
router.post('/create', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { name, email, phone, password, role = 'customer' } = req.body;

  if (!name || !email || !phone || !password) {
    res.status(400).json({ success: false, message: 'name, email, phone, password are required' });
    return;
  }
  if (!['admin', 'customer'].includes(role)) {
    res.status(400).json({ success: false, message: 'role must be admin or customer' });
    return;
  }

  // Check duplicates
  const exists = await queryOne(
    'SELECT id FROM users WHERE email = $1 OR phone = $2',
    [email, phone]
  );
  if (exists) {
    res.status(409).json({ success: false, message: 'A user with this email or phone already exists.' });
    return;
  }

  const hash = await bcrypt.hash(String(password), Number(process.env.BCRYPT_SALT_ROUNDS) || 10);

  const user = await queryOne(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, phone, role, status, wallet_balance, joined_at`,
    [name, email, phone, hash, role]
  );

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Created User', $3, $4, $5)`,
    [adminId, (req as any).user.email, `${name} (${email})`, `Role: ${role}`, req.ip || '0.0.0.0']
  );

  res.status(201).json({ success: true, message: `User ${name} created successfully.`, data: user });
}));
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

// GET /api/users/:id — admin: get specific user with real database bids and transactions
router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.id;

  const user = await queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.photo_url, u.role, u.status,
            u.wallet_balance, u.credits, u.joined_at,
            COALESCE(json_agg(uwa.auction_id) FILTER (WHERE uwa.auction_id IS NOT NULL), '[]') AS won_auctions
     FROM users u
     LEFT JOIN user_won_auctions uwa ON uwa.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  );
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Fetch real database bids placed by this user
  const userBids = await query(
    `SELECT b.id, b.auction_id, b.amount, b.is_duplicate, b.is_lowest_unique, b.created_at,
            a.title AS auction_title, a.status AS auction_status, a.image_url AS auction_image
     FROM bids b
     LEFT JOIN auctions a ON a.id = b.auction_id
     WHERE b.bidder_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );

  // Fetch real database transactions for this user
  const userTx = await query(
    `SELECT id, type, amount, description, status, payment_method, created_at
     FROM transactions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  // Fetch unlocked auctions for this user
  const unlockedAuctions = await query(
    `SELECT u.auction_id, u.amount_paid, u.created_at, a.title AS auction_title
     FROM auction_unlocks u
     LEFT JOIN auctions a ON a.id = u.auction_id
     WHERE u.user_id = $1
     ORDER BY u.created_at DESC`,
    [userId]
  );

  res.json({
    success: true,
    data: {
      ...user,
      bids: userBids,
      transactions: userTx,
      unlocked_auctions: unlockedAuctions,
    },
  });
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

  // Log transaction — use only allowed type values
  const txType = 'manual_adjustment';
  const desc = numAmount < 0
    ? `Admin manual withdrawal: ${reason}`
    : `Admin manual deposit (${type}): ${reason}`;

  await query(
    `INSERT INTO transactions (user_id, user_name, type, amount, description, status)
     VALUES ($1, $2, $3, $4, $5, 'completed')`,
    [req.params.id, updatedUser.name as string, txType, numAmount, desc]
  );

  // Update admin/platform wallet:
  // When admin credits ANOTHER user (+amount): deduct from admin
  // When admin withdraws from ANOTHER user (-amount): add to admin
  // When admin adjusts their OWN wallet: skip this (already updated above)
  const targetIsAdmin = req.params.id === (req as any).user.userId;
  if (type === 'wallet' && !targetIsAdmin) {
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

  // Real-time WebSocket event to target user and admin
  try {
    const { sendToUser } = await import('../ws/server');
    sendToUser(req.params.id, {
      type: 'balance_updated',
      wallet_balance: Number(updatedUser.wallet_balance || 0),
      credits: Number(updatedUser.credits || 0),
      amount: numAmount,
      reason,
    });
  } catch (_e) {}

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

