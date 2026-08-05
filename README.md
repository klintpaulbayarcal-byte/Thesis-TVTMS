# Municipal Traffic Violation Ticketing and Management System


## Easiest first-time local setup

For a Windows laptop with XAMPP, extract the project under `C:\xampp\htdocs\` and double-click `FIRST_TIME_SETUP.bat`. It prepares the environment, imports the database, installs packages, verifies the project, creates the first Administrator, starts the backend, and opens the landing page. See `START_HERE.txt`.

A web-based municipal traffic citation and records-management system developed for the Municipality of Calape, Bohol. The project includes a public portal, role-based internal dashboards, ticket issuance, repeat-offender lookup, payments, disputes, evidence, reports, notifications, settings, and audit trails.

## Deployment status

This package is a **final deployment candidate**, not a substitute for live acceptance testing. Static code checks passed, but the target server, production database, SMTP account, HTTPS configuration, and complete browser workflows must still be tested before public go-live. See `DEPLOYMENT_CHECKLIST.md` and `TEST_REPORT.md`.

## Supported roles

- **Administrator** — user/violation management, payments, disputes, reports, analytics, audit logs, and system settings.
- **Apprehending Officer** — ticket issuance, assigned ticket records, authorized vehicle lookup, evidence, notifications, and profile management.
- **Public user** — account-free ticket or plate lookup, public violation information, dispute submission, and contact form.

There are **no default accounts** and no public driver account. Create the first administrator through the provided setup script.

## Technology

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js 20+, Express
- Database: MySQL/MariaDB using `mysql2`
- Authentication: JWT with database-backed user/status verification
- Evidence: protected server-side file storage
- Email: SMTP via Nodemailer

## Local setup using XAMPP

1. Extract the project under:

   ```text
   C:\xampp\htdocs\vehicle-violation-system
   ```

2. Copy the environment template:

   ```bat
   copy backend\.env.example backend\.env
   ```

3. Edit `backend/.env` and set the database, a unique `JWT_SECRET` of at least 32 characters, allowed origins, public URL, and optional SMTP values.

4. Start Apache and MySQL in XAMPP.

5. Import once:

   ```text
   backend/models/database.sql
   ```

6. Install backend dependencies:

   ```bat
   cd backend
   npm ci
   ```

7. Create the initial administrator by temporarily setting these in `backend/.env`:

   ```env
   INITIAL_ADMIN_NAME=System Administrator
   INITIAL_ADMIN_EMAIL=admin@example.gov.ph
   INITIAL_ADMIN_PASSWORD=Use-A-Unique-Strong-Password!
   ```

   Then run:

   ```bat
   npm run create-admin
   ```

   Clear `INITIAL_ADMIN_PASSWORD` immediately afterward.

8. Validate and run:

   ```bat
   npm run check
   npm run preflight
   npm start
   ```

The Windows helper `OPEN_VVS.bat` performs package installation on first use, runs preflight, starts the API, and opens the portal. It will stop instead of reporting success when the backend fails.

## Production architecture

Recommended:

```text
Browser
  -> HTTPS web server/reverse proxy
       -> static frontend
       -> /api proxied to Node.js API
            -> dedicated MySQL database user
            -> persistent private evidence storage
            -> configured SMTP service
```

Use the same HTTPS origin for the frontend and `/api` when possible. Leave `frontend/app-config.js` with an empty API origin in that setup. When the API uses a separate HTTPS domain, set `window.APP_CONFIG.API_ORIGIN` to that exact origin and configure `ALLOWED_ORIGINS` accordingly.

Do not expose the `backend` directory through Apache. The included `backend/.htaccess` blocks direct web access when the project is under `htdocs`; production deployments should still place backend source and `.env` outside the public document root whenever possible.

## Important production requirements

- Set `NODE_ENV=production`.
- Use HTTPS only.
- Use a dedicated database account with a strong password and only required privileges.
- Store the real `.env` on the server only; never commit or share it.
- Configure a persistent volume for `backend/uploads/evidence`.
- Back up both the database and evidence files.
- Run the Node API with a process manager or managed service.
- Validate violation definitions, penalties, demerit points, dispute periods, and payment periods with the authorized LGU office before go-live.
- Obtain LGU/privacy approval for plate-number-only public lookup. It is rate-limited and excludes owner/license/contact/evidence data, but plate-based enumeration remains a residual privacy consideration.

## Useful commands

```bat
cd backend
npm run check          REM Static JavaScript syntax validation
npm run preflight      REM Environment and required-file validation
npm run verify         REM Syntax validation plus preflight
npm run create-admin   REM Create the first administrator
npm start              REM Start the API
npm audit              REM Current online dependency advisory check
```

## Main URLs in local XAMPP setup

```text
Public portal: http://localhost/<project-folder>/
API health:    http://localhost:5000/api/health
Officer login: http://localhost/<project-folder>/frontend/pages/login.html
```

## Project structure

```text
frontend/
  pages/                 Public and authenticated interfaces
  assets/css/            Shared styles
  assets/js/             API and page logic
  app-config.js          Runtime API origin
backend/
  controllers/           Business logic
  routes/                API routes and authorization
  middleware/            Authentication, authorization, rate limits
  models/database.sql    Canonical database schema and starter references
  scripts/               Preflight, syntax check, initial admin creation
  uploads/evidence/      Runtime evidence files; not included in source archives
```

## Final acceptance

Do not approve public deployment until every required item in `DEPLOYMENT_CHECKLIST.md` is signed off, especially ticket issuance, repeat-offender lookup, evidence access, partial/full payment, dispute approval/rejection, reports, account lock/unlock, password reset, backups, and restore testing.
