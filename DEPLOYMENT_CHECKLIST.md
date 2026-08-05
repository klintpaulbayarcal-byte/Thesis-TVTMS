# Deployment and Go-Live Checklist

Mark every required item before public deployment.

## Governance and data

- [ ] Authorized LGU representative approved violation names, descriptions, penalties, demerit points, and escalation rules.
- [ ] Dispute and payment deadlines match current municipal policy/ordinance.
- [ ] Privacy notice and retention policy are published.
- [ ] Plate-number-only public lookup has documented LGU/privacy approval.
- [ ] Contact numbers, address, official email, and system title are configured in Admin Settings.

## Environment and infrastructure

- [ ] Production `.env` exists only on the server and contains no template/default secrets.
- [ ] `NODE_ENV=production`.
- [ ] Unique 32+ character `JWT_SECRET` configured.
- [ ] Dedicated least-privilege database user and strong password configured.
- [ ] Exact HTTPS `ALLOWED_ORIGINS` configured.
- [ ] HTTPS certificate and automatic renewal verified.
- [ ] Reverse proxy and `TRUST_PROXY` setting verified.
- [ ] Persistent evidence storage configured and writable only by the API service.
- [ ] SMTP and official sender verified.
- [ ] Node process automatic restart and log rotation configured.
- [ ] `/api/health` monitoring configured.

## Database and backup

- [ ] Pre-deployment database backup created.
- [ ] Schema import/migration completed without error.
- [ ] No unsupported legacy driver accounts remain.
- [ ] Initial administrator created; `INITIAL_ADMIN_PASSWORD` cleared.
- [ ] Scheduled database backup enabled.
- [ ] Scheduled evidence backup enabled.
- [ ] Restore test completed on a separate environment.

## Security validation

- [ ] Current online `npm audit` reviewed and acceptable.
- [ ] No `.env`, credentials, database dump, or evidence included in public web files.
- [ ] Direct browser request to `/backend/` is denied.
- [ ] Officer cannot open Admin pages or Admin-only API routes.
- [ ] Officer cannot view another officer’s ticket evidence.
- [ ] Public lookup does not return owner name, license number, email, address, evidence, or officer identity.
- [ ] Login lockout, inactive accounts, token expiry, and password reset tested.
- [ ] File type, signature, and 5 MB evidence limit tested.
- [ ] CORS rejects an unauthorized origin.
- [ ] Rate limiting tested for login, public lookup, dispute, and contact submission.

## End-to-end user acceptance testing

- [ ] Administrator login/logout.
- [ ] Apprehending Officer login/logout.
- [ ] Create, update, deactivate, unlock, and protect last Admin account.
- [ ] Create/update/deactivate violation definitions.
- [ ] Issue a ticket after final review.
- [ ] Ticket number uniqueness tested under repeated issuance.
- [ ] Existing vehicle and new vehicle workflow tested.
- [ ] Repeat-offender search by plate and license tested.
- [ ] Penalty preview/escalation verified against approved rules.
- [ ] Evidence upload/view and unauthorized-access denial tested.
- [ ] Plate lookup and ticket-number lookup tested on desktop/mobile.
- [ ] Partial payment, final payment, duplicate OR, overpayment, and future-date rejection tested.
- [ ] Active dispute blocks payment.
- [ ] Public dispute submission tested.
- [ ] Admin under-review, approve, reject, and close workflows tested.
- [ ] Approved dispute cancels an unpaid ticket and records history.
- [ ] Reports, PDF, CSV, analytics, filters, and date ranges verified.
- [ ] Email notice, payment confirmation, public contact, and password reset tested.
- [ ] Audit logs record critical actions and cannot be cleared in production.
- [ ] System Settings persist and appear in reports/emails.
- [ ] Responsive testing completed on target phones, tablets, and desktop browsers.

## Release

- [ ] Final ZIP/release checksum recorded.
- [ ] Rollback procedure documented.
- [ ] Responsible support contact assigned.
- [ ] Go-live date/time and maintenance window approved.
- [ ] Final sign-off completed by project team and authorized LGU representative.
