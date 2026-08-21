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
import uploadRoutes       from './routes/upload';
import advertisementRoutes from './routes/advertisements';

import { warmPool } from './db/client';
import { query as dbQuery } from './db/client';

// Middleware imports
import { errorHandler, notFound } from './middleware/errorHandler';

import http from 'http';
import { setupWebSocket } from './ws/server';

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

// ── Security & Logging ──────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── CORS — explicit allowlist only, no platform-wide wildcards ─────────────
// Set FRONTEND_URL / ADMIN_URL / BACKEND_URL in your .env to extend.
const allowedOriginsSet = new Set<string>(
  ([
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    process.env.BACKEND_URL,
    'https://eyob-z2xx.onrender.com',
    'https://eyob-admin.onrender.com',
    'https://eyob-admin.vercel.app',
    'https://eyob-topaz.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ].filter(Boolean) as string[]).map(u => u.replace(/\/$/, ''))
);

const isAllowedOrigin = (origin?: string): boolean => {
  if (!origin) return false; // block no-Origin requests (server-to-server) by default
  return allowedOriginsSet.has(origin.replace(/\/$/, ''));
};

const corsOptionsDelegate = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean | string) => void
) => {
  if (!origin || isAllowedOrigin(origin)) {
    return callback(null, origin || true);
  }
  console.warn(`[CORS] Blocked origin: ${origin}`);
  return callback(null, false);
};

app.use(cors({ origin: corsOptionsDelegate, credentials: true }));
// Handle OPTIONS preflight with the same strict policy
app.options('*', cors({ origin: corsOptionsDelegate, credentials: true }));

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
app.use('/api/upload',        uploadRoutes);
app.use('/api/advertisements', advertisementRoutes);

// ── 404 & Error Handlers ──────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────────────────────────
setupWebSocket(server);

server.listen(PORT, async () => {
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

  // ── Auto-close expired auctions every 60 seconds ─────────────────────────
  async function autoCloseExpiredAuctions() {
    try {
      const expired = await dbQuery<{ id: string; title: string }>(
        `UPDATE auctions
         SET status = 'closed', closed_at = NOW(), updated_at = NOW()
         WHERE status = 'active' AND end_time < NOW()
         RETURNING id, title`
      );
      if (expired.length > 0) {
        console.log(`  ⏱  Auto-closed ${expired.length} expired auction(s):`, expired.map((a: any) => a.title).join(', '));
      }
    } catch (e: any) {
      console.warn('  ⚠ Auto-close job error:', e.message);
    }
  }
  // Run once on startup, then every 60 seconds
  await autoCloseExpiredAuctions();
  setInterval(autoCloseExpiredAuctions, 60_000);

  // Warm the DB pool so the first request is instant
  await warmPool();

  // ── Auto-migrate: add any missing columns safely on every boot ──────────
  try {
    await dbQuery(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await dbQuery(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS bid_per_cost NUMERIC(10,2) NOT NULL DEFAULT 100`);
    await dbQuery(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS max_bids_per_user INTEGER NOT NULL DEFAULT 0`);
    await dbQuery(`UPDATE auctions SET bid_per_cost = 100 WHERE bid_per_cost IS NULL`);
    await dbQuery(`ALTER TABLE users    ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0`);
    await dbQuery(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB`);
    await dbQuery(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS max_bids_per_user INTEGER NOT NULL DEFAULT 0`);
    // Drop role check constraint to allow custom roles
    await dbQuery(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    // Drop old transactions type constraint completely so all transaction types are allowed
    await dbQuery(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check`);
    // Add auction_id to transactions for per-auction profit tracking
    await dbQuery(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS auction_id UUID`);
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
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS payment_gateways (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(80) NOT NULL UNIQUE,
        display_name VARCHAR(120) NOT NULL, public_key TEXT NOT NULL DEFAULT '',
        secret_key TEXT NOT NULL DEFAULT '', is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS advertisements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title VARCHAR(160) NOT NULL,
        subtitle VARCHAR(255) NOT NULL DEFAULT '', image_url TEXT NOT NULL,
        target_url TEXT NOT NULL DEFAULT '', cta_label VARCHAR(60) NOT NULL DEFAULT 'Explore',
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
        sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await dbQuery(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role        VARCHAR(80) PRIMARY KEY,
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await dbQuery(`
      INSERT INTO role_permissions (role, permissions)
      VALUES ('customer_support', '{"Dashboard": true, "Auctions": true}'::jsonb)
      ON CONFLICT (role) DO NOTHING
    `);

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
