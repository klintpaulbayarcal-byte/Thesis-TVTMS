# Final Deployment-Candidate Changelog

## Public portal

- Preserved ticket-number and plate-number lookup.
- Removed public recent-ticket activity and unfinished sample announcements.
- Data-minimized public lookup responses.
- Added rate limits to public lookups and submissions.
- Loaded public violation definitions and penalties from the active database configuration.
- Applied professional icons, restrained motion, mobile behavior, and reduced-motion support.
- Extracted embedded images to reusable WebP assets.

## Authentication and users

- Restricted supported accounts to Administrator and Apprehending Officer.
- Removed default/public driver account behavior.
- Added database-backed session verification, strong passwords, lockout, secure reset tokens, account status checks, unlock support, and last-Administrator protection.
- Added a first-Administrator creation script; no credentials are shipped.

## Tickets and vehicles

- Added normalized plate matching, atomic ticket numbering, review/confirmation flow, repeat-offender search, penalty preview, soft cancellation with reason, ticket history, and officer scoping.
- Preserved penalty amount at issuance so later violation edits do not rewrite historical fines.

## Payments and disputes

- Reconciled payment schema/controller fields.
- Added transactional payments, unique official receipts, partial/full payment handling, remaining balance, overpayment rejection, future-date rejection, and active-dispute blocking.
- Added public dispute submission, deadline validation, duplicate-open-dispute prevention, Admin-only resolution, notification/email updates, and approved-dispute cancellation history.

## Evidence

- Unified evidence schema.
- Added 5 MB limit, type/signature validation, randomized storage names, path safety, GPS bounds, role/ticket authorization, and protected file streaming.
- Validated ticket-detail IDs, restricted evidence previews to generated object URLs, and revalidated map coordinates before constructing external map links.

## Reports, overview, and settings

- Revenue now uses actual non-voided payments.
- Corrected report date ranges, officer productivity, collection summaries, payment status, and CSV export safety.
- Kept officer dashboard statistics officer-scoped and escaped dynamic barangay/hotspot labels.
- Repaired malformed Admin Settings markup and implemented LGU identity, deadlines, and supported email toggles.
- Repaired Admin Overview response mappings and empty states.
- Removed unsupported payment-reminder setting from the UI.

## Deployment and security

- Added environment validation, health endpoint, CORS allowlist, Helmet, request IDs, body limits, rate limits, safe startup/migration, and preflight checks.
- Added `.gitignore`, `.env.example`, Apache access restrictions, root entry page, static syntax checker, deployment checklist, security audit, and test report.
- Removed the real `.env`, runtime uploads, default credentials, stale driver documentation, and deployment claims that were not technically supported.
