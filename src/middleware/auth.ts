import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'moderator' | 'customer';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
}

// ── Middleware: authenticate any signed-in user ────────────────────────────
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided' });
    return;
  }

  try {
    const token = header.slice(7);
    const payload = verifyToken(token);
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

// ── Middleware: admin or moderator only ────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload;
  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }
  next();
}

// ── Middleware: super admin only ───────────────────────────────────────────
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload;
  if (!user || user.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Super admin access required' });
    return;
  }
  next();
}
