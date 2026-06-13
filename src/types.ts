export type UserStatus = 'pending' | 'approved' | 'rejected' | 'disabled' | 'locked';
export type UserRole = 'owner' | 'admin' | 'app_manager' | 'reviewer' | 'user';
export type ReleaseStatus = 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected' | 'rolled_back' | 'archived';
export type ReleaseChannel = 'stable' | 'beta' | 'dev';
export type AppVisibility = 'draft' | 'published' | 'hidden' | 'archived';
export type PlatformId = 'windows-x64' | 'linux-x64' | string;
export type PackageKind = 'zip' | 'echoapp';

export type StoreLayoutSectionType = 'hero' | 'app_row' | 'app_grid' | 'category_row' | 'category_tabs' | 'promo' | 'spacer';
export type StoreLayoutSource = 'manual' | 'featured' | 'recently_updated' | 'category' | 'all';
export type StoreLayoutSection = { id: string; type: StoreLayoutSectionType; title: string; enabled: boolean; source: StoreLayoutSource; appIds: string[]; category?: string; limit: number; note?: string; };
export type StoreLayout = { id: string; title: string; status: 'draft' | 'published'; updatedAt?: string; sections: StoreLayoutSection[]; };

export type NodeRole = 'primary' | 'download_mirror' | 'standby_backup' | 'full_backup';
export type NodeRequestStatus = 'pending' | 'approved' | 'rejected';
export type NodeStatus = 'approved' | 'disabled' | 'offline';
export type NodePermissionKey = 'canPullPackages' | 'canPullMedia' | 'canServeDownloads' | 'canPullDatabaseBackup' | 'canBePromoted' | 'canRunAdminApi';
export type NodePermissions = Record<NodePermissionKey, boolean>;
export type EchoNodeRequest = { id: string; nickname: string; nodeType: NodeRole; baseUrl: string; fingerprint: string; requestedPermissions: NodePermissionKey[]; status: NodeRequestStatus; createdAt: string; reviewedAt?: string; reviewedBy?: string; rejectionReason?: string; nodeId?: string; token?: string; };
export type EchoNode = { id: string; nickname: string; nodeType: NodeRole; baseUrl: string; fingerprint: string; token: string; status: NodeStatus; permissions: NodePermissions; createdAt: string; approvedAt: string; approvedBy?: string; lastSeenAt?: string; lastSyncAt?: string; packagesSynced?: number; mediaSynced?: number; storageFreeBytes?: number; healthMessage?: string; };
export type SyncSettings = { enabled: boolean; requireApproval: boolean; intervalMinutes: number; allowDownloadMirrors: boolean; allowStandbyBackups: boolean; lastConfiguredAt?: string; };
export type DownloadLocation = { id: string; nickname: string; nodeType: NodeRole; baseUrl: string; status: 'online' | 'offline' | 'unknown'; pingMs?: number; lastSyncAt?: string; storageFreeBytes?: number; isPrimary?: boolean; };

export type PackageValidationReport = { ok: boolean; packageKind: PackageKind; fileName: string; checkedAt: string; warnings: string[]; errors: string[]; recommendedManifest?: string; };

export type GitHubAppSource = {
  type: 'github_release';
  owner: string;
  repo: string;
  channel: ReleaseChannel;
  platform: PlatformId;
  assetPattern: string;
  entrypoint: string;
  installType: 'portable' | 'installer';
  includePrereleases?: boolean;
  tag?: string;
  latestTag?: string;
  latestName?: string;
  latestAssetName?: string;
  latestAssetUrl?: string;
  latestAssetSize?: number;
  latestCheckedAt?: string;
  updateAvailable?: boolean;
  lastImportedTag?: string;
  lastImportedReleaseId?: string;
  lastError?: string;
};

export type User = { id: string; username: string; displayName?: string; passwordHash: string; status: UserStatus; role: UserRole; requestNote?: string; createdAt: string; approvedAt?: string; approvedBy?: string; lastLoginAt?: string; };
export type Session = { token: string; userId: string; createdAt: string; expiresAt: string; };
export type AppMedia = { id: string; type: 'icon' | 'library_banner' | 'store_banner' | 'store_hero' | 'card_thumbnail' | 'screenshot' | 'thumbnail'; url: string; fileName?: string; sizeBytes?: number; sortOrder: number; createdAt: string; };
export type EchoApp = { id: string; name: string; shortDescription: string; fullDescription: string; developer: string; category: string; tags: string[]; platforms?: string[]; visibility: AppVisibility; featured?: boolean; media: AppMedia[]; githubSource?: GitHubAppSource; createdAt: string; updatedAt: string; };
export type AppRelease = { id: string; appId: string; version: string; channel: ReleaseChannel; status: ReleaseStatus; platform: PlatformId; packageUrl: string; packageFileName?: string; sizeBytes?: number; entrypoint: string; installType: 'portable' | 'installer'; sourceType?: 'upload' | 'github_release'; sourceRepo?: string; sourceTag?: string; sourceAssetName?: string; changelog: string[]; releaseNotes?: string; packageKind?: PackageKind; validation?: PackageValidationReport; createdAt: string; submittedAt?: string; approvedAt?: string; approvedBy?: string; rejectedAt?: string; rejectedBy?: string; rejectReason?: string; publishedAt?: string; rolledBackAt?: string; };
export type ClientInstalledApp = { appId: string; version: string; platform: string; installPath: string; status: 'installed' | 'update_available' | 'broken' | 'removed'; updatedAt: string; };
export type ClientDevice = { id: string; name: string; platform: string; appCenterVersion: string; serverUrl?: string; lastCheckInAt: string; installedApps: ClientInstalledApp[]; };
export type InstallReport = { id: string; clientId: string; appId: string; version?: string; action: 'install' | 'update' | 'repair' | 'uninstall' | 'launch'; status: 'started' | 'succeeded' | 'failed'; message?: string; createdAt: string; };
export type AuditLog = { id: string; actorUserId?: string; action: string; targetType: string; targetId?: string; details?: Record<string, unknown>; createdAt: string; };
export type Database = { users: User[]; sessions: Session[]; apps: EchoApp[]; releases: AppRelease[]; clients: ClientDevice[]; installReports: InstallReport[]; auditLogs: AuditLog[]; nodeRequests: EchoNodeRequest[]; nodes: EchoNode[]; syncSettings?: SyncSettings; storeLayout?: StoreLayout; };
