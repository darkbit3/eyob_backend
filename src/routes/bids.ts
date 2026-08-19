import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

interface BidRow {
  id: string;
  bidder_id: string;
  amount: number | string;
}

/**
 * Core engine: compute the lowest unique bid for an auction.
 * A bid is "unique" if NO OTHER bid in the same auction has the same amount.
 * The winner is the bidder with the LOWEST such unique amount.
 */
async function computeLowestUniqueBid(auctionId: string) {
  // Get all bids for this auction
  const bids = await query<BidRow>(
    'SELECT id, bidder_id, amount FROM bids WHERE auction_id = $1',
    [auctionId]
  );

  // Count how many times each amount appears
  const countMap = new Map<number, number>();
  for (const b of bids) {
    const amt = Number(b.amount);
    countMap.set(amt, (countMap.get(amt) || 0) + 1);
  }

  // Find lowest unique
  let lowestUniqueAmt: number | null = null;
  let winnerId: string | null = null;

  const uniqueBids = bids.filter((b: BidRow) => countMap.get(Number(b.amount)) === 1);
  if (uniqueBids.length > 0) {
    uniqueBids.sort((a: BidRow, b: BidRow) => Number(a.amount) - Number(b.amount));
    lowestUniqueAmt = Number(uniqueBids[0].amount);
    winnerId = uniqueBids[0].bidder_id;
  }

  // Mark is_duplicate and is_lowest_unique on each bid
  for (const b of bids) {
    const isDup = (countMap.get(Number(b.amount)) || 0) > 1;
    const isWinner = b.id === (uniqueBids[0]?.id ?? null);
    await query(
      'UPDATE bids SET is_duplicate = $1, is_lowest_unique = $2 WHERE id = $3',
      [isDup, isWinner, b.id]
    );
  }

  return { lowestUniqueAmt, winnerId };
}

// GET /api/bids/auction/:auctionId — get bid log for an auction
router.get('/auction/:auctionId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const rows = await query(
    `SELECT b.id, b.auction_id, b.bidder_id, b.masked_bidder_id,
            b.amount, b.is_duplicate, b.is_lowest_unique, b.created_at,
            u.name AS bidder_name, u.phone AS bidder_phone, u.photo_url AS bidder_photo
     FROM bids b
     LEFT JOIN users u ON u.id = b.bidder_id
     WHERE b.auction_id = $1
     ORDER BY b.amount ASC, b.created_at ASC`,
    [req.params.auctionId]
  );

  res.json({ success: true, data: rows });
}));

// GET /api/bids — admin: list all bids for oversight
router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {

  const user = (req as any).user;
  const isAdmin = user.role === 'admin';

  if (!isAdmin) {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }

  const rows = await query(
    `SELECT b.id, b.auction_id, b.bidder_id, b.masked_bidder_id, b.amount,
            b.is_duplicate, b.is_lowest_unique, b.created_at
     FROM bids b
     ORDER BY b.created_at DESC`
  );

  res.json({ success: true, data: rows });
}));

