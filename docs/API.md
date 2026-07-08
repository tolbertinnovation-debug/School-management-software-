# API Reference

Base URL: `/api`. All bodies are JSON. All responses are JSON (CSV where noted).
Responses over 1KB are gzipped when the client sends `Accept-Encoding: gzip`.

## Authentication

Send `Authorization: Bearer <token>` on every request except login/health.
Tokens are HMAC-signed and expire after `SESSION_MINUTES` (default 8h).

```http
POST /api/auth/login              { "username": "principal", "password": "…" }
POST /api/auth/login-pin          { "phone": "+231776…", "pin": "1234" }      ← parents/students
```

```json
200 { "token": "…", "user": { "id": 2, "name": "…", "role": "school_admin", "school_id": 1 },
      "school": { "id": 1, "name": "…", "currency": "LRD" } }
401 { "error": "Wrong username or password" }
423 { "error": "Account locked. Try again in 15 minute(s)." }   ← after 5 failures
```

Also: `GET /auth/me`, `POST /auth/change-password {current,next}`,
`POST /auth/change-pin {current,next}`.

### Roles

`super_admin` (everything) · `county_officer` (read/oversight) · `school_admin` ·
`teacher` · `accountant` · `parent` · `student`. Each endpoint lists who may call
it; parents/students can only ever read records of students linked to them.

## Offline replay (important for client authors)

Every mutating request MAY carry an `X-Op-Id: <uuid>` header. The server stores
the first result per op-id and returns it verbatim on replays — so an offline
queue can retry safely without double-charging a payment or double-marking a
roll call.

Every generic list endpoint supports `?since=<ISO timestamp>` which returns rows
changed after that time **including soft-deleted rows** (`deleted: 1`) for cache
reconciliation, plus `limit`/`offset` and equality filters on listed fields.

## Generic CRUD contract

The resources in the table below all share this shape:

```http
GET    /api/<resource>?field=value&limit=100     → { data: [...], server_time }
GET    /api/<resource>/:id                        → { data: {...} }
POST   /api/<resource>                            → 201 { data: {...} }
PUT    /api/<resource>/:id                        → { data: {...} }
DELETE /api/<resource>/:id                        → { ok: true }        (soft delete)
```

