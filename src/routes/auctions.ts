import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/auctions — public: list auctions with optional filters
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { status, category, search } = req.query;

  const rows = await query(
    `SELECT a.id, a.product_id, a.title, a.description, a.image_url,
            a.retail_value,
            COALESCE(a.bid_per_cost, 100)      AS bid_per_cost,
            a.category, a.status,
            a.start_time, a.end_time,
            a.min_bid, a.max_bid,
            a.winner_id, a.winner_name, a.lowest_unique_bid,
            a.closed_at, a.created_at, a.updated_at,
            p.name AS product_name,
            COUNT(DISTINCT b.id)::int          AS total_bids,
            COUNT(DISTINCT b.bidder_id)::int   AS total_participants
     FROM auctions a
     LEFT JOIN products p ON p.id = a.product_id
     LEFT JOIN bids     b ON b.auction_id = a.id
     WHERE
       ($1::text IS NULL OR a.status = $1)
       AND ($2::text IS NULL OR a.category = $2)
       AND ($3::text IS NULL OR a.title ILIKE '%' || $3 || '%')
     GROUP BY a.id, p.name
     ORDER BY a.created_at DESC`,
    [status ? String(status) : null, category ? String(category) : null, search ? String(search) : null]
  );

  res.json({ success: true, data: rows });
}));

// GET /api/auctions/:id — public: get single auction
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne(
    `SELECT a.id, a.product_id, a.title, a.description, a.image_url,
            a.retail_value,
            COALESCE(a.bid_per_cost, 100)      AS bid_per_cost,
            a.category, a.status,
            a.start_time, a.end_time,
            a.min_bid, a.max_bid,
            a.winner_id, a.winner_name, a.lowest_unique_bid,
            a.closed_at, a.created_at, a.updated_at,
            p.name        AS product_name,
            p.description AS product_description,
            COUNT(DISTINCT b.id)::int          AS total_bids,
            COUNT(DISTINCT b.bidder_id)::int   AS total_participants
     FROM auctions a
     LEFT JOIN products p ON p.id = a.product_id
     LEFT JOIN bids     b ON b.auction_id = a.id
     WHERE a.id = $1
     GROUP BY a.id, p.name, p.description`,
    [req.params.id]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }
  res.json({ success: true, data: row });
}));

// POST /api/auctions — admin: create auction
router.post('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const {
    product_id, title, description, image_url, retail_value, bid_per_cost,
    category, status = 'draft', start_time, end_time, min_bid, max_bid,
  } = req.body;

  if (!title || !image_url || !retail_value || !category || !start_time || !end_time) {
    res.status(400).json({ success: false, message: 'Missing required fields: title, image_url, retail_value, category, start_time, end_time' });
    return;
  }

  const row = await queryOne(
    `INSERT INTO auctions
       (product_id, title, description, image_url, retail_value, bid_per_cost, category, status, start_time, end_time, min_bid, max_bid)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      product_id || null, title, description || '', image_url,
      Number(retail_value), Number(bid_per_cost) || 100, category, status,
      start_time, end_time, Number(min_bid) || 1, Number(max_bid) || 500
    ]
  );

  if (status === 'upcoming' || status === 'active') {
    const targetUsers = await query(`SELECT id FROM users WHERE status = 'active'`);
    const notificationTitle = status === 'upcoming'
      ? 'New Upcoming Auction'
      : 'Live Auction Started';
    const notificationMessage = status === 'upcoming'
      ? `A new upcoming auction "${title}" will start on ${new Date(start_time).toLocaleString()}. Stay ready to bid!`
      : `A new auction "${title}" is live now. Place your bids while it remains active.`;

    for (const user of targetUsers) {
      await query(
        'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
        [user.id as string, 'auction_started', notificationTitle, notificationMessage]
      );
    }
  }

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Created Auction', $3, $4, $5)`,
    [
      adminId,
      (req as any).user.email,
      title,
      `Category: ${category}, Retail Value: ${retail_value} ETB, Bid Per Cost: ${bid_per_cost || 100} ETB`,
      req.ip || '0.0.0.0'
    ]
  );

  res.status(201).json({ success: true, message: 'Auction created', data: row });
}));