// GET /api/bids/my — customer: get own bids
router.get('/my', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;

  const rows = await query(
    `SELECT b.id, b.auction_id, b.bidder_id, b.masked_bidder_id, b.amount,
            b.is_duplicate, b.is_lowest_unique, b.created_at,
            a.title AS auction_title, a.status AS auction_status, a.image_url
     FROM bids b
     JOIN auctions a ON a.id = b.auction_id
     WHERE b.bidder_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );

  res.json({ success: true, data: rows });
}));

// POST /api/bids — customer: place a bid
router.post('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const { auction_id, amount } = req.body;

  if (!auction_id || amount === undefined) {
    res.status(400).json({ success: false, message: 'auction_id and amount are required' });
    return;
  }

  const amountNum = Number(amount);

  // Fetch the auction — include bid_per_cost
  const auction = await queryOne(
    'SELECT id, status, min_bid, max_bid, title, bid_per_cost, max_bids_per_user FROM auctions WHERE id = $1',
    [auction_id]
  );
  if (!auction) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }
  if (auction.status !== 'active') {
    res.status(400).json({ success: false, message: 'Auction is not currently active' });
    return;
  }
  if (amountNum < Number(auction.min_bid) || amountNum > Number(auction.max_bid)) {
    res.status(400).json({
      success: false,
      message: `Bid amount must be between ${auction.min_bid} and ${auction.max_bid} ETB`,
    });
    return;
  }

  // Fetch user and ensure wallet balance can cover the bid amount
  const user = await queryOne('SELECT id, wallet_balance, name FROM users WHERE id = $1', [userId]);
  if (!user) {
    res.status(404).json({ success: false, message: 'User not found' });
    return;
  }

  const walletBalance = Number(user.wallet_balance || 0);
  if (walletBalance < amountNum) {
    res.status(400).json({
      success: false,
      message: `Insufficient wallet balance. You need ${amountNum} ETB to place this bid.`,
    });
    return;
  }

  // Enforce max bids per user per auction from system_settings
  const settingsRow = await queryOne('SELECT max_bids_per_user FROM system_settings LIMIT 1');
  const auctionLimit = Number(auction.max_bids_per_user ?? 0);
  const globalLimit = Number(settingsRow?.max_bids_per_user ?? 0);
  const maxBidsPerUser = auctionLimit > 0 ? auctionLimit : globalLimit;
  if (maxBidsPerUser > 0) {
    const userBidCount = await queryOne(
      'SELECT COUNT(*)::int AS cnt FROM bids WHERE auction_id = $1 AND bidder_id = $2',
      [auction_id, userId]
    );
    if (Number(userBidCount?.cnt ?? 0) >= maxBidsPerUser) {
      res.status(400).json({
        success: false,
        message: `You have reached the maximum of ${maxBidsPerUser} bid(s) allowed per user on this auction.`,
      });
      return;
    }
  }

  // Generate masked ID
  const maskedId = `BDR-${Math.floor(1000 + Math.random() * 9000)}`;

  // Insert bid
  const bidRow = await queryOne(
    `INSERT INTO bids (auction_id, bidder_id, masked_bidder_id, amount)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [auction_id, userId, maskedId, amountNum]
  );

  // Deduct exact bid amount from user wallet
  await query(
    'UPDATE users SET wallet_balance = GREATEST(0, wallet_balance - $1), updated_at = NOW() WHERE id = $2',
    [amountNum, userId]
  );

  // Log user transaction — debit of exact bid amount
  await query(
    `INSERT INTO transactions (user_id, user_name, type, amount, description, status)
     VALUES ($1, $2, 'bid_placed', $3, $4, 'completed')`,
    [
      userId,
      user.name as string,
      -amountNum,
      `Bid placed on "${auction.title}" — ${amountNum} ETB`
    ]
  );

  // Add exact bid amount revenue to admin wallet (first admin found)
  const admin = await queryOne(
    `SELECT id, name FROM users WHERE role = 'admin' ORDER BY joined_at ASC LIMIT 1`
  );
  if (admin) {
    await query(
      'UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = NOW() WHERE id = $2',
      [amountNum, admin.id as string]
    );
    // Log admin revenue transaction
    await query(
      `INSERT INTO transactions (user_id, user_name, type, amount, description, status)
       VALUES ($1, $2, 'credit_purchase', $3, $4, 'completed')`,
      [
        admin.id as string,
        admin.name as string,
        amountNum,
        `Bid revenue from ${user.name as string} on "${auction.title}" — bid: ${amountNum} ETB (+${amountNum} ETB)`,
      ]
    );
  }

  // Update auction totals
  await query(
    `UPDATE auctions SET
       total_bids = total_bids + 1,
       total_participants = (SELECT COUNT(DISTINCT bidder_id) FROM bids WHERE auction_id = $1),
       updated_at = NOW()
     WHERE id = $1`,
    [auction_id]
  );

  // Re-compute winner state
  await computeLowestUniqueBid(auction_id);

  // Push real-time WebSocket balance updates
  try {
    const { sendToUser } = await import('../ws/server');
    const updatedUser = await queryOne('SELECT wallet_balance, credits FROM users WHERE id = $1', [userId]);
    sendToUser(userId, {
      type: 'balance_updated',
      wallet_balance: Number(updatedUser?.wallet_balance || 0),
      credits: Number(updatedUser?.credits || 0),
      amount: -amountNum,
    });
    if (admin) {
      const updatedAdmin = await queryOne('SELECT wallet_balance, credits FROM users WHERE id = $1', [admin.id as string]);
      sendToUser(admin.id as string, {
        type: 'balance_updated',
        wallet_balance: Number(updatedAdmin?.wallet_balance || 0),
        credits: Number(updatedAdmin?.credits || 0),
        amount: amountNum,
      });
    }
  } catch (_e) {}

  res.status(201).json({
    success: true,
    message: `Bid placed successfully! ${amountNum} ETB deducted.`,
    data: { ...bidRow, amount: amountNum },
  });
}));

// PATCH /api/bids/:bidId — customer: edit own bid while auction is active
router.patch('/:bidId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const amountNum = Number(req.body.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ success: false, message: 'A valid bid amount is required' });
    return;
  }

  const bid = await queryOne(
    `SELECT b.id, b.auction_id, b.bidder_id, b.amount, a.status, a.min_bid, a.max_bid, a.title
     FROM bids b JOIN auctions a ON a.id = b.auction_id WHERE b.id = $1`,
    [req.params.bidId]
  );
  if (!bid) { res.status(404).json({ success: false, message: 'Bid not found' }); return; }
  if (bid.bidder_id !== userId) { res.status(403).json({ success: false, message: 'You can only edit your own bid' }); return; }
  if (bid.status !== 'active') { res.status(400).json({ success: false, message: 'Bids can only be edited while the auction is active' }); return; }
  if (amountNum < Number(bid.min_bid) || amountNum > Number(bid.max_bid)) {
    res.status(400).json({ success: false, message: `Bid amount must be between ${bid.min_bid} and ${bid.max_bid} ETB` });
    return;
  }

  const oldAmount = Number(bid.amount);
  const difference = amountNum - oldAmount;
  if (difference > 0) {
    const user = await queryOne('SELECT wallet_balance FROM users WHERE id = $1', [userId]);
    if (Number(user?.wallet_balance ?? 0) < difference) {
      res.status(400).json({ success: false, message: `Insufficient wallet balance. You need ${difference} ETB more to edit this bid.` });
      return;
    }
  }

  const updated = await queryOne(
    'UPDATE bids SET amount = $1, is_duplicate = FALSE, is_lowest_unique = FALSE WHERE id = $2 RETURNING *',
    [amountNum, req.params.bidId]
  );
  await query('UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW() WHERE id = $2', [difference, userId]);
  const admin = await queryOne(`SELECT id FROM users WHERE role = 'admin' ORDER BY joined_at ASC LIMIT 1`);
  if (admin) await query('UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = NOW() WHERE id = $2', [difference, admin.id]);
  await computeLowestUniqueBid(bid.auction_id as string);
  res.json({ success: true, message: 'Bid updated successfully', data: { ...updated, amount: amountNum } });
}));

