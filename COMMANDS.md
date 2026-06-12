# Echo App Server CLI

Use `echo-server`. Do not use `echo`; Windows already owns that shell command.

## Direct commands

```bash
echo-server
echo-server setup
echo-server start
echo-server stop
echo-server restart
echo-server status
echo-server doctor
echo-server url
echo-server users
echo-server users pending
echo-server approve <username>
echo-server reject <username>
echo-server disable <username>
echo-server role <username> <owner|admin|app_manager|reviewer|user>
echo-server apps
echo-server releases
echo-server clients
echo-server logs 25
echo-server config
```

## Setup wizard

`echo-server setup` asks for:

- LAN access
- bind host
- server port
- public protocol
- server IP/hostname App Centers use
- data directory
- CORS setting
- first Owner/admin username and password
- optional firewall command display

## Doctor

`echo-server doctor` checks:

- Node.js version
- `.env` file
- npm registry
- port validity
- public URL format
- data directory write access
- media/package directories
- database readability
- Owner account existence
- PID file
- `/health` response
- configured port state
- safe command-name usage

## Runtime slash commands

After `echo-server start`, the running server terminal accepts:

```text
/help
/status
/setup
/url
/users
/users pending
/approve <username>
/reject <username>
/disable <username>
/role <username> <role>
/apps
/releases
/clients
/logs 25
/stop
```
