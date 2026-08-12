import { Router, Request, Response } from 'express';
import { query, queryOne } from '../db/client';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/products — public: list all products
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT p.*,
            a.id     AS linked_auction_id,
            a.status AS linked_auction_status
     FROM products p
     LEFT JOIN auctions a ON a.product_id = p.id
     ORDER BY p.created_at DESC`
  );
  res.json({ success: true, data: rows });
}));

// GET /api/products/:id
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne(
    `SELECT p.*,
            a.id     AS linked_auction_id,
            a.status AS linked_auction_status
     FROM products p
     LEFT JOIN auctions a ON a.product_id = p.id
     WHERE p.id = $1`,
    [req.params.id]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Product not found' }); return; }
  res.json({ success: true, data: row });
}));

// POST /api/products — admin: create product
router.post('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { name, category, image_url, images, retail_value, description } = req.body;

  if (!name || !category || (!image_url && (!images || !Array.isArray(images) || images.length === 0)) || !retail_value) {
    res.status(400).json({ success: false, message: 'name, category, images (or image_url), retail_value are required' });
    return;
  }

  // prefer `images` array; fallback to single `image_url`
  const imgs = Array.isArray(images) && images.length ? images : [image_url];

  const row = await queryOne(
    `INSERT INTO products (name, category, image_url, images, retail_value, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, category, imgs[0], JSON.stringify(imgs), Number(retail_value), description || '']
  );

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Created Product', $3, $4, $5)`,
    [adminId, (req as any).user.email, name, `Retail value: ${retail_value} ETB`, req.ip || '0.0.0.0']
  );

  res.status(201).json({ success: true, message: 'Product created', data: row });
}));

// PATCH /api/products/:id — admin: update product
router.patch('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { name, category, image_url, images, retail_value, description } = req.body;

  // If images provided as array, convert to JSON
  const imagesJson = Array.isArray(images) ? JSON.stringify(images) : null;

  const row = await queryOne(
    `UPDATE products SET
       name         = COALESCE($1, name),
       category     = COALESCE($2, category),
       image_url    = COALESCE($3, image_url),
       images       = COALESCE($4, images),
       retail_value = COALESCE($5, retail_value),
       description  = COALESCE($6, description),
       updated_at   = NOW()
     WHERE id = $7
     RETURNING *`,
    [
      name || null,
      category || null,
      image_url || (images && images.length ? images[0] : null),
      imagesJson ? imagesJson : null,
      retail_value ? Number(retail_value) : null,
      description || null,
      req.params.id
    ]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Product not found' }); return; }

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Updated Product', $3, $4, $5)`,
    [adminId, (req as any).user.email, row.name as string, `Fields updated: ${Object.keys(req.body).join(', ')}`, req.ip || '0.0.0.0']
  );

  res.json({ success: true, message: 'Product updated', data: row });
}));

// DELETE /api/products/:id — admin: delete product
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne(
    `DELETE FROM products WHERE id = $1 RETURNING id, name`,
    [req.params.id]
  );
  if (!row) { res.status(404).json({ success: false, message: 'Product not found' }); return; }

  const adminId = (req as any).user.userId;
  await query(
    `INSERT INTO audit_logs (admin_id, admin_name, action, target, details, ip_address)
     VALUES ($1, $2, 'Deleted Product', $3, 'Product deleted from inventory catalog.', $4)`,
    [adminId, (req as any).user.email, row.name as string, req.ip || '0.0.0.0']
  );

  res.json({ success: true, message: 'Product deleted', data: row });
}));

export default router;
