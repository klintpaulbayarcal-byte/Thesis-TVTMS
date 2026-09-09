# Quick Reference

## First local run

```bat
npm install
copy backend\.env.example backend\.env
```

Set the Supabase transaction-pooler URL as `DATABASE_URL` in `backend/.env`, then run:

```bat
npm run verify
npm run dev
```

Open `http://localhost:5000/`.

## Required local values

```env
NODE_ENV=development
DATABASE_URL=<Supabase transaction-pooler URL>
DB_POOL_SIZE=3
DB_SSL=1
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

Use Hostinger's Supabase Database Connect Wizard and add the remaining values from `.env.example` to the environment-variable dashboard.

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

### `DATABASE_URL is required`

Copy the Supabase transaction-pooler connection string into `backend/.env` for local development, or connect Supabase through the Hostinger Database Connect Wizard in production.

### Production startup stops

Check `DATABASE_URL`, `JWT_SECRET`, `APP_PUBLIC_URL`, `ALLOWED_ORIGINS`, SMTP variables, and Hostinger deployment logs.

### CORS denied

Set `ALLOWED_ORIGINS` to the exact Hostinger HTTPS origin. Do not use a wildcard.

### Email not delivered

Set SMTP values and confirm the provider permits the configured account.

## No default login

Configure `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_EMAIL`, and `INITIAL_ADMIN_PASSWORD`, run `npm run create-admin`, then remove the temporary password.
