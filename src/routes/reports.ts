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

// GET /api/reports/profit — per-auction profit breakdown + platform summary
// Query params: status, date_from, date_to
router.get('/profit', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { status, date_from, date_to } = req.query as Record<string, string>;

  // Build WHERE conditions
  const conditions: string[] = [];
  const params: any[] = [];

  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`a.created_at <= ($${params.length}::date + interval '1 day')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Per-auction profit query
  const auctionRows = await query(
    `SELECT
       a.id,
       a.title,
       a.category,
       a.status,
       a.image_url                                             AS image,
       COALESCE(a.retail_value, 0)::numeric                    AS retail_value,
       COALESCE(a.bid_per_cost, 100)::numeric                  AS bid_per_cost,
       COUNT(DISTINCT b.id)::int                               AS total_bids,
       COUNT(DISTINCT b.bidder_id)::int                        AS total_participants,
       a.start_time,
       a.end_time,
       a.created_at,
       a.lowest_unique_bid,
       a.winner_id,
       COALESCE(a.winner_name, u.name)                         AS winner_name,
       COALESCE(SUM(b.amount), 0)::numeric                     AS total_bid_amount,
       (COUNT(DISTINCT b.id) * COALESCE(a.bid_per_cost, 100))::numeric AS total_bid_per_cost_revenue,
       ((COUNT(DISTINCT b.id) * COALESCE(a.bid_per_cost, 100)) - COALESCE(a.retail_value, 0))::numeric AS admin_gain
     FROM auctions a
     LEFT JOIN bids  b ON b.auction_id = a.id
     LEFT JOIN users u ON u.id = a.winner_id
     ${whereClause}
     GROUP BY a.id, u.name
     ORDER BY a.created_at DESC`,
    params
  );

  // Platform-wide transaction summary
  const summaryConditions: string[] = [];
  const summaryParams: any[] = [];
  if (date_from) { summaryParams.push(date_from); summaryConditions.push(`created_at >= $${summaryParams.length}`); }
  if (date_to)   { summaryParams.push(date_to);   summaryConditions.push(`created_at <= ($${summaryParams.length}::date + interval '1 day')`); }
  const txWhere = summaryConditions.length > 0 ? `WHERE ${summaryConditions.join(' AND ')}` : '';

  const summaryRow = await queryOne(
    `SELECT
       COALESCE(SUM(CASE WHEN type IN ('credit_purchase','wallet_deposit','manual_adjustment') AND amount > 0 THEN amount ELSE 0 END), 0)::numeric  AS total_deposits,
       COALESCE(SUM(CASE WHEN type = 'manual_adjustment' AND amount < 0 THEN ABS(amount) ELSE 0 END), 0)::numeric                                  AS total_withdrawals,
       COALESCE(SUM(CASE WHEN type = 'bid_placed' THEN ABS(amount) ELSE 0 END), 0)::numeric                                                        AS total_bid_amount
     FROM transactions ${txWhere}`,
    summaryParams
  );

  const totalRetail = auctionRows.reduce((s: number, r: any) => s + Number(r.retail_value || 0), 0);
  const totalBidFeeRevenue = auctionRows.reduce((s: number, r: any) => s + Number(r.total_bid_per_cost_revenue || 0), 0);
  const totalWithdrawals = Number(summaryRow?.total_withdrawals || 0);

  res.json({
    success: true,
    data: {
      auctions: auctionRows,
      summary: {
        auction_count:         auctionRows.length,
        total_retail_value:    totalRetail,
        total_bid_fee_revenue: totalBidFeeRevenue,
        total_bid_amount:      Number(summaryRow?.total_bid_amount || 0),
        total_deposits:        Number(summaryRow?.total_deposits || 0),
        total_withdrawals:     totalWithdrawals,
        net_profit:            totalBidFeeRevenue - totalWithdrawals,
      },
    },
  });
}));

export default router;
