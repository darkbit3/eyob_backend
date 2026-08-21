import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import crypto from 'crypto';

const router = Router();

const CHAPA_SECRET = process.env.CHAPA_SECRET_KEY || '';
const CHAPA_API    = 'https://api.chapa.co/v1';
const RETURN_URL   = process.env.CHAPA_RETURN_URL   || 'https://eyob-z2xx.onrender.com/wallet';
const CALLBACK_URL = process.env.CHAPA_CALLBACK_URL || 'https://eyob-backend.onrender.com/api/wallet/chapa/callback';

function decryptSecret(value: string): string {
  if (!value) return '';
  try {
    const [ivHex, encryptedHex] = value.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      crypto.createHash('sha256').update(process.env.JWT_SECRET || 'bidlow-payment-config').digest(),
      Buffer.from(ivHex, 'hex')
    );
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

// ── POST /api/wallet/chapa/initialize ────────────────────────────────────────
// Customer calls this to get a Chapa checkout URL
router.post('/initialize', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const { amount, return_url } = req.body;

  const amt = Number(amount);
  if (!amt || amt < 10) {
    res.status(400).json({ success: false, message: 'Minimum deposit is 10 ETB' });
    return;
  }

  const gateway = await queryOne('SELECT secret_key FROM payment_gateways WHERE LOWER(name) = $1 AND is_active = TRUE', ['chapa']);
  if (!gateway) {
    res.status(503).json({ success: false, message: 'Chapa payments are currently unavailable.' });
    return;
  }
  const chapaSecret = decryptSecret(gateway.secret_key as string) || CHAPA_SECRET;
  if (!chapaSecret) {
    res.status(503).json({ success: false, message: 'Chapa payment is not configured yet.' });
    return;
  }

  // Fetch user details
  const user = await queryOne('SELECT id, name, email, phone FROM users WHERE id = $1', [userId]);
  if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }

  // Build unique tx_ref
  const txRef = `BIDLOW-${userId.slice(0, 8)}-${Date.now()}`;

  // Store pending record in payment_queue so we can track it
  await query(
    `INSERT INTO payment_queue
       (user_id, user_name, user_email, amount, credits, payment_method, reference_number, receipt_image, notes)
     VALUES ($1, $2, $3, $4, $5, 'Chapa', $6, '', $7)`,
    [
      userId,
      user.name as string,
      user.email as string,
      amt,
      amt,
      txRef,
      'Chapa payment initialized — awaiting confirmation',
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

  // ── Normalize phone to Chapa format: 09xxxxxxxx or 07xxxxxxxx ───────────
  // DB stores phone as e.g. "+251912345678" or "0912345678"
  const rawPhone = (user.phone as string) ?? '';
  const digitsOnly = rawPhone.replace(/\D/g, ''); // strip non-digits
  let chapaPhone = '';
  if (digitsOnly.startsWith('251') && digitsOnly.length === 12) {
    // +251912345678 → 0912345678
    chapaPhone = '0' + digitsOnly.slice(3);
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 10) {
    // already 0912345678
    chapaPhone = digitsOnly;
  } else if (digitsOnly.length === 9) {
    // 912345678 → 0912345678
    chapaPhone = '0' + digitsOnly;
  } else {
    // fallback — omit phone so Chapa doesn't reject
    chapaPhone = '';
  }
  const clientOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const effectiveReturnBase = (typeof return_url === 'string' && return_url)
    ? return_url
    : (clientOrigin ? `${clientOrigin}/e1f2g3` : RETURN_URL);
  const finalReturnUrl = effectiveReturnBase.includes('?')
    ? `${effectiveReturnBase}&tx_ref=${txRef}&status=success`
    : `${effectiveReturnBase}?tx_ref=${txRef}&status=success`;

  // Call Chapa initialize API
  const chapaBody: Record<string, string> = {
    amount: String(amt),
    currency: 'ETB',
    email: user.email as string,
    first_name: firstName,
    last_name: lastName,
    tx_ref: txRef,
    callback_url: CALLBACK_URL,
    return_url: finalReturnUrl,
    'customization[title]': 'BidLow Wallet Top-Up',
    'customization[description]': `Deposit ${amt} ETB to your BidLow auction wallet`,
  };
  // Only include phone_number if it's valid 10-digit Ethiopian format (09xx or 07xx)
  if (chapaPhone.length === 10 && (chapaPhone.startsWith('09') || chapaPhone.startsWith('07'))) {
    chapaBody['phone_number'] = chapaPhone;
  }

  const chapaRes = await fetch(`${CHAPA_API}/transaction/initialize`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${chapaSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chapaBody),
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

  const gateway = await queryOne('SELECT secret_key FROM payment_gateways WHERE LOWER(name) = $1 AND is_active = TRUE', ['chapa']);
  const chapaSecret = gateway ? (decryptSecret(gateway.secret_key as string) || CHAPA_SECRET) : '';
  if (!chapaSecret) {
    res.status(503).json({ success: false, message: 'Chapa payments are currently unavailable.' });
    return;
  }

  // Verify with Chapa
  const verifyRes = await fetch(`${CHAPA_API}/transaction/verify/${tx_ref}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${chapaSecret}` },
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
