# Contact Form Fix Report

Date verified: 2026-08-05 (Asia/Manila)

## Final status

```text
CONTACT FORM: PASS
PAGE RESPONSIVENESS: PASS
DOUBLE SUBMISSION PROTECTION: PASS
BACKEND CONNECTION: PASS
MOBILE TEST: PASS
```

The final acceptance test was executed in Microsoft Edge 151 through the browser's DevTools protocol against the real Apache-served landing page and the real Node.js API.

## Exact root cause

The browser freeze had two related causes in the original landing-page code:

1. A page-wide `MutationObserver` watched for newly inserted `[data-lucide]` elements and called `lucide.createIcons()`. Contact submission replaces the button contents with a loading icon. Lucide then replaces that icon with an SVG, which is itself a DOM mutation. Because the observer also matched the generated icon and called Lucide again, the observer could retrigger itself continuously. This caused repeated DOM creation on the browser's main thread and produced the “This page isn't responding” dialog.
2. When the contact API returned an error because SMTP was not configured, the old fallback assigned a `mailto:` URL to `window.location.href`. Edge attempted to launch a desktop mail protocol handler. On the affected machine that external handoff also became unresponsive and could reopen the failure path.

There was only one contact submit listener, and it already called `preventDefault()`. No recursive form submission, synchronous XMLHttpRequest, blocking `while` loop, or contact-related `setInterval` was present. The existing canvas `requestAnimationFrame` background was tested and was not the submission freeze source.

## Files changed

- `frontend/pages/landing.html`
  - Preserved the existing Contact markup, colors, layout, icons, and animation design.
  - Added field names/limits and required validation for full name, email, subject, and message.
  - Added `novalidate` so validation feedback uses the existing inline professional status area.
  - Added a single-flight `contactIsSubmitting` guard.
  - Disables the button synchronously and shows the existing Lucide loading icon.
  - Uses `AbortController` with a 12-second timeout.
  - Sends one asynchronous JSON request to `POST /api/public/contact`.
  - Resets the form only after a confirmed successful API response.
  - Always clears the timeout, re-enables the button, and restores button content in `finally`.
  - Removed the `mailto:` navigation fallback completely.
  - Fixed the Lucide `MutationObserver`: it now watches only unprocessed `i[data-lucide]` nodes and disconnects while Lucide replaces them, preventing recursive DOM mutations.
- `backend/controllers/publicController.js`
  - Uses the existing public `POST /api/public/contact` endpoint.
  - Accepts `full_name` (with legacy `name` compatibility), email, subject, and message.
  - Trims input, strips subject CR/LF characters, validates email and length limits, and returns JSON without stack traces.
  - Stores the message and creates notifications for every active Administrator in one transaction.
  - Returns success only after the database transaction commits and at least one active Administrator receives a notification.
  - Treats SMTP as an optional non-blocking copy; it does not claim that an email was delivered.
- `backend/models/database.sql`
  - Added the documented, additive `contact_messages` table. No existing table or record was removed.
- `backend/utils/autoMigrate.js`
  - Added a repeatable `CREATE TABLE IF NOT EXISTS contact_messages` startup migration.
- `backend/utils/emailService.js`
  - Optional email copies now include the validated subject and continue escaping HTML content.
- `backend/middleware/securityMiddleware.js`
  - Inspected but not changed. The existing `publicWriteLimiter` already protects `/api/public/contact` at eight submissions per 30 minutes, in addition to the global API limiter.
- `.htaccess`
  - Added no-cache headers for HTML so Apache does not serve the obsolete `mailto:` handler after a normal reload.
- `backend/scripts/contact-form-browser-test.js`
  - Added a dependency-free Microsoft Edge acceptance test using Node.js and the browser DevTools protocol.
- `CONTACT_FORM_FIX_REPORT.md`
  - This report.

## Endpoint behavior

Endpoint:

```text
POST /api/public/contact
Content-Type: application/json
```

Request fields:

```json
{
  "full_name": "Required, maximum 120 characters",
  "email": "Required valid email, maximum 190 characters",
  "subject": "Required, maximum 150 characters",
  "message": "Required, 10–3000 characters"
}
```

Successful submissions are stored in `contact_messages` and linked to an Administrator notification with type `contact`. Administrators can view them under **Admin Tools → Notifications**. When SMTP is configured, an optional email copy is also sent to `CONTACT_TO_EMAIL` (or `SMTP_USER` as fallback). SMTP is currently not configured, so no email-delivery claim is made.

## Tests performed

The browser test loaded:

```text
http://localhost/vehicle-violation-system-EASY-SETUP/frontend/pages/landing.html#contact
```

| Scenario | Result | Verified behavior |
|---|---|---|
| Empty form | PASS | Inline error; no POST; button enabled |
| Invalid email | PASS | Inline email error; no POST |
| Valid form | PASS | HTTP success from real endpoint; form reset afterward |
| Double submission | PASS | Exactly one POST (CORS preflight excluded from logical count) |
| Slow backend response | PASS | Loading indicator shown; page remained responsive; button recovered |
| Backend offline | PASS | Clear inline network error; no navigation; button recovered |
| Request timeout | PASS | Aborted at 12 seconds; timeout message shown; button recovered |
| Message over 3000 characters | PASS | Rejected before network request |
| Mobile viewport (375 × 812) | PASS | No horizontal overflow; form and button fit viewport |
| Repeated submissions | PASS | Later valid request sent once and reset normally |
| Browser console | PASS | Zero uncaught errors after page load |
| Duplicate form/listener audit | PASS | One form, one button, one submit listener |
| Admin visibility | PASS | Admin API returned linked contact notifications |
| Ticket Lookup | PASS | Existing `#search-card` navigation remains present |
| Officer Login | PASS | Existing `login.html` navigation remains present |

Real-browser result:

```json
{
  "emptyForm": "PASS",
  "invalidEmail": "PASS",
  "validSubmission": "PASS",
  "doubleSubmission": "PASS",
  "slowResponse": "PASS",
  "backendOffline": "PASS",
  "requestTimeout": "PASS",
  "longMessage": "PASS",
  "mobileViewport": "PASS",
  "repeatedSubmission": "PASS",
  "consoleErrors": 0,
  "contactRequests": 3
}
```

The seven labeled browser-validation messages created across diagnostic and final runs were preserved but changed to `archived`, and their linked test notifications were marked read. No existing operational record was deleted.

## Additional validation

- `npm.cmd run verify`: PASS
- JavaScript syntax validation: PASS
- Deployment preflight: PASS
- Apache landing page: HTTP 200
- HTML cache control: `no-cache, no-store, must-revalidate`
- Backend health: `healthy`
- Database health: `connected`
- `contact_messages` table: present
- Active Administrator notification delivery: PASS

## Remaining limitations and warnings

- SMTP is not configured, so external email copies are not sent. This does not prevent in-system delivery to Admin Notifications.
- The public submission limiter permits eight write attempts per IP every 30 minutes. This is intentional abuse protection.
- During testing, XAMPP MariaDB entered crash recovery and logged InnoDB future-LSN/corruption warnings. It completed recovery and is currently connected, but the database should be backed up promptly through a normal consistent MySQL backup. No database files were reset, replaced, or deleted during this fix.
- A browser tab that loaded the old JavaScript before this fix must be reloaded. HTML is now served with no-cache headers; use `Ctrl + F5` once on an already-open stale tab.
