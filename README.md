# Echo App Server — Windows

Clean GitHub-ready package for Echo App Server on Windows.

## Install

Run one installer from the repo root:

```text
INSTALL.bat
```

Do not run old helper scripts. This package intentionally has one obvious install entry point.

## After install

Open a new terminal and run:

```text
echo
```

If your shell does not support the shortcut, run:

```text
echo-server
```

Server management commands:

```text
echo-server-ctl status
echo-server-doctor
echo-server-setup
```

During install, the setup wizard asks for the server port, public IP/hostname, data folder, and first Owner username/password.

## CLI command

Use `echo-server` after install. Do not use `echo`; Windows owns that command.

```bash
echo-server
echo-server setup
echo-server start
echo-server status
echo-server doctor
echo-server users pending
echo-server approve <username>
```

See `COMMANDS.md` for the full command list.
