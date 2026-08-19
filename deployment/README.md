# EETT web deployment

Development remains root-hosted. Run the normal frontend and backend commands without a URL prefix.

The shared production server hosts EETT at `https://aplicacionph.dyndns.org/eett/`:

1. Build the deployment bundle with `pnpm run build:eett` from `Frontend`.
2. Configure the ignored `Backend/.env` with production mode, `/eett` as the public base path, a unique session secret, the Microsoft credentials, the registered callback URL, and the Softland password.
3. Run `..\.venv\Scripts\python.exe -m alembic upgrade head` from `Backend` after taking a database backup.
4. Run `deployment\install-eett-admin.ps1` as administrator to install the versioned IIS/Caddy configuration and the SYSTEM startup task.

The backend binds only to `127.0.0.1:5002`. Caddy owns public HTTP port 5000 and redirects the legacy URL to `/eett/`; IIS/ARR owns public HTTPS and strips `/eett` before proxying to FastAPI.

## Local database sync

The Settings page shows **Sincronizar desde produccion** only when the frontend is opened through `localhost`, `127.0.0.1`, or `::1`. The local backend independently requires development mode and loopback request/client addresses.

Before using it, deploy this version to production and set the same long random token in the ignored `Backend/.env` on both production and the development machine:

```dotenv
SPEC_SHEETS_DATABASE_SYNC_TOKEN=replace-with-a-long-random-secret
```

The development source defaults to `https://aplicacionph.dyndns.org/eett`. Override it with `SPEC_SHEETS_DATABASE_SYNC_SOURCE_URL` if the production base URL changes. Optional limits are `SPEC_SHEETS_DATABASE_SYNC_TIMEOUT_SECONDS` (default `600`) and `SPEC_SHEETS_DATABASE_SYNC_MAX_DUMP_BYTES` (default `2147483648`).

The production export endpoint is enabled only in `production` mode with the token configured. Each local sync creates a normal checkpoint backup before the atomic database swap. This copies PostgreSQL only; `output/media_gallery` remains local.
