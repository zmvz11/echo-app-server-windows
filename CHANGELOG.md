# Changelog

## 1.5.0 - Release QA v9

- Added OpenClaw-inspired one-line GitHub installer flow for Echo App Server.
- Added GitHub Release bootstrap scripts for Windows PowerShell and Linux Bash.
- Improved Linux setup with Node.js 20+ detection and supported automatic install paths.
- Added one-line install documentation and README quick install commands.
- Added `echo-server install-info` to show update/install source details.

## 1.4.0-release-qa-v7

- Added Echo .echoapp package standard documentation.
- Added package metadata validation route for release uploads.
- Validates uploaded and GitHub-linked release assets before creating releases.
- Stores package kind and validation report on releases.

# Changelog

## 1.3.0 - Release QA v6 GitHub Sources + CLI v4

- Combined Echo Server CLI v4/OpenClaw-style command center update with the Store/Add Apps server API.
- Added GitHub Release source support for apps.
- Added GitHub source test, save, check, and import-latest admin routes.
- Added app-level update detection metadata for GitHub-linked apps.

## 1.2.0-cli-v4-update

- Added OpenClaw-style `echo-server` command center.
- Added `echo-server onboard`, `dashboard`, `service`, and expanded `config` commands.
- Added GitHub Releases updater with `--check`, `--dry-run`, channels, backups, and rollback.
- Added lightweight `/admin` dashboard landing page.

# Changelog

## 1.0.0-rc1

- Initial separated Echo product structure.
- Username-only account model.
- Admin approval workflow.
- App catalog and release management foundation.
