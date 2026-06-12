# Echo App Server Nodes and Sync Approval

Echo uses a safe primary-node model.

- One **Primary Echo App Server** owns users, apps, releases, roles, approvals, and publishing.
- **Download Mirror** nodes can pull packages/media and serve client downloads.
- **Standby Backup** nodes can pull backups and may be manually promoted later.
- Active-active writing is intentionally not enabled yet.

## Primary setup

On the primary server:

```bash
echo-server sync setup
```

This enables node approval mode. Nodes still require approval before they can access files.

## Node setup

On the second server:

```bash
echo-server node setup
```

Enter:

- Node nickname
- Node type: `download_mirror`, `standby_backup`, or `full_backup`
- Primary server IP and port
- This node IP and port

The node sends a join request to the primary server.

## Approving nodes

Open Echo App Center:

```text
Settings → Server Nodes → Pending Node Requests
```

Review the nickname, requested type, URL, and fingerprint. Then choose allowed access:

- Pull packages
- Pull media
- Serve downloads
- Pull database backup
- Be promoted
- Run admin API

After approval, the node can run:

```bash
echo-server node status
```

The node retrieves and stores its node token.

## App Center download locations

App Center settings include:

```text
Settings → Downloads → Download Server Location
```

Users can choose:

- Auto - Best Available
- Main Server
- Approved download mirrors

If a selected mirror is unavailable, the client can fall back to the primary download URL.

## CLI commands

```bash
echo-server node setup
echo-server node status
echo-server node doctor
echo-server node promote

echo-server sync setup
echo-server sync status
echo-server sync nodes
echo-server sync requests
echo-server sync approve <request-id>
echo-server sync reject <request-id>
echo-server sync now
```

## API overview

Public join/status:

```text
POST /api/nodes/join-request
GET  /api/nodes/join-request/:id/status
GET  /api/nodes/download-locations
```

Admin node control:

```text
GET    /api/admin/nodes
POST   /api/admin/nodes/requests/:id/approve
POST   /api/admin/nodes/requests/:id/reject
POST   /api/admin/nodes/:id/test
POST   /api/admin/nodes/:id/sync-now
PATCH  /api/admin/nodes/:id/permissions
DELETE /api/admin/nodes/:id
```

Node sync:

```text
GET  /api/nodes/sync/manifest
POST /api/nodes/sync/check-in
```

Node sync endpoints require a node token.
