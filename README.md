# Ma Weade School Suite 🏫

**Offline-first school management software built for schools in Liberia.**

Runs on a single low-cost server (or a laptop in the principal's office), is used
from any smartphone browser as an installable app (PWA), and keeps working when
the internet and electricity do not.

> *"Ma Weade"* — built to serve every school, from a K-6 community school in Lofa
> to a 12-grade academy in Monrovia.

## Why it fits Liberia

| Constraint | How the suite handles it |
|---|---|
| Unreliable / no internet | Full offline mode: screens are cached on the phone, roll call / scores / payments queue locally and sync automatically |
| Limited electricity | Dark mode, no heavy animations, tiny payloads (gzip, text-first UI) |
| Low-end Android phones | No frameworks, ~60KB of JavaScript total, works on 1GB-RAM devices |
| Parents use basic phones | Parent portal login = **phone number + PIN**; every alert also goes out as SMS |
| No SMS gateway contract yet | SMS **outbox** mode: export queued messages as CSV and send from any phone, or plug in Twilio / Orange / Lonestar MTN later |
| Mobile money | Record Lonestar MTN MoMo & Orange Money payments with transaction IDs (manual reconciliation), or enable provider APIs when you have merchant keys |
| Ministry reporting | One-click **EMIS CSV exports** (enrollment by grade/sex/age, staff, register) |
| Printing | Report cards, receipts, payslips and ID cards print via the browser to any USB/Bluetooth printer, or save as PDF |

## Feature map

- **Students** — enrollment with photo capture, QR/barcode ID cards, guardians, transfers/withdrawals, discipline log, medical & immunization records, OVC and pregnancy re-entry tracking, CSV import/export
- **Attendance** — tap roll call, mark-all-present, automatic SMS absence alerts, daily→yearly reports
- **Academics** — Liberian-curriculum classes/subjects, teacher assignments, timetable with clash detection, lesson plans, CA + exam gradebook (40/60 configurable), Liberian & WAEC grading scales, report card generation/publication with SMS notice, transcripts, promotion workflow, WAEC exam registers (NPSE/LJHSCE/WASSCE), academic calendar, lost-instruction-time log
- **Staff & HR** — qualifications (C/B/A certificates, degrees), government vs school payroll tracking, staff attendance, leave workflow with substitute SMS, payslips, evaluations, professional development
- **Finance** — fee structures per level/term, bulk invoice generation, scholarships & discounts, cash/bank/mobile-money receipts (printed + SMS), defaulter tracking with SMS reminders, expenses, budgets, donations/grants, income vs expenditure, cash flow, reconciliation, full audit trail
- **Communication** — parent portal, two-way in-app messages, announcements, bulk SMS, automated triggers (absence, fees due, report cards, meetings, emergency closure)
- **Transport** — routes/stops, vehicles & drivers, bus roll call, maintenance log
- **Library & inventory** — catalog search, lending with overdue fines, asset register, low-stock alerts, procurement
- **Reports & EMIS** — dashboard KPIs, enrollment/attendance/performance/finance analytics, custom report builder, EMIS exports, year-over-year comparison, audit log
- **Security** — role-based access (7 roles), scrypt-hashed credentials, signed sessions with timeout, login lockout, soft deletes, automatic + manual backups (USB-copyable)

## Quick start (5 minutes)

Requires **Node.js ≥ 22.5** (uses the built-in SQLite — no build tools needed).

```bash
npm install          # installs the one dependency (express)
npm run seed         # loads a demo Liberian school with 128 students
npm start            # http://localhost:3000
```

Demo logins:

| Role | Username / phone | Password / PIN |
|---|---|---|
| Principal (School Admin) | `principal` | `Principal#2026` |
| Bursar (Accountant) | `bursar` | `Bursar#2026` |
| Teacher | `eflomo` | `Teacher#2026` |
| County Education Officer | `ceo.montserrado` | `County#2026` |
| Super Admin | `superadmin` | `SuperAdmin#2026` |
| Parent portal | any guardian phone (open a student → Guardians) | `1234` |

Open it on a phone on the same Wi-Fi and choose **"Add to Home screen"** — it
installs like an app and keeps working offline.

## Documentation

| Doc | Contents |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Cloud deployment, school local server, fully-offline install |
| [docs/API.md](docs/API.md) | Every endpoint with request/response examples |
| [docs/DATABASE.md](docs/DATABASE.md) | ER diagram + schema notes |
| [docs/user-manuals/](docs/user-manuals/) | Step-by-step guides per role (admin, teacher, bursar, parent) |
| [docs/TRAINING.md](docs/TRAINING.md) | Quick-start cards + video script outlines |
| [docs/TESTING_CHECKLIST.md](docs/TESTING_CHECKLIST.md) | Module-by-module acceptance tests |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | Security controls + pre-go-live audit checklist |
| [docs/SCALABILITY.md](docs/SCALABILITY.md) | School → county → national rollout plan |

## Project layout

```
server/            Express API (Node 22, built-in SQLite, zero native deps)
  db/              schema.sql, migrate, seed, backup
  routes/          one file per module
  services/        grading engine, SMS outbox/gateways, mobile money, EMIS export
  middleware/      auth, RBAC, audit trail
public/            PWA (no build step): service worker, IndexedDB offline queue
docs/              all documentation
scripts/           icon generator and utilities
```

## License

MIT — free for public schools. See [docs/SCALABILITY.md](docs/SCALABILITY.md)
for the suggested freemium hosting model.
