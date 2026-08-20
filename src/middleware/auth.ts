import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'customer';
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

// ── Middleware: admin only ─────────────────────────────────────────────────
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload;
  const staffRoles = new Set(['admin', 'customer_support', 'support_agent']);
  if (!user || !staffRoles.has(user.role)) {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }
  next();
}

// requireSuperAdmin is now identical to requireAdmin — kept as alias for backwards compatibility
export const requireSuperAdmin = requireAdmin;
