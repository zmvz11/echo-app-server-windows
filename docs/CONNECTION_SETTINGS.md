# Echo App Server Connection Settings

Echo App Server uses environment variables for host and port settings. The `.env` file is the place to set the server port.

Create or edit `.env` in the repo/root folder:

```env
ECHO_SERVER_HOST=0.0.0.0
ECHO_SERVER_PORT=8080
ECHO_PUBLIC_BASE_URL=http://YOUR-SERVER-IP:8080
ECHO_DATA_DIR=./data
```

Use `0.0.0.0` for `ECHO_SERVER_HOST` when other computers need to connect.

Examples:

```env
ECHO_SERVER_PORT=8080
ECHO_PUBLIC_BASE_URL=http://192.168.0.50:8080
```

After changing the port, restart Echo App Server. Then update Echo App Center settings to use the same IP and port.
