# Deployment Notes

## Recommended topology

Serve the static frontend through HTTPS and reverse-proxy `/api` to the Node.js backend. Keep backend source, `.env`, and evidence outside the public document root whenever the hosting platform permits it.

## Production environment

At minimum:

```env
NODE_ENV=production
PORT=5000
TRUST_PROXY=1
DB_HOST=<private database host>
DB_PORT=3306
DB_USER=<dedicated application user>
DB_PASSWORD=<strong password>
DB_NAME=violation_system
JWT_SECRET=<unique random 32+ character value>
JWT_EXPIRES_IN=8h
ALLOWED_ORIGINS=https://traffic.example.gov.ph
APP_PUBLIC_URL=https://traffic.example.gov.ph
SMTP_HOST=<provider>
SMTP_PORT=587
SMTP_USER=<account>
SMTP_PASS=<secret>
SMTP_FROM=<approved sender>
CONTACT_TO_EMAIL=<official inbox>
```

Set `TRUST_PROXY=1` only when a trusted reverse proxy is actually in front of Node.

## Frontend API configuration

Preferred same-origin setup:

```text
https://traffic.example.gov.ph/       -> frontend
https://traffic.example.gov.ph/api/   -> reverse proxy to Node
```

Leave `frontend/app-config.js` blank for same-origin. For a separate API origin, use HTTPS and set the exact origin there and in `ALLOWED_ORIGINS`.

## Database

- Back up the database before initial import or migration.
- Import `backend/models/database.sql` for a new database.
- The server runs safe schema checks/migrations at startup.
- Production startup intentionally stops when unsupported legacy driver accounts remain.
- Validate all starter violation definitions and amounts with the authorized LGU office.

## Evidence storage

`backend/uploads/evidence` is intentionally not included in ZIPs or Git. Create a persistent writable directory owned only by the API service account. Back up evidence and the database as one coordinated set.

## Web-server protections

The package contains `.htaccess` rules to disable directory listing, block direct access to backend source through Apache, and protect documentation/schema files from web download. These rules are defense-in-depth; production should still use a proper document-root separation.

## Process management

Run Node with a managed service such as the hosting platform’s process manager or an operating-system service. Configure automatic restart, restricted service permissions, log rotation, and health monitoring against `/api/health`.

## Go-live rule

Static validation alone is not approval. Complete `DEPLOYMENT_CHECKLIST.md`, run a current online `npm audit`, execute live UAT against a copy of the production environment, and test a backup restore before switching public traffic.
