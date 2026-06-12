# Echo App Server CLI v4 and GitHub updater

This release adds an OpenClaw-style command center for Echo App Server.

## Main commands

```bash
echo-server
echo-server onboard
echo-server dashboard
echo-server service install
echo-server service start
echo-server service status
echo-server config show
echo-server config set update.repo zmvz11/echo-app-server-windows
echo-server update --check
echo-server update --dry-run
echo-server update
echo-server update --rollback
```

## Update source

The updater pulls from GitHub Releases. Create a GitHub release and attach the matching server zip asset.

Windows default:

```env
ECHO_UPDATE_REPO=zmvz11/echo-app-server-windows
ECHO_UPDATE_CHANNEL=stable
ECHO_UPDATE_ASSET_PATTERN=echo-app-server-windows*.zip
```

Linux default:

```env
ECHO_UPDATE_REPO=zmvz11/echo-app-server-linux
ECHO_UPDATE_CHANNEL=stable
ECHO_UPDATE_ASSET_PATTERN=echo-app-server-linux*.zip
```

## Safe update flow

`echo-server update` checks GitHub Releases, downloads the matching zip, creates a backup under `data/updates/backups`, stops the server if it is running, applies the update, runs `npm install`, builds, restarts if needed, and runs `echo-server doctor`.

## Rollback

```bash
echo-server update --rollback
```

Rollback restores the latest updater backup and rebuilds the server.
