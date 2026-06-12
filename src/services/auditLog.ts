import type { JsonStore } from '../lib/storage.js';
import { makeId, nowIso } from '../lib/id.js';

export function writeAudit(store: JsonStore, input: {
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
}) {
  store.update((db) => {
    db.auditLogs.unshift({
      id: makeId('audit'),
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      details: input.details,
      createdAt: nowIso(),
    });
    db.auditLogs = db.auditLogs.slice(0, 5000);
  });
}
