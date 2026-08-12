import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/user/profile — fetch logged-in user profile
router.get('/profile', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const user = await queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.photo_url, u.role, u.status,
            u.wallet_balance, u.credits, u.joined_at,
            COALESCE(json_agg(uwa.auction_id) FILTER (WHERE uwa.auction_id IS NOT NULL), '[]') AS won_auctions
     FROM users u
     LEFT JOIN user_won_auctions uwa ON uwa.user_id = u.id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId]
  );

  if (!user) {
    res.status(404).json({ success: false, message: 'User profile not found' });
    return;
  }

  res.json({ success: true, data: user });
}));

// GET /api/user/wins — real query joining winners / auctions table for logged-in user
router.get('/wins', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const wins = await query(
    `SELECT a.id AS auction_id, a.title, a.image_url, a.retail_value, a.category,
            a.lowest_unique_bid AS winning_bid, a.closed_at AS date,
            p.name AS product_name, p.description AS product_description,
            'Claimed' AS claim_status
     FROM auctions a
     LEFT JOIN products p ON p.id = a.product_id
     WHERE a.winner_id = $1 AND a.status = 'closed'
     ORDER BY a.closed_at DESC`,
    [userId]
  );

  res.json({ success: true, data: wins });
}));

// GET /api/user/bids — real query on bids/bid_history filtered by user id
router.get('/bids', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const bids = await query(
    `SELECT b.id, b.auction_id, b.masked_bidder_id, b.amount, b.is_duplicate, b.is_lowest_unique,
            b.created_at AS timestamp,
            a.title AS auction_title, a.status AS auction_status, a.image_url,
            CASE
              WHEN a.status = 'closed' AND b.is_lowest_unique = TRUE THEN 'Won'
              WHEN a.status = 'closed' THEN 'Lost'
              ELSE 'Pending'
            END AS result
     FROM bids b
     JOIN auctions a ON a.id = b.auction_id
     WHERE b.bidder_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );

  res.json({ success: true, data: bids });
}));

// GET /api/user/notifications — notifications for logged in user
router.get('/notifications', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const notifications = await query(
    `SELECT id, user_id, type, title, message, is_read AS read, created_at AS timestamp
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );

  res.json({ success: true, data: notifications });
}));

export default router;
