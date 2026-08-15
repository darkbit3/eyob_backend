import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

// Route imports
import authRoutes         from './routes/auth';
import userRoutes         from './routes/users';
import userContractRoutes from './routes/userContract';
import auctionRoutes      from './routes/auctions';
import productRoutes      from './routes/products';
import bidRoutes          from './routes/bids';
import walletRoutes       from './routes/wallet';
import notificationRoutes from './routes/notifications';
import auditLogRoutes     from './routes/auditLogs';
import settingsRoutes     from './routes/settings';
import winnersRoutes      from './routes/winners';
import reportsRoutes      from './routes/reports';
import chapaRoutes        from './routes/chapa';

import { warmPool } from './db/client';
import { query as dbQuery } from './db/client';

// Middleware imports
import { errorHandler, notFound } from './middleware/errorHandler';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ── Security & Logging ──────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── CORS — allow both frontend (5173) and admin (5174) ─────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'https://eyob-z2xx.onrender.com',
  process.env.ADMIN_URL ?? 'https://eyob-admin.onrender.com',
  process.env.BACKEND_URL ?? 'https://eyob-backend.onrender.com',
  'https://eyob-z2xx.onrender.com',
  'https://eyob-admin.onrender.com',
];

// CORS: reflect allowed origins and handle preflight explicitly.
const corsOptionsDelegate = (origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => {
  // Log origin for debugging deploy-time CORS issues
  console.log('CORS origin:', origin);
  if (!origin) {
    // No origin (e.g., curl, same-origin) — allow
    return callback(null, true);
  }
  if (allowedOrigins.includes(origin)) {
    // Reflect the origin
    return callback(null, origin);
  }
  // Not allowed
  console.warn(`CORS blocked origin: ${origin}`);
  return callback(null, false);
};

app.use(cors({ origin: corsOptionsDelegate, credentials: true }));

// Ensure OPTIONS preflight requests receive CORS headers
app.options('*', cors({ origin: corsOptionsDelegate, credentials: true }));

// Fallback: explicitly set CORS headers on all responses and handle preflight
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );

  if (req.method === 'OPTIONS') {
    // short-circuit preflight
    res.sendStatus(204);
    return;
  }
  next();
});

// ── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'BidLow Backend API',
    version: '1.0.0',
    status: 'Running',
    timestamp: new Date().toISOString(),
    database: 'PostgreSQL',
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── Root Info ────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    service: 'BidLow Backend API',
    message: 'Welcome to the BidLow Backend. See /health and /api/* for endpoints.',
    health: '/health',
    api: '/api',
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/user',          userContractRoutes);
app.use('/api/auctions',      auctionRoutes);
app.use('/api/products',      productRoutes);
app.use('/api/bids',          bidRoutes);
app.use('/api/wallet',        walletRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit',         auditLogRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/winners',       winnersRoutes);
app.use('/api/reports',       reportsRoutes);
app.use('/api/wallet/chapa',  chapaRoutes);

// ── 404 & Error Handlers ──────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('\n ╔════════════════════════════════════════════╗');
  console.log(' ║  BidLow Backend API — Server Started       ║');
  console.log(' ╚════════════════════════════════════════════╝');
  console.log(`\n  🚀  http://localhost:${PORT}`);
  console.log(`  💚  Health:  http://localhost:${PORT}/health`);
  console.log(`  📦  Env:     ${process.env.NODE_ENV || 'development'}`);
  console.log(`  🗄️   Database: Neon PostgreSQL`);
  console.log(`  🌐  CORS:    ${allowedOrigins.join(' + ')}`);
  console.log(`\n  API Endpoints:`);
  console.log(`    POST  /api/auth/register`);
  console.log(`    POST  /api/auth/login`);
  console.log(`    GET   /api/auctions`);
  console.log(`    POST  /api/bids`);
  console.log(`    GET   /api/wallet/queue`);
  console.log(`    GET   /api/reports/dashboard`);
  console.log(`    GET   /api/audit\n`);

  // Warm the DB pool so the first request is instant
  await warmPool();

  // ── Auto-migrate: add any missing columns safely on every boot ──────────
  try {
    await dbQuery(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await dbQuery(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS bid_per_cost NUMERIC(10,2) NOT NULL DEFAULT 100`);
    await dbQuery(`UPDATE auctions SET bid_per_cost = 100 WHERE bid_per_cost IS NULL`);
    await dbQuery(`ALTER TABLE users    ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0`);
    // Drop old transactions type constraint completely so all transaction types are allowed
    await dbQuery(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check`);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS auction_unlocks (
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        auction_id  UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
        amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, auction_id)
      )
    `);
    // Drop payment_method check constraint completely so all payment methods (CBE, CBE Birr, Telebirr, Abyssinia, etc.) are allowed
    await dbQuery(`ALTER TABLE payment_queue DROP CONSTRAINT IF EXISTS payment_queue_payment_method_check`);
    await dbQuery(`ALTER TABLE payment_queue ALTER COLUMN payment_method TYPE VARCHAR(120)`);

    // Create admin_bank_accounts table for managing official deposit accounts
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS admin_bank_accounts (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        method_name    VARCHAR(120) NOT NULL,
        account_number VARCHAR(100) NOT NULL,
        account_holder VARCHAR(150) NOT NULL,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const countRes = await dbQuery(`SELECT COUNT(*) AS cnt FROM admin_bank_accounts`);
    if (Number((countRes as any)[0]?.cnt || 0) === 0) {
      await dbQuery(`
        INSERT INTO admin_bank_accounts (method_name, account_number, account_holder) VALUES
        ('Commercial Bank of Ethiopia (CBE)', '1000 4829 10482', 'BidLow Auctions PLC (Admin Official)'),
        ('CBE Birr', '1000 4829 10482', 'BidLow Auctions PLC (Admin Official)'),
        ('Telebirr Transfer', '0911 002 233', 'BidLow Telebirr Merchant (Admin Official)'),
        ('Bank of Abyssinia (Abyssinia)', '8492 1048 2011', 'BidLow Auctions PLC (Admin Official)'),
        ('Dashen Bank / Amole', '0132 9845 2011', 'BidLow Auctions PLC (Admin Official)')
      `);
    }
    console.log('  ✓ Auto-migration: columns and tables verified');
  } catch (e: any) {
    console.warn('  ⚠ Auto-migration warning:', e.message);
  }
});

export default app;
