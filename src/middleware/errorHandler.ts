import { Request, Response, NextFunction } from 'express';

// Global error handler
export function errorHandler(
  err: Error & { status?: number; code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status || 500;

  // Full stack trace in dev, message-only in prod
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ERROR] ${status} — ${err.message}`);
    if (err.stack) console.error(err.stack);
  } else {
    console.error(`[ERROR] ${status} — ${err.message}`);
  }

  // PostgreSQL unique violation → friendly 409
  if (err.code === '23505') {
    res.status(409).json({
      success: false,
      message: 'Email or phone number already registered',
    });
    return;
  }

  // PostgreSQL check constraint violation → friendly 400
  if (err.code === '23514') {
    res.status(400).json({
      success: false,
      message: 'Invalid value provided for one of the fields',
    });
    return;
  }

  res.status(status).json({
    success: false,
    message: status === 500 ? 'Internal server error' : err.message,
  });
}

// 404 handler
export function notFound(req: Request, res: Response): void {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
}

// Async wrapper to catch promise rejections
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
