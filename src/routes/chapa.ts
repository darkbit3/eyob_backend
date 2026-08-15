import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

const CHAPA_SECRET = process.env.CHAPA_SECRET_KEY || '';
const CHAPA_API    = 'https://api.chapa.co/v1';
const RETURN_URL   = process.env.CHAPA_RETURN_URL   || 'https://eyob-z2xx.onrender.com/wallet';
const CALLBACK_URL = process.env.CHAPA_CALLBACK_URL || 'https://eyob-backend.onrender.com/api/wallet/chapa/callback';

// ── POST /api/wallet/chapa/initialize ────────────────────────────────────────
// Customer calls this to get a Chapa checkout URL
router.post('/initialize', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const { amount } = req.body;

  const amt = Number(amount);
  if (!amt || amt < 10) {
    res.status(400).json({ success: false, message: 'Minimum deposit is 10 ETB' });
    return;
  }

  // Fetch user details
  const user = await queryOne('SELECT id, name, email, phone FROM users WHERE id = $1', [userId]);
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Build unique tx_ref
  const txRef = `BIDLOW-${userId.slice(0, 8)}-${Date.now()}`;

  // Store pending record in payment_queue so we can track it
  await queryOne(
    `INSERT INTO payment_queue
       (user_id, user_name, user_email, amount, credits, payment_method, reference_number, receipt_image, notes)
     VALUES ($1, $2, $3, $4, $5, 'Chapa', $6, '', $7)
     ON CONFLICT DO NOTHING`,
    [
      userId,
      user.name as string,
      user.email as string,
      amt,
      amt,
      txRef,
      `Chapa payment initialized — awaiting confirmation`,
    ]
  );

  // Notify user
  await query(
    `INSERT INTO notifications (user_id, type, title, message)
     VALUES ($1, 'payment_received', 'Deposit In Progress', $2)`,
    [userId, `Your Chapa deposit of ${amt} ETB has been initiated (Ref: ${txRef}). Complete payment on the checkout page.`]
  );

  // Split name into first/last
  const nameParts = (user.name as string).trim().split(' ');
  const firstName = nameParts[0] || 'Customer';
  const lastName  = nameParts.slice(1).join(' ') || 'User';

  // Call Chapa initialize API
  const chapaRes = await fetch(`${CHAPA_API}/transaction/initialize`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHAPA_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: String(amt),
      currency: 'ETB',
      email: user.email as string,
      first_name: firstName,
      last_name: lastName,
      phone_number: (user.phone as string)?.replace(/\D/g, '').slice(-10) || '',
      tx_ref: txRef,
      callback_url: CALLBACK_URL,
      return_url: `${RETURN_URL}?tx_ref=${txRef}&status=success`,
      'customization[title]': 'BidLow Wallet Top-Up',
      'customization[description]': `Deposit ${amt} ETB to your BidLow auction wallet`,
      'meta[hide_receipt]': 'false',
    }),
  });

  if (!chapaRes.ok) {
    const errBody = await chapaRes.json().catch(() => ({}));
    res.status(502).json({
      success: false,
      message: (errBody as any)?.message || 'Chapa initialization failed. Try again.',
    });
    return;
  }

  const chapaData = await chapaRes.json() as { status: string; data: { checkout_url: string } };

  if (chapaData.status !== 'success' || !chapaData.data?.checkout_url) {
    res.status(502).json({ success: false, message: 'Chapa did not return a checkout URL.' });
    return;
  }

  res.json({
    success: true,
    data: {
      checkout_url: chapaData.data.checkout_url,
      tx_ref: txRef,
    },
  });
}));

// ── GET /api/wallet/chapa/verify/:tx_ref ─────────────────────────────────────
// Called by frontend after redirect to verify payment status
router.get('/verify/:tx_ref', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const { tx_ref } = req.params;

  // Check if already approved to prevent double-crediting
  const existing = await queryOne(
    `SELECT * FROM payment_queue WHERE reference_number = $1`,
    [tx_ref]
  );

  if (!existing) {
    res.status(404).json({ success: false, message: 'Transaction not found.' });
    return;
  }

  if (existing.status === 'approved') {
    res.json({ success: true, message: 'Already credited.', data: { status: 'approved' } });
    return;
  }

  // Verify with Chapa
  const verifyRes = await fetch(`${CHAPA_API}/transaction/verify/${tx_ref}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${CHAPA_SECRET}` },
  });

  if (!verifyRes.ok) {
    res.status(502).json({ success: false, message: 'Chapa verification request failed.' });
    return;
  }

  const verifyData = await verifyRes.json() as { status: string; data: { status: string; amount: number } };

  if (verifyData.status !== 'success' || verifyData.data?.status !== 'success') {
    res.json({ success: false, message: 'Payment not confirmed by Chapa yet.', data: { status: verifyData.data?.status || 'pending' } });
    return;
  }

  const creditedAmount = Number(existing.amount);

  // Approve in payment_queue
  await query(
    `UPDATE payment_queue SET status = 'approved', notes = 'Auto-verified via Chapa API', updated_at = NOW() WHERE reference_number = $1`,
    [tx_ref]
  );

  // Credit user wallet
  await query(
    `UPDATE users SET wallet_balance = wallet_balance + $1, credits = credits + $2, updated_at = NOW() WHERE id = $3`,
    [creditedAmount, creditedAmount, userId]
  );

  // Log transaction
  await query(
    `INSERT INTO transactions (user_id, user_name, type, amount, description, status, payment_method)
     VALUES ($1, $2, 'credit_purchase', $3, $4, 'completed', 'Chapa')`,
    [
      userId,
      existing.user_name as string,
      creditedAmount,
      `Chapa deposit approved — Ref: ${tx_ref}`,
    ]
  );

  // Notify user
  await query(
    `INSERT INTO notifications (user_id, type, title, message)
     VALUES ($1, 'wallet_updated', 'Deposit Confirmed! ✅', $2)`,
    [userId, `Your Chapa deposit of ${creditedAmount} ETB has been confirmed and credited to your wallet.`]
  );

  res.json({
    success: true,
    message: `${creditedAmount} ETB credited to your wallet.`,
    data: { status: 'approved', amount: creditedAmount },
  });
}));

// ── GET /api/wallet/chapa/callback ───────────────────────────────────────────
// Chapa webhook callback (no auth — Chapa calls this)
router.get('/callback', asyncHandler(async (req: Request, res: Response) => {
  const { trx_ref, status } = req.query;
  // Just acknowledge — actual crediting happens on /verify call from frontend
  res.json({ success: true, received: true, trx_ref, status });
}));

export default router;
