# Echo GitHub App Source

Echo App Server can link an app to a GitHub repository release source. This lets admins create Store apps from GitHub Releases instead of uploading a package file manually.

## Supported model

- The GitHub repository is the source project.
- A GitHub Release is the installable version.
- A release asset, usually `.zip` or `.echoapp`, is the downloadable package.
- Echo App Server checks GitHub Releases and marks the app source as update available when a newer release asset exists.

## Admin API

- `POST /api/releases/admin/github-source/test`
- `POST /api/releases/admin/apps/:appId/github-source`
- `POST /api/releases/admin/apps/:appId/github-source/check`
- `POST /api/releases/admin/apps/:appId/github-source/import-latest`

Public repositories work without a token. Private repositories require `ECHO_GITHUB_TOKEN` on the server.
