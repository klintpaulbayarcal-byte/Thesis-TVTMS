# Deployment Notes

## Topology

Hostinger runs one Express application that serves both the static frontend and `/api`. The API connects privately to Supabase PostgreSQL.

```text
Hostinger Express application
  -> frontend
  -> /api
       -> Supabase PostgreSQL
```

No separate API service or cross-origin configuration is required.

## Build

```bash
npm install
npm run build
```

The build creates:

- `dist/` — unpacked Hostinger application
- `hostinger-app.zip` — hPanel upload archive

Neither output contains `backend/.env`, database credentials, local uploads, development scripts, nor `node_modules`.

## Deploy in Hostinger

1. Use a Business or Cloud plan with Node.js Web App support.
2. Open **Websites → Add Website → Deploy Web App**.
3. Choose **Upload your website files**.
4. Upload `hostinger-app.zip`.
5. Select Express.js and Node.js 20 or newer.
6. Use entry file `backend/server.js` and start command `npm start`.
7. Leave build command and output directory blank.
8. Add the environment variables from `.env.example`.
9. Open **Database Connect Wizard**, select Supabase, authorize the project, and redeploy.

Hostinger stores backend build files outside `public_html` and creates its own routing configuration. Plain FTP uploads to `public_html` cannot start or supervise this Node.js application.

## Required production environment

Set `NODE_ENV=production`, `TRUST_PROXY=1`, a strong `JWT_SECRET`, exact HTTPS values for `APP_PUBLIC_URL` and `ALLOWED_ORIGINS`, and configured SMTP credentials. `DATABASE_URL` must be the Supabase transaction-pooler URL supplied by Hostinger's Database Connect Wizard.

## Go-live

After deployment, verify `/api/health`, login, ticket issuance, ticket lookup, payment, dispute, reports, notifications, and evidence access against the Hostinger domain. Complete `DEPLOYMENT_CHECKLIST.md` before public use.
