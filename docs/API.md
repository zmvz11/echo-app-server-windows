# Echo App Server API

## Health

- `GET /health`

## Setup

- `GET /api/setup/status`
- `POST /api/setup/owner`

## Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Admin users

- `GET /api/admin/users/pending`
- `GET /api/admin/users`
- `POST /api/admin/users/:id/approve`
- `POST /api/admin/users/:id/reject`
- `POST /api/admin/users/:id/disable`
- `POST /api/admin/users/:id/role`

## Apps

- `GET /api/apps`
- `GET /api/apps/admin/all`
- `POST /api/apps/admin/create`
- `PATCH /api/apps/admin/:id`
- `DELETE /api/apps/admin/:id`
- `POST /api/apps/admin/:id/media`
- `POST /api/apps/admin/:id/media/upload`

## Releases

- `GET /api/releases/admin`
- `POST /api/releases/admin/apps/:appId/releases`
- `POST /api/releases/admin/apps/:appId/releases/upload`
- `POST /api/releases/admin/releases/import-github`
- `POST /api/releases/admin/releases/:id/submit-review`
- `POST /api/releases/admin/releases/:id/approve`
- `POST /api/releases/admin/releases/:id/publish`
- `POST /api/releases/admin/releases/:id/reject`
- `POST /api/releases/admin/releases/:id/rollback`

## Catalog

- `GET /api/catalog`
- `GET /api/catalog/latest/:appId?platform=windows-x64&channel=stable`

## Clients

- `POST /api/clients/register`
- `POST /api/clients/:id/check-in`
- `POST /api/clients/report`
- `GET /api/clients/admin`

## Logs

- `GET /api/logs/admin`
