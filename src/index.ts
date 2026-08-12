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

import { warmPool } from './db/client';

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
  'http://localhost:5173',
  'http://localhost:5174',
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
});

export default app;
