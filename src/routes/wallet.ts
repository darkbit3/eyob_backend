import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/wallet/balance — logged-in user balance & credits
router.get('/balance', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const user = await queryOne(
    'SELECT wallet_balance, credits FROM users WHERE id = $1',
    [userId]
  );
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
  res.json({
    success: true,
    data: {
      wallet_balance: Number(user.wallet_balance || 0),
      credits: Number(user.credits || 0),
    },
  });
}));

// GET /api/wallet/transactions — returns transactions for logged-in user or admin
router.get('/transactions', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const limitParam = Number(req.query.limit) || 20;

  if (user.role === 'admin') {
    const rows = await query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1', [limitParam]);
    res.json({ success: true, data: rows });
  } else {
    const rows = await query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [user.userId, limitParam]
    );
    res.json({ success: true, data: rows });
  }
}));

// GET /api/wallet/transactions/my — customer: own transactions
router.get('/transactions/my', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const limitParam = Number(req.query.limit) || 50;
  const rows = await query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limitParam]);
  res.json({ success: true, data: rows });
}));

// GET /api/wallet/queue — admin: payment verification queue
router.get('/queue', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT pq.*, u.photo_url
     FROM payment_queue pq
     JOIN users u ON u.id = pq.user_id
     ORDER BY pq.created_at DESC`
  );
  res.json({ success: true, data: rows });
}));

// POST /api/wallet/queue — customer: submit payment deposit request
router.post('/queue', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const { amount, credits, payment_method, reference_number, receipt_image, notes } = req.body;

  if (!amount || !credits || !payment_method || !reference_number || !receipt_image) {
    res.status(400).json({ success: false, message: 'amount, credits, payment_method, reference_number, receipt_image required' });
    return;
  }

  const user = await queryOne('SELECT id, name, email FROM users WHERE id = $1', [userId]);
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  const row = await queryOne(
    `INSERT INTO payment_queue
       (user_id, user_name, user_email, amount, credits, payment_method, reference_number, receipt_image, notes)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId, user.name as string, user.email as string,
      Number(amount), Number(credits),
      payment_method, reference_number, receipt_image, notes || ''
    ]
  );

  // Notify user
  await query(
    `INSERT INTO notifications (user_id, type, title, message)
     VALUES ($1, 'payment_received', 'Deposit Received & Under Review', $2)`,
    [userId, `Your ${payment_method} deposit of ${amount} ETB has been submitted and is pending admin approval.`]
  );

  res.status(201).json({ success: true, message: 'Payment submission received. Awaiting admin verification.', data: row });
}));

// PATCH /api/wallet/queue/:id/approve — admin: approve payment
router.patch('/queue/:id/approve', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const item = await queryOne(
    `SELECT * FROM payment_queue WHERE id = $1 AND status = 'pending'`,
    [req.params.id]
  );
  if (!item) { res.status(404).json({ success: false, message: 'Pending payment not found' }); return; }

  const adminName = (req as any).user.email;

  // Approve queue item
  await query(
    `UPDATE payment_queue SET
       status = 'approved',
       notes  = $1,
       reviewed_by = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [`Approved by ${adminName}`, (req as any).user.userId, req.params.id]
  );

  // Credit user wallet and credits
  await query(
    `UPDATE users SET
       wallet_balance = wallet_balance + $1,
       credits        = credits + $2,
       updated_at     = NOW()
     WHERE id = $3`,
    [Number(item.amount), Number(item.credits), item.user_id as string]
  );

  // Decrease admin/platform wallet balance by the same amount (admin pays out user credits)
  try {
    await query(
      `UPDATE users SET
         wallet_balance = GREATEST(0, wallet_balance - $1),
         updated_at = NOW()
       WHERE id = $2`,
      [Number(item.amount), (req as any).user.userId]
    );
  } catch (e: unknown) {
    // non-fatal: log in DB but don't block approval
    const message = e instanceof Error ? e.message : String(e);
    console.warn('Failed to deduct admin wallet for approved payment', message);
  }

  // Log transaction
  await query(
    `INSERT INTO transactions (user_id, user_name, type, amount, description, status, payment_method)
     VALUES ($1, $2, 'credit_purchase', $3, $4, 'completed', $5)`,
    [
      item.user_id as string,
      item.user_name as string,
      Number(item.amount),
      `Approved deposit via ${item.payment_method} (Ref: ${item.reference_number})`,
      item.payment_method as string
    ]
  );

  // Notify user
  await query(
    `INSERT INTO notifications (user_id, type, title, message)
     VALUES ($1, 'wallet_updated', 'Deposit Approved! Wallet Updated ✅', $2)`,
    [
      item.user_id as string,
      `Your deposit of ${item.amount} ETB has been approved. ${item.credits} bidding credits added to your account.`
    ]
  );

  // Audit
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Approved Payment', $3, $4, $5)`,
    [
      (req as any).user.userId,
      adminName,
      `${item.user_name} (${item.reference_number})`,
      `Amount: ${item.amount} ETB, Credits added: ${item.credits}`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({ success: true, message: `Payment approved — ${item.amount} ETB credited to ${item.user_name}` });
}));

// PATCH /api/wallet/queue/:id/reject — admin: reject payment
router.patch('/queue/:id/reject', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const rejectionReason = reason || 'Verification details do not match bank statement';

  const item = await queryOne(
    `SELECT * FROM payment_queue WHERE id = $1 AND status = 'pending'`,
    [req.params.id]
  );
  if (!item) { res.status(404).json({ success: false, message: 'Pending payment not found' }); return; }

  await query(
    `UPDATE payment_queue SET
       status = 'rejected',
       notes  = $1,
       reviewed_by = $2,
       updated_at = NOW()
     WHERE id = $3`,
    [`Rejected: ${rejectionReason}`, (req as any).user.userId, req.params.id]
  );

  // Notify user
  await query(
    `INSERT INTO notifications (user_id, type, title, message)
     VALUES ($1, 'payment_received', 'Deposit Rejected — Action Required', $2)`,
    [
      item.user_id as string,
      `Your deposit (Ref: ${item.reference_number}) was rejected. Reason: ${rejectionReason}. Please contact support.`
    ]
  );

  // Audit
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Rejected Payment', $3, $4, $5)`,
    [
      (req as any).user.userId,
      (req as any).user.email,
      `${item.user_name} (${item.reference_number})`,
      `Reason: ${rejectionReason}`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({ success: true, message: 'Payment rejected' });
}));

export default router;
