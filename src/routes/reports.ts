import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/reports/revenue — monthly revenue summary
router.get('/revenue', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT
       TO_CHAR(created_at, 'Mon YYYY') AS month,
       SUM(CASE WHEN type = 'credit_purchase' THEN amount ELSE 0 END) AS revenue,
       SUM(CASE WHEN type = 'credit_purchase' THEN amount ELSE 0 END) AS deposits,
       SUM(CASE WHEN type = 'refund'          THEN amount ELSE 0 END) AS refunds
     FROM transactions
     WHERE created_at >= NOW() - INTERVAL '12 months'
     GROUP BY TO_CHAR(created_at, 'Mon YYYY'), DATE_TRUNC('month', created_at)
     ORDER BY DATE_TRUNC('month', created_at) ASC`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/reports/users — monthly user growth
router.get('/users', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT
       TO_CHAR(joined_at, 'Mon YYYY') AS month,
       COUNT(*) AS new_users
     FROM users
     WHERE joined_at >= NOW() - INTERVAL '12 months'
     GROUP BY TO_CHAR(joined_at, 'Mon YYYY'), DATE_TRUNC('month', joined_at)
     ORDER BY DATE_TRUNC('month', joined_at) ASC`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/reports/categories — auction performance by category
router.get('/categories', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT
       category,
       COUNT(*) AS auctions,
       SUM(total_bids) AS total_bids,
       SUM(retail_value) AS total_retail_value
     FROM auctions
     GROUP BY category
     ORDER BY total_bids DESC`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/reports/payments — payment method breakdown
router.get('/payments', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT
       payment_method,
       COUNT(*) AS transaction_count,
       SUM(amount) AS total_amount
     FROM transactions
     WHERE payment_method IS NOT NULL
     GROUP BY payment_method
     ORDER BY total_amount DESC`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/reports/dashboard — top-level KPI summary
router.get('/dashboard', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const [users, auctions, revenue, pending] = await Promise.all([
    queryOne("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active_users FROM users"),
    queryOne("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active_auctions FROM auctions"),
    queryOne("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE type = 'credit_purchase' AND status = 'completed'"),
    queryOne("SELECT COUNT(*) AS cnt FROM payment_queue WHERE status = 'pending'"),
  ]);

  res.json({
    success: true,
    data: {
      total_users:        Number(users?.total || 0),
      active_users:       Number(users?.active_users || 0),
      total_auctions:     Number(auctions?.total || 0),
      active_auctions:    Number(auctions?.active_auctions || 0),
      total_revenue_etb:  Number(revenue?.total || 0),
      pending_payments:   Number(pending?.cnt || 0),
    },
  });
}));

export default router;
