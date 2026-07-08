# Security Documentation & Audit Checklist

## Controls built into the system

| Area | Control |
|---|---|
| Credential storage | scrypt (N=16384, r=8) with per-credential salt; PINs hashed the same way — nothing reversible in the DB |
| Sessions | HMAC-SHA256 signed tokens with expiry (`SESSION_MINUTES`, default 8h); constant-time comparison |
| Brute force | 5 failed logins → 15-minute lockout per account |
| Authorization | Role gates on every endpoint (server-side; the UI only *hides*); tenant scoping by school on every query; parents/students pass an ownership check (`studentAccessOk`) before reading any student-linked record |
| Sensitive fields | OVC / pregnancy / medical fields writable by admins only, never exposed in the portal |
| Injection | All SQL is parameterized (no string concatenation of values); custom report builder whitelists tables, fields and operators |
| XSS | All dynamic HTML escaped client-side (`UI.esc`); strict CSP (`script-src 'self'`, no inline handlers anywhere, no external origins); `X-Content-Type-Options`, `X-Frame-Options: DENY` |
| Audit | Immutable `audit_log` row per successful mutation (user, role, action, entity, sanitized body — passwords/PINs stripped, IP) |
| Idempotency | `X-Op-Id` replay guard prevents duplicate financial records from offline retries |
| Uploads | Photos only, data-URL parsed with format whitelist, 300KB cap, stored outside the web-root static mapping |
| Errors | Stack traces logged server-side only; clients get generic messages |
| Backups | `VACUUM INTO` consistent snapshots, rotation of 30, manual USB export |
| Data in transit | Deploy behind TLS (Caddy/nginx — see SETUP.md); the PWA requires HTTPS in production anyway |
| Data at rest | Single SQLite file — for hostile-physical-access environments enable OS-level disk encryption (BitLocker/LUKS) on the school machine; cloud volumes encrypted by provider |
| Data ownership | Each school's data is exportable at any time (CSV + the SQLite file itself); no lock-in |

## Deliberate design choices to review per deployment

- **SMS content**: absence and fee SMS contain the child's name. If a deployment
  considers that sensitive over SMS, shorten templates in `routes/students.js` /
  `routes/finance.js`.
- **Default parent PIN** (last 4 digits of phone) trades security for
  achievable onboarding; parents are told to change it. For stricter setups,
  pass an explicit `pin` when registering guardians.
- **Offline cache**: the phone caches screens the user has opened (IndexedDB).
  A stolen *unlocked* phone exposes that cache; sessions expire and staff
  should use device locks. `localStorage` holds the token until expiry.

## Pre-go-live audit checklist

### Server
- [ ] `AUTH_SECRET` changed from default (server warns loudly if not)
- [ ] HTTPS terminates in front of the app; port 3000 not directly exposed
- [ ] `.env` file permissions 600; not committed to git
- [ ] Node.js version current (≥22.5) and OS patched
- [ ] `data/` on a disk with encryption enabled (local installs)
- [ ] Backup schedule verified AND a restore actually rehearsed
- [ ] Off-site backup routine assigned to a named person

### Accounts
- [ ] All demo/seed accounts removed or passwords rotated on real data
- [ ] Every staff member has an individual account (no shared logins)
- [ ] Departed staff deactivated (spot-check against payroll list)
- [ ] Super admin credentials stored in a sealed envelope / password manager
- [ ] County officer accounts scoped to their county only

### Application checks (rerun after upgrades)
- [ ] 403 on: teacher→payroll, parent→other child's statement, parent→OVC fields
- [ ] Lockout triggers after 5 bad logins
- [ ] Audit log captures a test payment with the right user
- [ ] Replayed X-Op-Id does not duplicate a payment
- [ ] CSP header present; no inline `onclick=` in served HTML (`grep -r onclick public/`)
- [ ] Custom report builder rejects a non-whitelisted table name
- [ ] Error responses leak no stack traces (`curl` a forced 500)

### Process
- [ ] Fee refund / correction procedure documented (void invoice + audit note — never delete)
- [ ] PIN-reset procedure requires identity verification at the office
- [ ] Incident contact (who to call if the server dies during exams) posted in the office
- [ ] Data-sharing with the Ministry limited to EMIS exports (aggregates + register), signed off by the principal
