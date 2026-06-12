# Echo Store Builder Standard

Echo App Center now uses a Steam-inspired Store and Library layout while keeping Echo branding and ownership.

## Store asset sizes

Use these sizes for clean results:

| Asset | Recommended Size | Notes |
| --- | --- | --- |
| Icon | 512x512 | PNG, transparent preferred |
| Store Hero | 1920x720 | Large Store feature banner |
| Library Banner | 1920x620 | Header shown on Library detail |
| Card Thumbnail | 600x338 | Store grid card, 16:9 |
| Screenshots | 1920x1080 | Minimum 3 recommended |

Accepted image formats: PNG, JPG, WEBP.

## Admin Portal flow

Open `Admin Portal -> Apps`.

The Apps page now handles app metadata, images, Store preview, and publish state in one place.

1. Add or select an app.
2. Enter app name, short description, full description, developer, category, tags, and platforms.
3. Drag/drop image assets into the Store Hero, Library Banner, Icon, Card Thumbnail, and Screenshot zones.
4. Watch the Live Store Preview update.
5. Save as Draft or Publish.

## Server vs App Center responsibility

Server owns the data:

- app metadata
- published/hidden/draft status
- featured flag
- uploaded media
- releases/packages
- Store API responses

App Center owns the presentation:

- Store homepage
- app cards
- featured hero
- category rows
- app detail page
- Library layout
- Admin visual app builder

## Store API routes

Public Store routes:

- `GET /api/store/apps`
- `GET /api/store/featured`
- `GET /api/store/categories`
- `GET /api/store/sections`
- `GET /api/store/apps/:id`

Admin App routes:

- `POST /api/apps/admin/create`
- `PATCH /api/apps/admin/:id`
- `PATCH /api/apps/admin/:id/featured`
- `PATCH /api/apps/admin/:id/visibility`
- `POST /api/apps/admin/:id/media/upload`

## Repository update workflow

Do not upload zip files to the code tab.

1. Extract this updated package.
2. Copy the changed files into your local GitHub Desktop repo folder, or use Git to merge them.
3. Open GitHub Desktop.
4. Review changed files.
5. Commit with a message like `Upgrade Store and Apps admin builder`.
6. Push origin.
7. Rebuild/reinstall locally if testing the installed app.
