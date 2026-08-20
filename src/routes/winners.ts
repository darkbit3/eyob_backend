import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/winners — admin: all closed auctions with winner info
router.get('/', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT a.id, a.title, a.image_url, a.retail_value, a.category,
            a.winner_id, a.winner_name, a.lowest_unique_bid,
            a.total_bids, a.total_participants, a.closed_at, a.end_time,
            u.email AS winner_email, u.phone AS winner_phone, u.photo_url AS winner_photo
     FROM auctions a
     LEFT JOIN users u ON u.id = a.winner_id
     WHERE a.status = 'closed'
     ORDER BY a.closed_at DESC`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/winners/:auctionId/bids — bid transparency log for a closed auction
router.get('/:auctionId/bids', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const user = (req as any).user;
  const isAdmin = user.role === 'admin';

  const auction = await queryOne(
    'SELECT id, title, status FROM auctions WHERE id = $1',
    [req.params.auctionId]
  );
  if (!auction) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }

  const rows = await query(
    `SELECT b.id, b.masked_bidder_id,
            ${isAdmin ? 'b.bidder_id,' : ''}
            b.amount, b.is_duplicate, b.is_lowest_unique, b.created_at
     FROM bids b
     WHERE b.auction_id = $1
     ORDER BY b.amount ASC, b.created_at ASC`,
    [req.params.auctionId]
  );

  res.json({ success: true, data: rows, auction });
}));

// GET /api/winners/report/stats — dashboard stats
router.get('/report/stats', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { date_from, date_to } = req.query as Record<string, string>;
  const conditions = ["status = 'closed'"];
  const params: string[] = [];
  if (date_from) { params.push(date_from); conditions.push(`closed_at >= $${params.length}::date`); }
  if (date_to) { params.push(date_to); conditions.push(`closed_at < ($${params.length}::date + interval '1 day')`); }
  const where = conditions.join(' AND ');
  const totalClosed = await queryOne(`SELECT COUNT(*) AS cnt FROM auctions WHERE ${where}`, params);
  const withWinner  = await queryOne(`SELECT COUNT(*) AS cnt FROM auctions WHERE ${where} AND winner_id IS NOT NULL`, params);
  const avgBid      = await queryOne(`SELECT AVG(lowest_unique_bid) AS avg FROM auctions WHERE ${where} AND lowest_unique_bid IS NOT NULL`, params);
  const totalBids   = await queryOne(`SELECT SUM(total_bids) AS total FROM auctions WHERE ${where}`, params);

  res.json({
    success: true,
    data: {
      total_closed_auctions: Number(totalClosed?.cnt || 0),
      auctions_with_winner:  Number(withWinner?.cnt || 0),
      avg_winning_bid:       Number(avgBid?.avg || 0).toFixed(2),
      total_bids_cast:       Number(totalBids?.total || 0),
    },
  });
}));

export default router;