// PATCH /api/auctions/:id — admin: update auction fields
router.patch('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const {
    title, description, image_url, retail_value, bid_per_cost, category,
    status, start_time, end_time, min_bid, max_bid,
  } = req.body;

  const row = await queryOne(
    `UPDATE auctions SET
       title        = COALESCE($1, title),
       description  = COALESCE($2, description),
       image_url    = COALESCE($3, image_url),
       retail_value = COALESCE($4, retail_value),
       bid_per_cost = COALESCE($5, bid_per_cost),
       category     = COALESCE($6, category),
       status       = COALESCE($7, status),
       start_time   = COALESCE($8, start_time),
       end_time     = COALESCE($9, end_time),
       min_bid      = COALESCE($10, min_bid),
       max_bid      = COALESCE($11, max_bid),
       updated_at   = NOW()
     WHERE id = $12
     RETURNING *`,
    [
      title || null,
      description || null,
      image_url || null,
      retail_value !== undefined && retail_value !== null ? Number(retail_value) : null,
      bid_per_cost !== undefined && bid_per_cost !== null ? Number(bid_per_cost) : null,
      category || null,
      status || null,
      start_time || null,
      end_time || null,
      min_bid !== undefined && min_bid !== null ? Number(min_bid) : null,
      max_bid !== undefined && max_bid !== null ? Number(max_bid) : null,
      req.params.id
    ]
  );

  if (!row) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Edited Auction', $3, $4, $5)`,
    [
      adminId,
      (req as any).user.email,
      row.title as string,
      `Updated fields: ${Object.keys(req.body).join(', ')}`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({ success: true, message: 'Auction updated', data: row });
}));

// PATCH /api/auctions/:id/status — admin: pause / resume / cancel
router.patch('/:id/status', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!['active', 'paused', 'closed', 'upcoming', 'draft'].includes(status)) {
    res.status(400).json({ success: false, message: 'Invalid status value' });
    return;
  }

  const closedAt = status === 'closed' ? new Date().toISOString() : null;

  const row = await queryOne(
    `UPDATE auctions SET
       status    = $1,
       closed_at = COALESCE($2, closed_at),
       updated_at = NOW()
     WHERE id = $3
     RETURNING id, title, status`,
    [status, closedAt, req.params.id]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }

  const actionMap: Record<string, string> = {
    paused: 'Paused Auction', active: 'Resumed Auction', closed: 'Cancelled Auction',
  };
  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      adminId,
      (req as any).user.email,
      actionMap[status] || 'Updated Auction Status',
      row.title as string,
      `Auction status changed to ${status.toUpperCase()}.`,
      req.ip || '0.0.0.0'
    ]
  );

  res.json({ success: true, message: `Auction ${status}`, data: row });
}));

// GET /api/auctions/unlocked/my — customer: list unlocked auction IDs
router.get('/unlocked/my', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const rows = await query(`SELECT auction_id FROM auction_unlocks WHERE user_id = $1`, [userId]);
  const unlockedIds = rows.map((r: any) => r.auction_id);
  res.json({ success: true, data: unlockedIds });
}));

// POST /api/auctions/:id/unlock — customer: pay bid per cost to unlock auction
router.post('/:id/unlock', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const auctionId = req.params.id;

  // Check if auction exists
  const auction = await queryOne(`SELECT id, title, bid_per_cost, retail_value FROM auctions WHERE id = $1`, [auctionId]);
  if (!auction) {
    res.status(404).json({ success: false, message: 'Auction not found' });
    return;
  }

  // Check if already unlocked
  const existing = await queryOne(`SELECT 1 FROM auction_unlocks WHERE user_id = $1 AND auction_id = $2`, [userId, auctionId]);
  if (existing) {
    res.json({ success: true, message: 'Auction is already unlocked', data: { unlocked: true } });
    return;
  }

  const fee = Number(auction.bid_per_cost || 100);

  // Check user wallet balance
  const user = await queryOne(`SELECT id, wallet_balance, name FROM users WHERE id = $1`, [userId]);
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const currentBalance = Number(user.wallet_balance || 0);
  if (currentBalance < fee) {
    res.status(400).json({
      success: false,
      message: `Insufficient balance (${currentBalance} ETB). ${fee} ETB required to unlock this auction.`
    });
    return;
  }

  // Deduct fee & record unlock
  const updatedUser = await queryOne(
    `UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW() WHERE id = $2 RETURNING wallet_balance`,
    [fee, userId]
  );

  await query(
    `INSERT INTO auction_unlocks (user_id, auction_id, amount_paid) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, auctionId, fee]
  );

  // Record transaction
  await query(
    `INSERT INTO transactions (user_id, user_name, type, amount, description, status)
     VALUES ($1, $2, 'bid_fee_paid', -$3, $4, 'completed')`,
    [userId, user.name as string, fee, `Unlock entry fee for auction "${auction.title}"`]
  );

  res.json({
    success: true,
    message: `Auction unlocked successfully! Paid ${fee} ETB.`,
    data: {
      unlocked: true,
      wallet_balance: updatedUser ? Number(updatedUser.wallet_balance) : Math.max(0, currentBalance - fee)
    }
  });
}));

// DELETE /api/auctions/:id — admin: delete auction
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne(
    `DELETE FROM auctions WHERE id = $1 RETURNING id, title`,
    [req.params.id]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }
  res.json({ success: true, message: 'Auction deleted', data: row });
}));

export default router;
