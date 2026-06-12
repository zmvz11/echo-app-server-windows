import { Router } from 'express';
import { z } from 'zod';
import type { JsonStore } from '../lib/storage.js';
import { requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { nowIso } from '../lib/id.js';
import { writeAudit } from '../services/auditLog.js';
import type { UserRole } from '../types.js';

const roleSchema = z.object({ role: z.enum(['owner','admin','app_manager','reviewer','user']) });

function publicUser(user: any) {
  const { passwordHash, ...safe } = user;
  return safe;
}

export function adminUsersRoutes(store: JsonStore): Router {
  const router = Router();

  router.get('/', ...requirePermission(store, 'users.approve'), (_req, res) => {
    const db = store.read();
    res.json({ users: db.users.map(publicUser) });
  });

  router.get('/pending', ...requirePermission(store, 'users.approve'), (_req, res) => {
    const db = store.read();
    res.json({ users: db.users.filter((u) => u.status === 'pending').map(publicUser) });
  });

  router.post('/:id/approve', ...requirePermission(store, 'users.approve'), (req: AuthedRequest, res) => {
    const updated = store.update((db) => {
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) return null;
      user.status = 'approved';
      user.approvedAt = nowIso();
      user.approvedBy = req.user?.id;
      return publicUser(user);
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.user.approved', targetType: 'user', targetId: req.params.id });
    res.json({ user: updated });
  });

  router.post('/:id/reject', ...requirePermission(store, 'users.approve'), (req: AuthedRequest, res) => {
    const updated = store.update((db) => {
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) return null;
      user.status = 'rejected';
      return publicUser(user);
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.user.rejected', targetType: 'user', targetId: req.params.id });
    res.json({ user: updated });
  });

  router.post('/:id/disable', ...requirePermission(store, 'users.disable'), (req: AuthedRequest, res) => {
    const updated = store.update((db) => {
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) return null;
      user.status = 'disabled';
      db.sessions = db.sessions.filter((s) => s.userId !== user.id);
      return publicUser(user);
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.user.disabled', targetType: 'user', targetId: req.params.id });
    res.json({ user: updated });
  });

  router.post('/:id/role', ...requirePermission(store, 'users.edit_role'), (req: AuthedRequest, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = store.update((db) => {
      const user = db.users.find((u) => u.id === req.params.id);
      if (!user) return null;
      user.role = parsed.data.role as UserRole;
      return publicUser(user);
    });
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.user.role.changed', targetType: 'user', targetId: req.params.id, details: { role: parsed.data.role } });
    res.json({ user: updated });
  });

  return router;
}