| Resource | Write roles | Notable fields |
|---|---|---|
| `/students` | admin, teacher | see module section below |
| `/academics/classes` | admin | name, level (K1,K2,1-12), teacher_id, capacity |
| `/academics/subjects` | admin | name, code, level_group |
| `/academics/class-subjects` | admin | class_id, subject_id, teacher_id |
| `/academics/timetable` | admin | weekday 1-7, start/end_time — **409 on clash** (class or teacher double-booked) |
| `/academics/lesson-plans` | admin, teacher (own only) | title, week, body, term_id |
| `/academics/calendar` | admin | kind: holiday/exam/event/meeting/closure |
| `/academics/lost-days` | admin | date, days_lost, reason (strike/weather/emergency) |
| `/academics/years`, `/academics/terms` | admin | `is_current=1` auto-clears siblings |
| `/grades/assessments` | admin, teacher | kind: quiz/test/assignment/project/**exam**, max_score, weight |
| `/grades/national-exams` | admin | exam: NPSE/BECE/LJHSCE/LSHSCE/WASSCE, index_no, results_json |
| `/grades/questions` | admin, teacher | question bank |
| `/staff` | admin | qualification, payroll_type: government/school/volunteer, base_salary_cents |
| `/staff/leaves` | teacher (request), admin (approve) | approving with substitute_staff_id queues an SMS to the substitute |
| `/staff/payroll` | admin, accountant | allowances_json/deductions_json → net auto-computed |
| `/staff/evaluations`, `/staff/pd` | admin / admin+teacher | |
| `/finance/fee-structures` | admin, accountant | class_level ('*' = all), amount_cents, due_date |
| `/finance/invoices` | admin, accountant | items_json, discount_cents, status open/partial/paid/void |
| `/finance/scholarships` | admin, accountant | kind: percent/fixed, value |
| `/finance/expenses`, `/finance/budgets`, `/finance/donations` | admin, accountant | |
| `/comms/announcements` | admin, teacher | audience: all/parents/staff |
| `/comms/meetings` | admin, teacher, parent | confirming queues SMS to the guardian |
| `/transport/vehicles`, `/transport/routes`, `/transport/assignments`, `/transport/maintenance` | admin | |
| `/library/books`, `/library/assets`, `/library/procurements` | admin(+teacher for books) | |

## Module workflows (custom endpoints)

### Students

```http
POST /api/students                        # student_no auto-generated: <EMIS>-<year>-0001
POST /api/students/:id/photo              { "image": "data:image/jpeg;base64,…" }  ≤300KB
GET  /api/students/:id/guardians
POST /api/students/:id/guardians          { full_name, relation, phone, pin? }
     # creates the parent portal account keyed by phone; default PIN = last 4 digits
POST /api/students/:id/transfer           { kind: transfer_out|withdrawal|reentry, date, other_school, reason }
GET  /api/students/:id/transfers
GET  /api/students/:id/discipline         /  POST … { date, category, description, action, visible_to_parent }
GET  /api/students/:id/transcript         # all published term results
GET  /api/students/export/csv             # admin/county: full register download
POST /api/students/import                 { rows: [{first_name,last_name,gender,dob,class_name,…}] } ≤2000
```

### Attendance

```http
GET  /api/students/attendance/sheet?class_id=9&date=2026-07-08
POST /api/students/attendance/bulk
     { class_id, date, records: [{student_id, status: present|absent|late|excused, note?}] }
→    { ok, saved, absents, sms_queued }        # absence SMS to guardians queued automatically
GET  /api/students/attendance/report?from=…&to=…&class_id=…&student_id=…
```

### Grades & report cards

```http
GET  /api/grades/assessments/:id/scores            # class roster + existing scores
POST /api/grades/assessments/:id/scores            { scores: [{student_id, score}] }   # upsert; >max rejected
GET  /api/grades/gradebook?class_id=&term_id=      # computed CA/exam/final/letter/GPA + rank
POST /api/grades/report-cards/generate             { class_id, term_id, remarks?: {student_id: text} }
POST /api/grades/report-cards/publish              { class_id, term_id }   # freezes + SMS parents
GET  /api/grades/report-cards/:studentId/:termId   # full card (parents: published only, own child only)
POST /api/grades/promotions/bulk                   { from_class_id, to_class_id, year_id,
                                                     decisions: [{student_id, decision: promoted|retained|graduated|conditional}] }
```

Grading config is per school (`PUT /api/settings/kv/grading`):
`{ ca_weight: 0.4, exam_weight: 0.6, pass_mark: 70, scale: "liberian" | "waec" }`.

### Staff

```http
GET  /api/staff/directory/list
GET  /api/staff/attendance/sheet?date=…      /  POST /api/staff/attendance/bulk { date, records }
POST /api/staff/payroll/generate             { period: "2026-07" }   # drafts for school-funded staff
GET  /api/staff/payroll/:id/slip             # printable payslip data
```

### Finance

```http
POST /api/finance/invoices/generate    { term_id, class_id? }
     # bills every active student from the fee structure, applies scholarships, skips already-invoiced
GET  /api/finance/statement/:studentId       → { invoices, payments, billed_cents, paid_cents, balance_cents }
POST /api/finance/payments
     { student_id, invoice_id?, amount_cents, method: cash|bank|momo_mtn|momo_orange|cheque,
       reference?, payer_name?, phone? }
→ 201 { data: { receipt_no: "RCT-2026-00102", … } }
     # receipt SMS to guardians queued; with momo API keys + phone, initiates request-to-pay
GET  /api/finance/payments?from=&to=&method=
GET  /api/finance/payments/:id/receipt       # printable receipt data
POST /api/finance/payments/reconcile         { payment_ids: [] }
GET  /api/finance/defaulters?term_id=        → students with balance > 0
POST /api/finance/defaulters/remind          { student_ids, message? }   # {name} placeholder supported
GET  /api/finance/summary?from=&to=          → income, expenses, net, collection rate, cash_flow[], budgets
```

### Communication

```http
POST /api/comms/bulk-sms          { to: "all_parents" | "class:<id>" | "staff", body }  (or { phones: [] })
POST /api/comms/emergency         { body }        # URGENT SMS to every parent + staff member
GET  /api/comms/messages?status=queued
GET  /api/comms/messages/export-queued            # CSV for manual sending (offline schools)
POST /api/comms/messages/mark-sent               { message_ids }
POST /api/comms/threads           { thread_id?, to_user_id?, student_id?, body }   # two-way messaging
GET  /api/comms/threads
```

### Transport / Library

```http
GET  /api/transport/routes/:id/roster
POST /api/transport/bus-attendance/bulk   { route_id, date, trip: morning|afternoon, records: [{student_id, boarded}] }
GET  /api/library/search?q=math
POST /api/library/loans                   { book_id, student_id|staff_id, due_date }   # 409 when no copies
POST /api/library/loans/:id/return        → { ok, days_late, fine_cents }
GET  /api/library/loans?open=1&overdue=1
GET  /api/library/assets-low-stock
```

### Reports & EMIS

```http
GET  /api/reports/dashboard               # KPI tiles + enrollment by class
GET  /api/reports/enrollment              # by grade×sex, by county, welfare counts (OVC, re-entries)
GET  /api/reports/attendance-trends       # monthly, 24 months
GET  /api/reports/performance?term_id=    # avg % by class×subject×teacher
GET  /api/reports/year-comparison
GET  /api/reports/emis/enrollment|staff|register     # CSV downloads (MoE LEMIS-compatible)
GET  /api/reports/audit?user_id=&from=&to=
POST /api/reports/custom                  # report builder
     { table: students|attendance|payments|expenses|invoices|book_loans,
       fields: [], filters: [{field, op: eq|ne|gt|lt|gte|lte|like, value}],
       group_by?, from?, to? }
```

### Parent portal

```http
GET /api/portal/home          # one call: children (attendance/fees/report card), announcements, events
GET /api/portal/child/:id     # detail; 403 unless the student is linked to the caller
```

### Users & settings (admin)

```http
GET/POST /api/users            PUT /api/users/:id        POST /api/users/:id/reset-credential {password|pin}
GET/PUT  /api/settings/school
GET      /api/settings/kv      PUT /api/settings/kv/:key   (grading, notifications, language, …)
POST     /api/settings/backup  GET /api/settings/backups
GET      /api/health           # { ok, time, version } — used by clients to detect connectivity
```

## Errors

Always `{ "error": "human-readable message" }` with a fitting status:
400 validation, 401 unauthenticated, 403 role/ownership, 404, 409 conflict
(timetable clash, no book copies, already returned), 423 locked account,
5xx `{ "error": "Something went wrong. Try again." }` (details only in server logs).

## Audit

Every successful mutation is written to `audit_log` (user, role, action, entity,
sanitized body — passwords/PINs stripped, IP, timestamp). Admins and county
officers can read it via `/api/reports/audit`.
