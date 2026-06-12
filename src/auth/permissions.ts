import type { UserRole } from '../types.js';

export type Permission =
  | 'users.approve'
  | 'users.disable'
  | 'users.edit_role'
  | 'apps.create'
  | 'apps.edit'
  | 'apps.delete'
  | 'media.upload'
  | 'releases.create'
  | 'releases.approve'
  | 'releases.publish'
  | 'releases.rollback'
  | 'logs.view'
  | 'server.settings.edit';

const rolePermissions: Record<UserRole, Permission[]> = {
  owner: [
    'users.approve','users.disable','users.edit_role','apps.create','apps.edit','apps.delete','media.upload',
    'releases.create','releases.approve','releases.publish','releases.rollback','logs.view','server.settings.edit'
  ],
  admin: [
    'users.approve','users.disable','users.edit_role','apps.create','apps.edit','media.upload',
    'releases.create','releases.approve','releases.publish','releases.rollback','logs.view'
  ],
  app_manager: ['apps.create','apps.edit','media.upload','releases.create'],
  reviewer: ['releases.approve','releases.publish','releases.rollback','logs.view'],
  user: [],
};

export function permissionsForRole(role: UserRole): Permission[] {
  return rolePermissions[role] ?? [];
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
