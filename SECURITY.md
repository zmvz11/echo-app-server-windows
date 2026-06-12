# Security

Do not commit secrets, tokens, generated data, or production configuration.

Server rules:

```text
Hash passwords.
Store sessions server-side.
Enforce permissions on the server.
Write audit logs for admin actions.
```

Client rules:

```text
Do not store passwords.
Do not store server secrets.
Do not decide admin access locally.
Hide admin UI only after the server confirms permissions.
```
