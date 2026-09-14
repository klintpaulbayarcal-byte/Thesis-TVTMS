# Municipal Traffic Violation Ticketing and Management System

A web-based municipal traffic citation and records-management system developed for the Municipality of Calape, Bohol. The project includes a public portal, role-based internal dashboards, ticket issuance, repeat-offender lookup, payments, disputes, evidence, reports, notifications, settings, and audit trails.

## Project Attribution

- **Academic Developer:** Klint Paul R. Bayarcal
- **Role:** Lead System Developer
- **Thesis Co-Proponent:** Edcel F. Clarin
- **Program:** BS Computer Science
- **Institution:** BISU Calape Campus
- **Project:** Academic thesis/capstone, AY 2025–2026
- **Operational Authority:** The designated municipal office retains authority over official system records and production use.

## Deployment status

This package is a **final deployment candidate**, not a substitute for live acceptance testing. Static code checks passed, but the target server, production database, SMTP account, HTTPS configuration, and complete browser workflows must still be tested before public go-live. See `DEPLOYMENT_CHECKLIST.md` and `FINAL_DEPLOYMENT_AUDIT.md`.

## Supported roles

- **Administrator** — user/violation management, payments, disputes, reports, analytics, audit logs, and system settings.
- **Apprehending Officer** — ticket issuance, assigned ticket records, authorized vehicle lookup, evidence, notifications, and profile management.
- **Public user** — account-free ticket or plate lookup, public violation information, dispute submission, and contact form.

There are **no default accounts** and no public driver account. Configure `INITIAL_ADMIN_*` in `backend/.env`, then run `npm run create-admin`.

## Technology

- Application: Node.js 20+ and Express
- Frontend: static HTML, CSS, and JavaScript served by Express
- Production hosting: Hostinger Node.js Web App
- Database: Supabase PostgreSQL
- Authentication: JWT with database-backed user/status verification
- Email: SMTP via Nodemailer

## Install and configure

```bash
npm install
copy backend\.env.example backend\.env
```

Set `DATABASE_URL` in `backend/.env` to the Supabase transaction-pooler connection string. No separate local web or database stack is required.

## Development

```bash
npm run dev
```

Open `http://localhost:5000/`. Express serves the frontend and `/api` from the same origin and connects directly to Supabase PostgreSQL.

## Production build

```bash
npm run build
```

The command validates the JavaScript, creates the Hostinger-ready application in `dist/`, and creates `hostinger-app.zip`.

## Hostinger Node.js deployment

Hostinger Node.js Web Apps require a Business or Cloud hosting plan. In hPanel:

1. Go to **Websites → Add Website → Deploy Web App**.
2. Choose **Upload your website files** and upload `hostinger-app.zip`.
3. Select **Express.js** with Node.js 20 or newer.
4. Set the entry file to `backend/server.js`.
5. Leave the output directory and build command blank.
6. Set the start command to `npm start`.
7. Add the variables from `backend/.env.production.example`.
8. Use Hostinger's **Database Connect Wizard → Supabase** to populate `DATABASE_URL`, then deploy.

Hostinger manages Node dependencies, the listening port, HTTPS routing, process restarts, and files outside `public_html`. Plain FTP is not a valid deployment path for this Express backend.

## Production architecture

```text
Browser
  -> Hostinger Express application
       -> static frontend
       -> /api
            -> Supabase PostgreSQL transaction pooler
            -> configured SMTP service
```

Database credentials stay in Hostinger environment variables and are never shipped to browser code.

## Important production requirements

- Set `NODE_ENV=production` and `TRUST_PROXY=1`.
- Set `APP_PUBLIC_URL` and `ALLOWED_ORIGINS` to the exact Hostinger HTTPS origin.
- Configure a unique `JWT_SECRET` containing at least 32 characters.
- Connect `DATABASE_URL` through Hostinger's Supabase Database Connect Wizard.
- Configure SMTP or Resend before production startup.
- Validate violation definitions, penalties, dispute periods, and payment periods with the authorized LGU office.
- Complete backup, restore, security, and end-to-end acceptance tests before go-live.

## Useful commands

```bash
npm run dev          # Run the full frontend and API locally
npm run check        # Validate all JavaScript
npm run preflight    # Validate local environment and required files
npm run verify       # Run check and preflight
npm run create-admin # Create or reset the first Administrator
npm run build        # Create dist/ and hostinger-app.zip
npm start            # Hostinger production start command
```

## Development URLs

```text
Public portal:  http://localhost:5000/
Officer login:  http://localhost:5000/pages/login.html
Backend health: http://localhost:5000/api/health
```

## Project structure

```text
package.json             Canonical development and production manifest
scripts/build.js         Hostinger archive builder
frontend/
  pages/                 Public and authenticated interfaces
  assets/css/            Shared styles
  assets/js/             Same-origin API and page logic
  app-config.js          Optional runtime API-origin override
backend/
  server.js              Express entry point and static frontend server
  controllers/           Business logic
  routes/                API routes and authorization
  middleware/            Authentication, authorization, rate limits
  models/database.postgres.sql
                          Supabase PostgreSQL schema
```

## Final acceptance

Do not approve public deployment until every required item in `DEPLOYMENT_CHECKLIST.md` is signed off, especially ticket issuance, repeat-offender lookup, evidence access, partial/full payment, dispute approval/rejection, reports, account lock/unlock, password reset, backups, and restore testing.