# Quick Reference

## First local run

```bat
copy backend\.env.example backend\.env
```

Edit `backend/.env`, start Apache/MySQL, import `backend/models/database.sql`, then:

```bat
cd backend
npm ci
npm run create-admin
npm run verify
npm start
```

Or use `OPEN_VVS.bat` after the database and `.env` are configured.

## Required environment values

```env
NODE_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_USER=<database user>
DB_PASSWORD=<database password>
DB_NAME=violation_system
JWT_SECRET=<unique random value, at least 32 characters>
ALLOWED_ORIGINS=http://localhost,http://127.0.0.1
APP_PUBLIC_URL=http://localhost/<project-folder>/frontend
```

For production, use `NODE_ENV=production`, HTTPS URLs, exact origins, a dedicated database account, and `TRUST_PROXY=1` when behind a reverse proxy.

## Health check

```text
http://localhost:5000/api/health
```

Healthy response requires both the Node API and database connection.

## Common commands

```bat
npm run check
npm run preflight
npm run verify
npm start
npm audit
```

## Common errors

### `Could not read package.json`
Run npm commands inside `backend`, not the project root.

### Backend does not start
Check `backend/.env`, MySQL status, database name, `JWT_SECRET`, and port 5000.

### CORS denied
Add the exact frontend origin to `ALLOWED_ORIGINS`; do not use a wildcard for a public deployment.

### Public page loads but API requests fail
Use a same-origin `/api` reverse proxy or set `frontend/app-config.js` to the deployed HTTPS API origin.

### Email not delivered
Set SMTP values and confirm the provider permits the configured account. Password reset and email notifications require working SMTP.

### Evidence missing after redeployment
Use persistent storage for `backend/uploads/evidence` and back it up together with the database.

## No default login

Create the initial administrator with `npm run create-admin`. Remove `INITIAL_ADMIN_PASSWORD` from `.env` after successful creation.
