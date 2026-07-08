# School Administrator (Principal) Manual

You have full control of your school's data. This guide follows the order you'll
use at the start of a school year, then daily and termly routines.

## 1. First-time setup (once)

1. **Sign in** with the username and password given at installation.
   Immediately change your password: ⚙️ Settings → *Change my password*.
2. **School profile**: Settings → School profile. Fill in the school name,
   **EMIS code** (from the Ministry — used on all exports and student IDs),
   county, address, phone, principal name. Save.
3. **Academic year & semesters**: Settings → *Year & promotion* → *New academic
   year* (two semesters are created automatically; tick "make current"). The
   same screen switches the current semester at mid-year.
4. **Staff accounts**: Settings → Users & roles → *Add staff account*. Give
   every teacher and the bursar their own login — never share accounts, the
   audit trail depends on it. Passwords must be 8+ characters.
5. **Classes & subjects**: pre-loaded to the Liberian curriculum in the demo;
   adjust names/levels to match your school.
6. **Fee structure**: 💰 Fees → *Fee structure*. Add each fee (Tuition,
   Registration, PTA…) per grade level (use `*` for all levels), with amounts
   and due dates.

## 2. Enrolling students

- 🧑🏾‍🎓 Students → *Enroll student*. Only first and last name are required —
  you can complete the rest later. The **student ID is generated automatically**
  from your EMIS code.
- **Photo**: open the student → 📷 Photo → the phone camera opens; the app
  compresses the picture automatically (safe on slow connections).
- **Guardian**: open the student → *Add guardian*. Enter the phone number —
  this **creates the parent's portal login** (default PIN = last 4 digits of
  their phone; tell them to change it). The first guardian becomes the primary
  contact for SMS alerts.
- **Many students at once**: Students → *Import CSV* (template columns shown on
  screen). Export anytime with *Export*.
- **ID cards**: open the student → 🪪 ID card → print.

## 3. Daily routine

| When | What |
|---|---|
| Morning | ✅ Roll call (or confirm each teacher did theirs). Absences auto-SMS the guardians. |
| Morning | Staff → *Staff attendance today*. |
| Any time | Approve leave requests (Staff → Leave requests). Assigning a substitute sends them an SMS. |
| Office hours | Record fee payments (or the bursar does). Every payment prints a receipt and SMSes the guardian. |

## 4. Termly routine

1. **Before the term**: Fees → *Generate invoices* — bills every active student
   from the fee structure and applies scholarships automatically.
2. **During**: teachers enter CA scores; monitor 📊 Reports → performance.
3. **Exams**: teachers create "Semester Exam" assessments and enter scores.
4. **Report cards**: 📝 Grades → pick class + term → *Generate report cards* →
   review with *Computed grades* → **Publish + SMS parents**. Publishing freezes
   the cards and notifies every guardian. Print copies from Report cards.
5. **Promotion** (year end): Settings → *Year & promotion* → pick the class and
   the target class → load students → set each to Promote / Retain /
   Conditional / Graduate → Apply. Promoted students move class immediately;
   graduates leave the active roll.
6. **Ministry reporting**: 📊 Reports → EMIS CSV downloads (enrollment, staff,
   register) — email them or hand a USB stick to the County Education Office.

## 5. Money oversight

- 📊 Reports shows income vs expenditure, monthly cash flow, expenses by
  category, and the fee **collection rate**.
- Fees → defaulter list → *SMS reminder to all* before due dates.
- Every financial action is in the **audit log** (Reports → Audit) — who
  recorded what, when.
- Payroll: Staff → Payroll → *Generate drafts* monthly for school-funded staff;
  review, mark paid, print payslips. Government-payroll teachers are tracked
  but not paid through the system.

## 6. Communication

- 💬 Communication → *Bulk SMS* (all parents, one class, or staff).
- *New announcement* posts to the parent portal.
- 🚨 *Emergency alert* SMSes every parent AND staff member — closures only.
- **No SMS gateway?** Messages wait in the outbox. Export them as CSV and send
  from any phone, then *Mark all queued as sent*.

## 7. Protecting your data

- The system backs itself up daily. **Weekly:** Settings → *Backup now*, then
  copy the newest file in `data/backups/` to a USB stick kept off-site.
- Never share the admin password. Deactivate accounts of staff who leave
  (Settings → Users — you cannot deactivate yourself).
- The phone app works offline; anything staff enter offline uploads by itself —
  the 📶 icon shows what is still waiting.

## 8. Welfare tracking (confidential)

OVC (orphaned/vulnerable) flags, pregnancy & re-entry tracking and medical
notes are **visible to administrators only** — teachers cannot set them and
parents never see them. Counts (not names) appear in Reports for Ministry
programs. Use Students → edit → OVC checkbox, and the Transfer/Withdraw →
*Re-entry* action when a girl returns to school.
