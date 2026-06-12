import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';
import { validateUsername, normalizeUsername } from '../auth/usernameRules.js';
import { validatePassword } from '../auth/passwordPolicy.js';
import { hashPassword, verifyPassword } from '../auth/passwordHash.js';
import { permissionsForRole } from '../auth/permissions.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';

const registerSchema = z.object({
  username: z.string(),
  displayName: z.string().optional(),
  password: z.string(),
  requestNote: z.string().optional(),
});

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

function safeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    role: user.role,
    permissions: permissionsForRole(user.role),
  };
}

export function authRoutes(store: JsonStore): Router {
  const router = Router();

  router.post('/register', (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const username = normalizeUsername(parsed.data.username);
    const usernameError = validateUsername(username);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const passwordError = validatePassword(parsed.data.password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const result = store.update((db) => {
      if (db.users.some((u) => u.username === username)) return { error: 'Username is already taken.' };
      const user = {
        id: makeId('user'),
        username,
        displayName: parsed.data.displayName,
        passwordHash: hashPassword(parsed.data.password),
        status: 'pending' as const,
        role: 'user' as const,
        requestNote: parsed.data.requestNote,
        createdAt: nowIso(),
      };
      db.users.push(user);
      return { id: user.id, username: user.username, status: user.status };
    });

    if ('error' in result) return res.status(409).json(result);
    writeAudit(store, { action: 'auth.user.registered', targetType: 'user', targetId: result.id, details: { username } });
    res.status(201).json(result);
  });

  router.post('/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const username = normalizeUsername(parsed.data.username);

    const db = store.read();
    const user = db.users.find((u) => u.username === username);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      writeAudit(store, { action: 'auth.login.failed', targetType: 'user', details: { username } });
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({ error: `Account status is ${user.status}.` });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    store.update((nextDb) => {
      const target = nextDb.users.find((u) => u.id === user.id);
      if (target) target.lastLoginAt = nowIso();
      nextDb.sessions.push({ token, userId: user.id, createdAt: nowIso(), expiresAt });
    });
    writeAudit(store, { actorUserId: user.id, action: 'auth.login.succeeded', targetType: 'user', targetId: user.id });
    res.json({ token, user: safeUser(user), expiresAt });
  });

  router.post('/logout', requireAuth(store), (req: AuthedRequest, res) => {
    store.update((db) => {
      db.sessions = db.sessions.filter((s) => s.token !== req.token);
    });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(store), (req: AuthedRequest, res) => {
    res.json({ user: safeUser(req.user) });
  });

  return router;
}