// DELETE /api/bids/:bidId — customer: cancel own bid while auction is active
router.delete('/:bidId', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const bid = await queryOne(
    `SELECT b.id, b.auction_id, b.bidder_id, b.amount, a.status
     FROM bids b JOIN auctions a ON a.id = b.auction_id WHERE b.id = $1`,
    [req.params.bidId]
  );
  if (!bid) { res.status(404).json({ success: false, message: 'Bid not found' }); return; }
  if (bid.bidder_id !== userId) { res.status(403).json({ success: false, message: 'You can only cancel your own bid' }); return; }
  if (bid.status !== 'active') { res.status(400).json({ success: false, message: 'Bids can only be cancelled while the auction is active' }); return; }

  await query('DELETE FROM bids WHERE id = $1', [req.params.bidId]);
  const amount = Number(bid.amount);
  await query('UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = NOW() WHERE id = $2', [amount, userId]);
  const admin = await queryOne(`SELECT id FROM users WHERE role = 'admin' ORDER BY joined_at ASC LIMIT 1`);
  if (admin) await query('UPDATE users SET wallet_balance = GREATEST(0, wallet_balance - $1), updated_at = NOW() WHERE id = $2', [amount, admin.id]);
  await query(
    `UPDATE auctions SET total_bids = (SELECT COUNT(*) FROM bids WHERE auction_id = $1),
     total_participants = (SELECT COUNT(DISTINCT bidder_id) FROM bids WHERE auction_id = $1), updated_at = NOW() WHERE id = $1`,
    [bid.auction_id]
  );
  await computeLowestUniqueBid(bid.auction_id as string);
  res.json({ success: true, message: 'Bid cancelled and amount refunded' });
}));

// POST /api/bids/auction/:auctionId/finalize — admin: close auction & finalize winner
router.post('/auction/:auctionId/finalize', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { auctionId } = req.params;

  const auction = await queryOne('SELECT * FROM auctions WHERE id = $1', [auctionId]);
  if (!auction) { res.status(404).json({ success: false, message: 'Auction not found' }); return; }

  const { lowestUniqueAmt, winnerId } = await computeLowestUniqueBid(auctionId);

  let winnerName: string | null = null;
  if (winnerId) {
    const winnerUser = await queryOne('SELECT name FROM users WHERE id = $1', [winnerId]);
    winnerName = (winnerUser?.name as string) || null;

    // Record won auction
    await query(
      `INSERT INTO user_won_auctions (user_id, auction_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [winnerId, auctionId]
    );

    // Send winner notification
    await query(
      `INSERT INTO notifications (user_id, type, title, message, metadata)
       VALUES ($1, 'winner_announced', 'You Won an Auction! 🏆', $2, $3)`,
      [
        winnerId,
        `Congratulations! You won "${auction.title as string}" with a lowest unique bid of ${lowestUniqueAmt} ETB.`,
        JSON.stringify({ auction_id: auctionId, auction_title: auction.title, bid_amount: lowestUniqueAmt, retail_value: auction.retail_value }),
      ]
    );
  }

  // Update auction as closed with winner
  await query(
    `UPDATE auctions SET
       status            = 'closed',
       winner_id         = $1,
       winner_name       = $2,
       lowest_unique_bid = $3,
       closed_at         = NOW(),
       updated_at        = NOW()
     WHERE id = $4`,
    [winnerId, winnerName, lowestUniqueAmt, auctionId]
  );

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Finalized Auction Winner', $3, $4, $5)`,
    [
      adminId,
      (req as any).user.email,
      auction.title as string,
      winnerId
        ? `Winner: ${winnerName} (bid: ${lowestUniqueAmt} ETB) — system-verified.`
        : 'No unique bid found. Auction closed with no winner.',
      req.ip || '0.0.0.0'
    ]
  );

  res.json({
    success: true,
    message: winnerId ? `Winner finalized: ${winnerName}` : 'Auction closed — no winner (no unique bids)',
    data: { winnerId, winnerName, lowestUniqueBid: lowestUniqueAmt },
  });
}));

export default router;
