import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Database } from '../types.js';

const initialDb: Database = {
  users: [],
  sessions: [],
  apps: [],
  releases: [],
  clients: [],
  installReports: [],
  auditLogs: [],
  nodeRequests: [],
  nodes: [],
  syncSettings: { enabled: false, requireApproval: true, intervalMinutes: 15, allowDownloadMirrors: true, allowStandbyBackups: true },
};

function normalizeDb(input: Partial<Database>): Database {
  return {
    users: input.users ?? [],
    sessions: input.sessions ?? [],
    apps: input.apps ?? [],
    releases: input.releases ?? [],
    clients: (input.clients ?? []).map((client: any) => ({ ...client, installedApps: client.installedApps ?? [] })),
    installReports: input.installReports ?? [],
    auditLogs: input.auditLogs ?? [],
    nodeRequests: input.nodeRequests ?? [],
    nodes: input.nodes ?? [],
    syncSettings: input.syncSettings ?? { enabled: false, requireApproval: true, intervalMinutes: 15, allowDownloadMirrors: true, allowStandbyBackups: true },
  };
}

export class JsonStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'echo-app-server.json');
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, JSON.stringify(initialDb, null, 2));
    }
  }

  read(): Database {
    const raw = readFileSync(this.filePath, 'utf8');
    return normalizeDb(JSON.parse(raw) as Partial<Database>);
  }

  write(db: Database): void {
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(normalizeDb(db), null, 2));
    renameSync(tempPath, this.filePath);
  }

  update<T>(fn: (db: Database) => T): T {
    const db = this.read();
    const result = fn(db);
    this.write(db);
    return result;
  }
}
