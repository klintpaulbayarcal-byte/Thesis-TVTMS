# Supabase backend setup

The Express backend uses the Supabase HTTPS API. Existing accounts, bcrypt
passwords, JWT sessions, and frontend endpoints remain in place. PostgreSQL
passwords, local database servers, and DATABASE_URL are not used.

## Configure

Use Node.js 22 or newer. Run `npm install`, then copy `backend/.env.example` to
`backend/.env` if that file does not already exist. Configure:

```dotenv
SUPABASE_URL=https://cwrhxvrmnfmzuxotsjrw.supabase.co
SUPABASE_SECRET_KEY=your-server-secret-key
```

Get the URL and secret key from the project's Supabase dashboard API settings.
A legacy service-role JWT may instead be set as `SUPABASE_SERVICE_ROLE_KEY`.
Publishable keys and database passwords cannot replace the server secret key.
Keep credentials in the ignored environment file or hosting environment. Never
put them in frontend JavaScript, screenshots, logs, or version control.

Retain a strong `JWT_SECRET`. SMTP configuration is independent of database
access; password reset and notification email require a working mail provider.

## Schema and migrations

For an empty project, apply `backend/models/database.postgres.sql` first.
For the existing project, retain the existing tables and data. Apply the files
in `supabase/migrations/` in filename order through the Supabase SQL editor or
the Supabase migration tooling. Track each migration exactly once. The baseline
schema intentionally denies API access, so do not rerun it after API migrations.

The API access migration grants the Express server's service role access to app
tables. Anonymous and authenticated browser roles remain denied. Business RPC
functions have fixed SQL and are callable only by the service role. Multi-step
ticket, payment, dispute, and account operations execute in one transaction.

## Run and verify

```sh
npm run verify
npm test
npm run dev
```

Open `http://localhost:5000/`. `GET /api/health` must report
`database: "connected"` and `databaseClient: "supabase"`. A 401 from Supabase
means the key was rejected; permission errors indicate missing grants/migrations.
With the server running, `npm run smoke` checks public routes, backend reads,
and administrator/officer session permissions without changing records. It
requires existing active administrator and officer accounts and uses the local
JWT signing secret; it does not test an interactive password login.

Tests use disposable PostgreSQL instances in memory. They do not create local
database files or require a database server. Browser scripts that create fixtures
should be run only against a dedicated test project, not live municipal data.

## Deployment and updates

Run `npm run build`. Upload `hostinger-app.zip` through Hostinger hPanel's
Deploy Web App flow, use `backend/server.js` as the entry point and `npm start`
as the start command. Configure the variables from
`backend/.env.production.example` in the hosting environment.

For updates, back up live data, review and apply new Supabase migrations, deploy
the matching backend, then verify health, login, ticket reads and report output.
Do not provision or reset existing administrator accounts as a connectivity test.
