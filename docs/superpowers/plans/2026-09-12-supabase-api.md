# Supabase API migration implementation plan

Approved design: retain Express routes, existing accounts, bcrypt passwords and
JWT login; replace direct PostgreSQL connections with server-only Supabase API
access. Preserve live data and atomic business operations. Remove obsolete
database dependencies and local connection settings, retaining SQL migrations.

Execution uses the subagent-driven-development workflow with bounded controller
ownership. Existing unrelated working-tree changes must remain untouched. No
commits, publication, password resets, or production test records are authorized.

## Shared interfaces

`backend/config/supabase.js` exports `supabase` (SDK client), `run(query)`
(returns data or throws a normalized error), `rpc(name, args)` (same semantics),
and `allRows(makeQuery)` (paginates a fresh query builder for every page).
Backend-only RPC functions use the `tvtms_` prefix, explicit arguments and fixed
SQL, with EXECUTE restricted to service_role. No arbitrary SQL gateway.
Transactional functions return domain errors or raise exceptions before writes;
unexpected failures roll back the entire request.

## Tasks and verification

- [ ] Core: test configuration and error normalization with node:test, introduce
  the Supabase SDK, replace health/startup checks and environment preflight.
- [ ] Tickets: migrate ticket reads and atomic ticket mutation functions;
  preserve numbering, owner snapshots, escalation, status rules and deletion.
- [ ] Payments/disputes/public: migrate reads and atomic writes preserving
  payment limits, dispute deadlines, audit history and notification behavior.
- [ ] Accounts/catalog: migrate authentication, user administration, vehicles,
  violations, settings, evidence and notifications; retain route contracts.
- [ ] Reports/utilities/scripts: migrate aggregation reports with fixed RPCs,
  audit/email helpers and admin provisioning. Update or retire old SQL test
  harnesses in favor of meaningful API/transaction coverage.
- [ ] Integration: inspect existing grants and apply additive migrations only;
  grant the backend service role required access while keeping anon and
  authenticated roles denied. Remove pg and obsolete local settings.
- [ ] Validate: syntax, unit tests, build, repository validation, remote read-only
  API probes, transaction rollback tests on an isolated fixture database where
  available, server health, browser console/network checks, then
  `codex review --uncommitted`. Resolve actionable findings before completion.

## Rulings and evidence

- Work in the current checkout: this task is explicitly for the user's running
  project and depends on its ignored credentials. Preserve all unrelated edits.
- There are no local database files to delete; the existing PostgreSQL schema
  is deployment source and remains as the baseline for Supabase migrations.
- A valid server key is present. Initial REST probe authenticated but returned
  permission denied, consistent with revoked service_role table privileges.
