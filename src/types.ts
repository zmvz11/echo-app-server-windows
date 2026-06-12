export type UserStatus = 'pending' | 'approved' | 'rejected' | 'disabled' | 'locked';
export type UserRole = 'owner' | 'admin' | 'app_manager' | 'reviewer' | 'user';
export type ReleaseStatus = 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'rolled_back' | 'archived';
export type ReleaseChannel = 'stable' | 'beta' | 'dev';
export type AppVisibility = 'draft' | 'published' | 'hidden' | 'archived';
export type PlatformId = 'windows-x64' | 'linux-x64' | string;

export type User = {
  id: string;
  username: string;
  displayName?: string;
  passwordHash: string;
  status: UserStatus;
  role: UserRole;
  requestNote?: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  lastLoginAt?: string;
};

export type Session = {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type AppMedia = {
  id: string;
  type: 'icon' | 'library_banner' | 'store_banner' | 'screenshot' | 'thumbnail';
  url: string;
  fileName?: string;
  sizeBytes?: number;
  sortOrder: number;
  createdAt: string;
};

export type EchoApp = {
  id: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  developer: string;
  category: string;
  tags: string[];
  visibility: AppVisibility;
  media: AppMedia[];
  createdAt: string;
  updatedAt: string;
};

export type AppRelease = {
  id: string;
  appId: string;
  version: string;
  channel: ReleaseChannel;
  status: ReleaseStatus;
  platform: PlatformId;
  packageUrl: string;
  packageFileName?: string;
  sizeBytes?: number;
  entrypoint: string;
  installType: 'portable' | 'installer';
  changelog: string[];
  releaseNotes?: string;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectReason?: string;
  publishedAt?: string;
  rolledBackAt?: string;
};

export type ClientInstalledApp = {
  appId: string;
  version: string;
  platform: string;
  installPath: string;
  status: 'installed' | 'update_available' | 'broken' | 'removed';
  updatedAt: string;
};

export type ClientDevice = {
  id: string;
  name: string;
  platform: string;
  appCenterVersion: string;
  serverUrl?: string;
  lastCheckInAt: string;
  installedApps: ClientInstalledApp[];
};

export type InstallReport = {
  id: string;
  clientId: string;
  appId: string;
  version?: string;
  action: 'install' | 'update' | 'repair' | 'uninstall' | 'launch';
  status: 'started' | 'succeeded' | 'failed';
  message?: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
};

export type Database = {
  users: User[];
  sessions: Session[];
  apps: EchoApp[];
  releases: AppRelease[];
  clients: ClientDevice[];
  installReports: InstallReport[];
  auditLogs: AuditLog[];
};
