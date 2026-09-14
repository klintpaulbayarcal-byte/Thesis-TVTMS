# Quick Reference

## First local run

```bat
npm install
copy backend\.env.example backend\.env
```

Set `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in `backend/.env`, then run:

```bat
npm run verify
npm run dev
```

Open `http://localhost:5000/`.

## Required local values

```env
NODE_ENV=development
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=<server secret key>
JWT_SECRET=<unique random value, at least 32 characters>
ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000
APP_PUBLIC_URL=http://localhost:5000
```

## Hostinger build

```bat
npm run build
```

Upload `hostinger-app.zip` through **Deploy Web App → Upload your website files**. Use:

```text
Framework: Express.js
Entry file: backend/server.js
Start command: npm start
Build command: blank
Output directory: blank
```

Use Node.js 22 or 24 and add the values from `backend/.env.production.example` to the Hostinger environment-variable dashboard. This application uses the HTTPS API, not a database connection string.

## Common commands

```bat
npm run check
npm run preflight
npm run verify
npm run create-admin
npm run dev
npm run build
npm start
```

## Common errors

### `SUPABASE_URL is required`

Configure the HTTPS project URL and server secret key in `backend/.env` locally or Hostinger environment variables in production. A legacy `SUPABASE_SERVICE_ROLE_KEY` can replace `SUPABASE_SECRET_KEY`.

### Production startup stops

Check `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`, `APP_PUBLIC_URL`, `ALLOWED_ORIGINS`, SMTP variables, and Hostinger deployment logs.

### CORS denied

Set `ALLOWED_ORIGINS` to the exact Hostinger HTTPS origin. Do not use a wildcard.

### Email not delivered

Set SMTP values and confirm the provider permits the configured account.

## No default login

Configure `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_PASSWORD`, run `npm run create-admin`, then remove the temporary password.
