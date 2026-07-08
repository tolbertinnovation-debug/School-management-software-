# Bursar / Accountant Manual

You manage fees, payments, expenses and payroll. Your home screen shows Fees,
Expenses and Reports.

## 1. Start of term

1. Confirm the **fee structure** with the principal: Fees → *Fee structure* —
   each item, grade level (`*` = all), amount, due date.
2. **Scholarships/discounts** must be recorded *before* invoicing (they apply
   automatically): ask the admin to add them, or use the scholarships screen.
3. Fees → **Generate invoices** — one invoice per active student, scholarships
   deducted, already-invoiced students skipped (safe to re-run).

## 2. Taking payments (the everyday job)

Fees → **Record payment** (or *Pay* next to a name in the defaulter list):

1. Pick the student — their current balance shows.
2. Enter the amount and the **method**:
   - **Cash** — count it, record it.
   - **Lonestar MTN MoMo / Orange Money** — ask for the **transaction ID from
     the confirmation SMS** and type it as the reference. This is what makes
     reconciliation possible.
   - **Bank** — deposit slip number as reference.
3. Save. The system prints an **official receipt** (browser print → works with
   USB/Bluetooth printers or Save as PDF) and SMSes a receipt to the guardian.

Receipt numbers (`RCT-2026-00042`) are sequential and cannot be reused —
missing numbers in the sequence are an audit red flag, which protects you.

**Offline?** Record it anyway — it says "saved offline"; the receipt prints
after it syncs. Never turn a parent away because the network is down.

## 3. Weekly reconciliation

1. Get the mobile-money statement (agent printout or app) and the bank statement.
2. Fees → payment list → tick each payment found on the statement →
   *Reconcile*. Unreconciled momo/bank payments older than a week need
   investigation.
3. Reports → check the month's income vs what's in the cash box + accounts.

## 4. Chasing defaulters

Fees shows every student with a balance, biggest first. Before due dates:
**SMS reminder to all** — polite reminder to every guardian (or pick students).
The message log is in Communication.

## 5. Expenses & budget

- 📉 Expenses → *Record expense* — date, category, description, who was paid.
  Keep the paper voucher; the entry number ties them together.
- The budget vs actual and expenses-by-category views are in 📊 Reports.
- Donations and grants are recorded separately (restricted funds keep their
  earmark).

## 6. Payroll (school-funded staff only)

Monthly: Staff → Payroll → set the month → **Generate drafts** → open each
slip to add allowances/deductions (net recomputes automatically) → *Mark paid*
when money is handed over → print payslips. Government-payroll teachers are
outside this — the school only tracks that they exist.

## 7. Golden rules

- **Every** leone in or out goes into the system the same day.
- Never share your login; every entry carries your name in the audit log.
- The reference field on momo/bank payments is not optional in practice.
- Month-end: print (or PDF) the financial summary for the principal and PTA.
