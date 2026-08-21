import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// ── Roles ─────────────────────────────────────────────────────────────────────
// Extend as new staff roles are added; keep in sync with DB role_permissions.
export type AdminRole = 'admin' | 'customer_support' | 'customersupport' | 'support_agent';

export interface JwtPayload {
  userId: string;
  email: string;
  role: AdminRole | 'customer';
}

export function signToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is not set — refusing to sign token');
  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is not set — refusing to verify token');
  return jwt.verify(token, secret) as JwtPayload;
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

// ── Middleware: any staff member (admin + support roles) ───────────────────
// Use for: read-heavy admin views (reports, audit log, user list, auction list,
// announcement posting, winners list). NOT for money operations or destructive actions.
const STAFF_ROLES = new Set<string>(['admin', 'customer_support', 'customersupport', 'support_agent']);

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload;
  if (!user || !STAFF_ROLES.has(user.role)) {
    res.status(403).json({ success: false, message: 'Staff access required' });
    return;
  }
  next();
}

// ── Middleware: true admin only ────────────────────────────────────────────
// Use for: wallet adjustments, user deletion, payment approval/rejection,
// settings changes, bank account management, payment gateway management,
// auction create/delete, role permissions changes.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload;
  if (!user || user.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Full admin access required' });
    return;
  }
  next();
}
