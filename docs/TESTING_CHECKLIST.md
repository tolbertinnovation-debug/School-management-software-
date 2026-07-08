# Testing Checklist

Acceptance tests per module. Run against a seeded database (`npm run seed`).
Automated smoke tests cover the API happy paths; this list is for release
verification and UAT with real users.

## Authentication & security
- [ ] Staff login works; wrong password rejected with generic message
- [ ] 5 wrong passwords → account locks for 15 min (423)
- [ ] Parent login with phone + PIN; wrong PIN rejected
- [ ] Expired/absent token → 401 and redirect to login
- [ ] Teacher cannot open Fees/Payroll (client hides; API returns 403)
- [ ] Parent can only see own children (statement/report card of another student → 403)
- [ ] Parent cannot see OVC/pregnancy/medical fields anywhere
- [ ] Change password/PIN works; old credential stops working
- [ ] Audit log records every write with the acting user
- [ ] Session expires after configured minutes

## Module 1 — Students
- [ ] Enroll with only first+last name; student_no auto-generated with EMIS prefix
- [ ] Photo capture from phone camera; stored ≤300KB; shows in lists
- [ ] Add guardian with phone → parent user created; default PIN = last 4 digits
- [ ] Same guardian phone on second child → one account sees both children
- [ ] Roll call: mark all present, flip two to absent, save → absence SMS queued to guardians only for absentees
- [ ] Re-save same class+date with corrections → updated, not duplicated
- [ ] Attendance report over a date range matches marks; percentage chips correct
- [ ] Transfer out → status change + record; re-entry restores active + reentry_date
- [ ] Discipline entry hidden from portal when "visible to parent" unchecked
- [ ] CSV import creates rows, reports per-row errors; export downloads
- [ ] Transcript shows all published terms

## Module 2 — Academics
- [ ] Timetable insert overlapping same class → 409; same teacher other class same time → 409
- [ ] Assessment with max_score 0 → rejected
- [ ] Score above max rejected in bulk entry (rejected count returned)
- [ ] Gradebook: final = CA×0.4 + exam×0.6 (verify one student by hand)
- [ ] Change grading config (pass_mark, scale=waec) → recompute reflects it
- [ ] Generate report cards → rank consistent with averages; attendance days populated
- [ ] Publish → parents see card; SMS queued; unpublished cards invisible to parents
- [ ] Regenerating after publish keeps remarks, resets published flag only via publish
- [ ] Promotion bulk: promoted students move class; graduated become status=graduated
- [ ] National exam register accepts NPSE/LJHSCE/WASSCE only

## Module 3 — Staff & HR
- [ ] Staff attendance bulk save + correction
- [ ] Teacher creates leave (forced pending); admin approves; substitute gets SMS
- [ ] Teacher cannot approve own leave (403 path)
- [ ] Payroll generate: only school/volunteer staff; second run skips existing
- [ ] Editing allowances/deductions recomputes net; mark paid sets paid_date
- [ ] Payslip prints with school header

## Module 4 — Finance
- [ ] Fee structure per level; `*` applies to all
- [ ] Invoice generation: correct items per level, scholarship % deducted, rerun skips
- [ ] Payment: receipt_no sequential; invoice flips open→partial→paid at right thresholds
- [ ] Momo payment stores transaction reference; receipt SMS queued
- [ ] Amount ≤ 0 rejected; unknown method rejected
- [ ] Defaulters list = billed − paid > 0; reminder SMS queued once per guardian
- [ ] Reconcile marks payments; momo_status→confirmed
- [ ] Summary: income/expenses/net add up; collection rate = paid/billed
- [ ] Deleting/voiding an invoice removes it from balances (soft delete)

## Module 5 — Communication
- [ ] Bulk SMS to all_parents dedupes phones (one guardian, three children → one SMS)
- [ ] Class-scoped bulk SMS only hits that class's guardians
- [ ] Emergency alert reaches parents + staff
- [ ] Outbox export CSV; mark-sent transitions status
- [ ] Parent thread message visible to staff; parent cannot message about another's child
- [ ] Meeting confirmed → guardian SMS

## Module 6 — Transport
- [ ] Roster shows assigned students with stops
- [ ] Bus roll call saves per trip; re-save corrects
- [ ] Maintenance log entries listed with costs

## Module 7 — Library & inventory
- [ ] Lend decrements availability; lend at 0 copies → 409
- [ ] Return computes fine = days late × rate; second return → 409
- [ ] Overdue filter correct; low-stock list shows items ≤ reorder level

## Module 8 — Reports & EMIS
- [ ] Dashboard tiles match database counts
- [ ] EMIS enrollment CSV: grade×sex×age bands sum to totals
- [ ] Custom report builder: filters and grouping work; disallowed table/field rejected
- [ ] Year comparison returns a row per academic year

## Offline / PWA (critical path — test on a real low-end Android)
- [ ] Install to home screen; app opens with no network (cold start)
- [ ] Previously visited screens render offline with "saved copy" note
- [ ] Roll call offline → "saved offline" → back online → auto-sync, badge → 0
- [ ] Payment offline → syncs exactly once (check receipt list for duplicates)
- [ ] Same queued op replayed twice (kill app mid-sync) → still exactly once (X-Op-Id)
- [ ] Server rejects a queued op (e.g. deleted student) → user sees the reason, queue continues
- [ ] Login while offline after previous login → cached session still works
- [ ] Dark mode persists; battery drain acceptable over a school day

## Printing
- [ ] Report card, receipt, payslip, ID card each print via browser dialog
- [ ] Save-as-PDF works on Android Chrome
- [ ] Layout fits A4 and 58mm receipt printers (receipt uses narrow table)

## Backups & recovery
- [ ] Auto snapshot appears in data/backups on schedule
- [ ] Manual backup from Settings; file restorable by replacing school.db
- [ ] Restore test: copy snapshot over db, restart, data intact
