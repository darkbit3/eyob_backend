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
  console.log(`  🌐  CORS:    ${Array.from(allowedOriginsSet).join(' + ')}`);
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
});

export default app;
