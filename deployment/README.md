# EETT web deployment

Development remains root-hosted. Run the normal frontend and backend commands without a URL prefix.

The shared production server hosts EETT at `https://aplicacionph.dyndns.org/eett/`:

1. Build the deployment bundle with `pnpm run build:eett` from `Frontend`.
2. Configure the ignored `Backend/.env` with production mode, `/eett` as the public base path, a unique session secret, the Microsoft credentials, the registered callback URL, and the Softland password.
3. Run `..\.venv\Scripts\python.exe -m alembic upgrade head` from `Backend` after taking a database backup.
4. Run `deployment\install-eett-admin.ps1` as administrator to install the versioned IIS/Caddy configuration and the SYSTEM startup task.

The backend binds only to `127.0.0.1:5002`. Caddy owns public HTTP port 5000 and redirects the legacy URL to `/eett/`; IIS/ARR owns public HTTPS and strips `/eett` before proxying to FastAPI.
