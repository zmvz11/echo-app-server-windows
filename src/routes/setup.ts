import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { validateUsername, normalizeUsername } from '../auth/usernameRules.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { hashPassword } from '../auth/passwordHash.js';
import { permissionsForRole } from '../auth/permissions.js';
import { writeAudit } from '../services/auditLog.js';

const ownerSchema = z.object({ username: z.string(), displayName: z.string().optional(), password: z.string() });

function safeUser(user: any) {
  return { id: user.id, username: user.username, displayName: user.displayName, status: user.status, role: user.role, permissions: permissionsForRole(user.role) };
}

export function setupRoutes(store: JsonStore): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const db = store.read();
    const ownerExists = db.users.some((u) => u.role === 'owner');
    res.json({ ownerExists, needsOwner: !ownerExists });
  });

  router.post('/owner', (req, res) => {
    const parsed = ownerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const username = normalizeUsername(parsed.data.username);
    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const passwordError = validatePassword(parsed.data.password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    const result = store.update((db) => {
      if (db.users.some((u) => u.role === 'owner')) return { error: 'Owner already exists.' } as const;
      const user = { id: makeId('user'), username, displayName: parsed.data.displayName, passwordHash: hashPassword(parsed.data.password), status: 'approved' as const, role: 'owner' as const, createdAt: nowIso(), approvedAt: nowIso() };
      db.users.push(user);
      db.sessions.push({ token, userId: user.id, createdAt: nowIso(), expiresAt });
      return { user };
    });
    if ('error' in result) return res.status(409).json(result);
    writeAudit(store, { actorUserId: result.user.id, action: 'setup.owner.created', targetType: 'user', targetId: result.user.id });
    res.status(201).json({ token, user: safeUser(result.user), expiresAt });
  });

  return router;
}
