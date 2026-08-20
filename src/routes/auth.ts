import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db/client';
import { signToken } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/auth/register
router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !phone || !password) {
    res.status(400).json({ success: false, message: 'All fields required: name, email, phone, password' });
    return;
  }

  // Name
  if (String(name).trim().length < 2) {
    res.status(400).json({ success: false, message: 'Full name must be at least 2 characters' });
    return;
  }

  // Email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    res.status(400).json({ success: false, message: 'Invalid email address format' });
    return;
  }

  // Normalize phone: strip spaces, accept leading 0 (local) or +251 or 251, and convert to +251XXXXXXXXX
  let cleanPhone = String(phone).replace(/\s+/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '+251' + cleanPhone.slice(1);
  } else if (cleanPhone.startsWith('251')) {
    cleanPhone = '+' + cleanPhone;
  }
  if (!/^\+251[79]\d{8}$/.test(cleanPhone)) {
    res.status(400).json({ success: false, message: 'Phone must be a valid Ethiopian number (e.g. 0909xxxxxxxx or +2519xxxxxxxx)' });
    return;
  }

  // Password strength: min 8, uppercase, lowercase, number, special char
  const pwd = String(password);
  if (pwd.length < 8) {
    res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    return;
  }
  if (!/[A-Z]/.test(pwd)) {
    res.status(400).json({ success: false, message: 'Password must contain at least one uppercase letter' });
    return;
  }
  if (!/[a-z]/.test(pwd)) {
    res.status(400).json({ success: false, message: 'Password must contain at least one lowercase letter' });
    return;
  }
  if (!/\d/.test(pwd)) {
    res.status(400).json({ success: false, message: 'Password must contain at least one number' });
    return;
  }
  if (!/[^A-Za-z0-9]/.test(pwd)) {
    res.status(400).json({ success: false, message: 'Password must contain at least one special character' });
    return;
  }

  const password_hash = await bcrypt.hash(pwd, Number(process.env.BCRYPT_SALT_ROUNDS) || 10);

  // Single round-trip: insert and detect conflict atomically
  let user;
  try {
    user = await queryOne(
      `INSERT INTO users (name, email, phone, password_hash, role, status, wallet_balance, credits)
       VALUES ($1, $2, $3, $4, 'customer', 'active', 0, 0)
       ON CONFLICT DO NOTHING
       RETURNING id, name, email, phone, role, status, wallet_balance, credits, joined_at`,
      [String(name).trim(), String(email).trim().toLowerCase(), cleanPhone, password_hash]
    );
  } catch (dbErr: any) {
    console.error('[REGISTER DB ERROR]', dbErr.code, dbErr.message);
    throw dbErr;
  }

  // ON CONFLICT DO NOTHING returns null — means email or phone already exists
  if (!user) {
    res.status(409).json({ success: false, message: 'Email or phone number already registered' });
    return;
  }

  const token = signToken({ userId: user.id as string, email: user.email as string, role: user.role as any });

  res.status(201).json({
    success: true,
    message: 'Account registered successfully',
    data: { user, token },
  });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    res.status(400).json({ success: false, message: 'Phone number and password are required' });
    return;
  }

  // Normalize phone — strip spaces, convert leading 0 → +251
  let cleanPhone = String(phone).replace(/\s+/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '+251' + cleanPhone.slice(1);
  }
  if (!/^\+251[79]\d{8}$/.test(cleanPhone)) {
    res.status(400).json({ success: false, message: 'Enter a valid Ethiopian phone number (+251 9X or +251 7X)' });
    return;
  }

  const localPhone = cleanPhone.replace(/^\+251/, '0');
  const internationalWithoutPlus = cleanPhone.replace(/^\+/, '');
  const user = await queryOne(
    `SELECT id, name, email, phone, password_hash, photo_url, role, status, wallet_balance, credits, joined_at
     FROM users WHERE phone IN ($1, $2, $3) LIMIT 1`,
    [cleanPhone, localPhone, internationalWithoutPlus]
  );

  if (!user) {
    res.status(401).json({ success: false, message: 'Invalid phone number or password' });
    return;
  }

  if (user.status === 'suspended') {
    res.status(403).json({ success: false, message: 'Your account has been suspended. Contact support.' });
    return;
  }

  const valid = await bcrypt.compare(String(password), user.password_hash as string);
  if (!valid) {
    res.status(401).json({ success: false, message: 'Invalid phone number or password' });
    return;
  }

  const token = signToken({ userId: user.id as string, email: user.email as string, role: user.role as any });

  const { password_hash: _pw, ...safeUser } = user;

  res.json({
    success: true,
    message: 'Login successful',
    data: { user: safeUser, token },
  });
}));

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
