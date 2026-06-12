# Echo App Server Release QA v5

This server package remains compatible with the App Center v5 premium polish update.

Required App Center v5 routes:

- `GET /api/store/apps`
- `GET /api/store/featured`
- `GET /api/store/categories`
- `GET /api/store/sections`
- `POST /api/apps/admin/create`
- `PATCH /api/apps/admin/:id`
- `PATCH /api/apps/admin/:id/featured`
- `PATCH /api/apps/admin/:id/visibility`
- `POST /api/apps/admin/:id/media/upload`
- `POST /api/releases/admin/apps/:appId/releases/upload`

Update order: server first, then App Center.
