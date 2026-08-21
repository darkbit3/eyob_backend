import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

const selectAds = `
  SELECT id, title, subtitle, image_url, target_url, cta_label, status, sort_order, created_at, updated_at
  FROM advertisements
`;

// Public feed: only ads scheduled to be visible are returned.
router.get('/active', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `${selectAds} WHERE status = 'active' ORDER BY sort_order ASC, created_at DESC`
  );
  res.json({ success: true, data: rows });
}));

router.get('/', authenticate, requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(`${selectAds} ORDER BY sort_order ASC, created_at DESC`);
  res.json({ success: true, data: rows });
}));

router.post('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { title, subtitle, image_url, target_url, cta_label, status = 'active', sort_order = 0 } = req.body;
  if (!title?.trim() || !image_url?.trim()) {
    res.status(400).json({ success: false, message: 'Title and image URL are required' });
    return;
  }
  if (!['active', 'paused'].includes(status)) {
    res.status(400).json({ success: false, message: 'Status must be active or paused' });
    return;
  }

  const row = await queryOne(
    `INSERT INTO advertisements (title, subtitle, image_url, target_url, cta_label, status, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [title.trim(), subtitle?.trim() || '', image_url.trim(), target_url?.trim() || '', cta_label?.trim() || 'Explore', status, Number(sort_order) || 0]
  );
  res.status(201).json({ success: true, data: row });
}));

router.patch('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { title, subtitle, image_url, target_url, cta_label, status, sort_order } = req.body;
  if (status !== undefined && !['active', 'paused'].includes(status)) {
    res.status(400).json({ success: false, message: 'Status must be active or paused' });
    return;
  }
  const row = await queryOne(
    `UPDATE advertisements SET
       title = COALESCE($1, title), subtitle = COALESCE($2, subtitle),
       image_url = COALESCE($3, image_url), target_url = COALESCE($4, target_url),
       cta_label = COALESCE($5, cta_label), status = COALESCE($6, status),
       sort_order = COALESCE($7, sort_order), updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [title?.trim() || null, subtitle?.trim() || null, image_url?.trim() || null,
      target_url?.trim() || null, cta_label?.trim() || null, status || null,
      sort_order === undefined ? null : Number(sort_order) || 0, req.params.id]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Advertisement not found' }); return; }
  res.json({ success: true, data: row });
}));

router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne('DELETE FROM advertisements WHERE id = $1 RETURNING id', [req.params.id]);
  if (!row) { res.status(404).json({ success: false, message: 'Advertisement not found' }); return; }
  res.json({ success: true });
}));

export default router;
