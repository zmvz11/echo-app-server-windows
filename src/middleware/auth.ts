import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { JsonStore } from '../lib/storage.js';
import type { User } from '../types.js';
import { hasPermission, type Permission } from '../auth/permissions.js';

export type AuthedRequest = Request & { user?: User; token?: string };

export function requireAuth(store: JsonStore): RequestHandler {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Login required.' });

    const db = store.read();
    const session = db.sessions.find((s) => s.token === token && new Date(s.expiresAt).getTime() > Date.now());
    if (!session) return res.status(401).json({ error: 'Session expired or invalid.' });

    const user = db.users.find((u) => u.id === session.userId && u.status === 'approved');
    if (!user) return res.status(403).json({ error: 'User is not approved.' });

    req.user = user;
    req.token = token;
    next();
  };
}

export function requirePermission(store: JsonStore, permission: Permission): RequestHandler[] {
  return [
    requireAuth(store),
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      if (!req.user || !hasPermission(req.user.role, permission)) {
        return res.status(403).json({ error: 'Permission denied.' });
      }
      next();
    },
  ];
}
