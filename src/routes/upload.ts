import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { authenticate, requireAdmin } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

// Multer: memory storage - stream directly to Cloudinary
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, png, webp, gif).'));
    }
  },
});

const router = Router();

// POST /api/upload - admin only
router.post(
  '/',
  authenticate,
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file provided.' });
      return;
    }

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'bidlow',
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error || !result) return reject(error || new Error('Upload failed'));
          resolve(result as { secure_url: string });
        }
      );
      stream.end(req.file!.buffer);
    });

    res.json({ success: true, data: { url: result.secure_url } });
  })
);

export default router;
