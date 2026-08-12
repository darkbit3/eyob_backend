import { Router, Request, Response } from 'express';
import { query } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/notifications/my — customer: get own notifications
router.get('/my', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100); // Max 100
  const rows = await query(
    'SELECT id, type, title, message, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  
  // Add cache headers: revalidate after 10 seconds
  res.set('Cache-Control', 'private, max-age=10');
  res.json({ success: true, data: rows });
}));

// PATCH /api/notifications/:id/read — mark as read
router.patch('/:id/read', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  await query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
  res.json({ success: true, message: 'Notification marked as read' });
}));

// PATCH /api/notifications/read-all — mark all as read for current user
router.patch('/read-all', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user.userId;
  await query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [userId]);
  res.json({ success: true, message: 'All notifications marked as read' });
}));

// GET /api/notifications/announcements — get all announcements (public)
router.get('/announcements', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query('SELECT * FROM announcements ORDER BY created_at DESC');
  res.json({ success: true, data: rows });
}));

// POST /api/notifications/announcements — admin: send announcement
router.post('/announcements', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { title, message, audience, type } = req.body;

  if (!title || !message || !audience || !type) {
    res.status(400).json({ success: false, message: 'title, message, audience, type are required' });
    return;
  }

  const sentBy = (req as any).user.email;

  // Count targeted users
  let userCount;
  if (audience === 'All Users') {
    userCount = await query('SELECT COUNT(*) AS cnt FROM users');
  } else if (audience === 'Customers Only') {
    userCount = await query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'customer'");
  } else if (audience === 'Admins Only') {
    userCount = await query("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'");
  } else {
    userCount = await query(
      "SELECT COUNT(DISTINCT bidder_id) AS cnt FROM bids b JOIN auctions a ON a.id = b.auction_id WHERE a.status = 'active'"
    );
  }

  const deliveredCount = Number(userCount[0]?.cnt || 0);

  const rows = await query(
    `INSERT INTO announcements (title, message, audience, type, sent_by, delivered_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [title, message, audience, type, sentBy, deliveredCount]
  );

  // Push notifications to targeted users
  let targetUsers;
  if (audience === 'All Users') {
    targetUsers = await query("SELECT id FROM users WHERE status = 'active'");
  } else if (audience === 'Customers Only') {
    targetUsers = await query("SELECT id FROM users WHERE role = 'customer' AND status = 'active'");
  } else if (audience === 'Admins Only') {
    targetUsers = await query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  } else {
    targetUsers = await query(
      "SELECT DISTINCT bidder_id AS id FROM bids b JOIN auctions a ON a.id = b.auction_id WHERE a.status = 'active'"
    );
  }

  for (const u of targetUsers) {
    await query(
      'INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)',
      [u.id as string, 'system', title, message]
    );
  }

  // Audit
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Sent Announcement', $3, $4, $5)`,
    [(req as any).user.userId, sentBy, audience, `Title: "${title}" (${type})`, req.ip || '0.0.0.0']
  );

  res.status(201).json({ success: true, message: `Announcement dispatched to ${deliveredCount} users`, data: rows[0] });
}));

export default router;
