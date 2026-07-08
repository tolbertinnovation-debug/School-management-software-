'use strict';
const express = require('express');
const { all, get, run, tx } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole, schoolScope, studentAccessOk } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');
const sms = require('../services/sms');
const momo = require('../services/momo');

const router = express.Router();
const FIN = ['school_admin', 'accountant'];
const FIN_READ = ['school_admin', 'accountant', 'county_officer'];

router.use('/fee-structures', makeResource({
  table: 'fee_structures',
  fields: ['school_id', 'term_id', 'class_level', 'name', 'amount_cents', 'currency', 'due_date', 'optional'],
  readRoles: R.ALL_STAFF, writeRoles: FIN,
  orderBy: 'class_level, name',
  beforeWrite(req, data) {
    if (data.amount_cents !== undefined && !(Number(data.amount_cents) >= 0)) {
      throw { status: 400, message: 'amount_cents must be zero or more' };
    }
  },
}));

router.use('/scholarships', makeResource({
  table: 'scholarships',
  fields: ['school_id', 'student_id', 'name', 'kind', 'value', 'term_id', 'notes'],
  readRoles: FIN_READ, writeRoles: FIN,
}));

function nextNumber(table, column, schoolId, prefix) {
  const row = get(
    `SELECT ${column} AS n FROM ${table} WHERE school_id = ? AND ${column} LIKE ? ORDER BY id DESC LIMIT 1`,
    schoolId, prefix + '%');
  const seq = row ? parseInt(row.n.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(seq).padStart(5, '0');
}

// ------------------------------------------------------------- invoices
// Bulk-generate invoices for a term from the fee structure, applying
// per-student scholarships/discounts. { term_id, class_id? }
router.post('/invoices/generate', requireRole(...FIN), (req, res) => {
  if (opGuard(req, res)) return;
  const { term_id, class_id } = req.body || {};
  if (!term_id) return res.status(400).json({ error: 'term_id required' });
  const schoolId = req.user.school_id;
  let studentSql = `SELECT s.id, s.class_id, c.level FROM students s
                     LEFT JOIN classes c ON c.id = s.class_id
                    WHERE s.school_id = ? AND s.deleted = 0 AND s.status = 'active'`;
  const params = [schoolId];
  if (class_id) { studentSql += ' AND s.class_id = ?'; params.push(class_id); }
  const students = all(studentSql, ...params);
  const fees = all(
    `SELECT * FROM fee_structures WHERE school_id = ? AND term_id = ? AND deleted = 0 AND optional = 0`,
    schoolId, term_id);
  const scholarships = all(
    `SELECT * FROM scholarships WHERE school_id = ? AND deleted = 0 AND (term_id IS NULL OR term_id = ?)`,
    schoolId, term_id);
  const scholByStudent = {};
  for (const sc of scholarships) (scholByStudent[sc.student_id] ||= []).push(sc);

  let created = 0, skipped = 0;
  const year = new Date().getFullYear();
  tx(() => {
    for (const st of students) {
      const existing = get(
        `SELECT id FROM invoices WHERE student_id = ? AND term_id = ? AND deleted = 0 AND status != 'void'`,
        st.id, term_id);
      if (existing) { skipped++; continue; }
      const items = fees
        .filter(f => f.class_level === '*' || f.class_level === String(st.level))
        .map(f => ({ name: f.name, cents: f.amount_cents }));
      if (!items.length) { skipped++; continue; }
      const total = items.reduce((s, i) => s + i.cents, 0);
      let discount = 0, discountReason = null;
      for (const sc of scholByStudent[st.id] || []) {
        discount += sc.kind === 'percent' ? Math.round(total * sc.value / 100) : Math.round(sc.value);
        discountReason = sc.name;
      }
      discount = Math.min(discount, total);
      const dueDates = fees.map(f => f.due_date).filter(Boolean).sort();
      run(
        `INSERT INTO invoices (uuid, school_id, student_id, term_id, invoice_no, items_json,
           total_cents, discount_cents, discount_reason, due_date, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,'open',?)`,
        uuid(), schoolId, st.id, term_id, nextNumber('invoices', 'invoice_no', schoolId, `INV-${year}-`),
        JSON.stringify(items), total, discount, discountReason, dueDates[0] || null, req.user.id);
      created++;
    }
  });
  const result = { ok: true, created, skipped };
  opRecord(req, result);
  res.json(result);
});

router.use('/invoices', makeResource({
  table: 'invoices',
  fields: ['school_id', 'student_id', 'term_id', 'invoice_no', 'items_json', 'total_cents',
    'discount_cents', 'discount_reason', 'currency', 'due_date', 'status'],
  readRoles: R.ALL_STAFF, writeRoles: FIN,
  beforeWrite(req, data, existing) {
    if (!existing) {
      if (!data.invoice_no) data.invoice_no = nextNumber('invoices', 'invoice_no', req.user.school_id, `INV-${new Date().getFullYear()}-`);
      if (data.items_json) {
        const items = JSON.parse(data.items_json);
        data.total_cents = items.reduce((s, i) => s + (Number(i.cents) || 0), 0);
      }
      data.created_by = req.user.id;
    }
  },
}));

// Student fee statement: invoices, payments, balance
router.get('/statement/:studentId', requireRole(...R.EVERYONE), (req, res) => {
  if (!studentAccessOk(req, req.params.studentId)) return res.status(403).json({ error: 'Not your student record' });
  const invoices = all(
    `SELECT i.*, t.name AS term_name FROM invoices i
      LEFT JOIN terms t ON t.id = i.term_id
     WHERE i.student_id = ? AND i.deleted = 0 AND i.status != 'void' ORDER BY i.id`,
    req.params.studentId);
  const payments = all(
    `SELECT * FROM payments WHERE student_id = ? AND deleted = 0 ORDER BY date`, req.params.studentId);
  const billed = invoices.reduce((s, i) => s + i.total_cents - i.discount_cents, 0);
  const paid = payments.reduce((s, p) => s + p.amount_cents, 0);
  res.json({
    invoices: invoices.map(i => ({ ...i, items: JSON.parse(i.items_json) })),
    payments,
    billed_cents: billed, paid_cents: paid, balance_cents: billed - paid,
  });
});

// ------------------------------------------------------------- payments
// Record a payment. For momo methods with API keys configured, this can also
// initiate a request-to-pay; default is manual recording with the momo
// transaction ID as the reference.
router.post('/payments', requireRole(...FIN), async (req, res) => {
  if (opGuard(req, res)) return;
  const { student_id, invoice_id, amount_cents, method, reference, payer_name, date, phone } = req.body || {};
  if (!student_id || !amount_cents || !method) {
    return res.status(400).json({ error: 'student_id, amount_cents and method are required' });
  }
  if (!(Number(amount_cents) > 0)) return res.status(400).json({ error: 'Amount must be greater than zero' });
  if (!['cash', 'bank', 'momo_mtn', 'momo_orange', 'cheque', 'other'].includes(method)) {
    return res.status(400).json({ error: 'Unknown payment method' });
  }
  const schoolId = req.user.school_id;
  const receiptNo = nextNumber('payments', 'receipt_no', schoolId, `RCT-${new Date().getFullYear()}-`);

  let momoStatus = null;
  if (method.startsWith('momo_') && momo.apiAvailable(method) && phone) {
    const r = await momo.requestToPay({
      method, phone, amountCents: Number(amount_cents),
      currency: 'LRD', reference: receiptNo,
    });
    momoStatus = r.status || null;
    if (r.status === 'failed') {
      return res.status(502).json({ error: `Mobile money request failed: ${r.error}. You can still record the payment manually with the transaction ID.` });
    }
  }

  const payment = tx(() => {
    const info = run(
      `INSERT INTO payments (uuid, school_id, invoice_id, student_id, receipt_no, amount_cents,
         method, reference, momo_status, payer_name, date, received_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uuid(), schoolId, invoice_id || null, student_id, receiptNo, Number(amount_cents),
      method, reference || null, momoStatus, payer_name || null,
      date || new Date().toISOString().slice(0, 10), req.user.id);
    // update invoice status
    if (invoice_id) {
      const inv = get('SELECT * FROM invoices WHERE id = ?', invoice_id);
      if (inv) {
        const paid = get('SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE invoice_id = ? AND deleted = 0', invoice_id).s;
        const due = inv.total_cents - inv.discount_cents;
        const status = paid >= due ? 'paid' : paid > 0 ? 'partial' : 'open';
        run(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, invoice_id);
      }
    }
    return get('SELECT * FROM payments WHERE id = ?', info.lastInsertRowid);
  });

  // SMS receipt to guardians
  const st = get('SELECT first_name, last_name FROM students WHERE id = ?', student_id);
  const school = get('SELECT name, currency FROM schools WHERE id = ?', schoolId);
  sms.notifyGuardians(student_id, 'receipt',
    `${school.name}: payment of ${(amount_cents / 100).toFixed(2)} ${school.currency} received for ${st.first_name} ${st.last_name}. Receipt ${receiptNo}. Thank you.`,
    schoolId);

  req.auditEntity = 'payments'; req.auditEntityId = payment.id;
  const result = { data: payment };
  opRecord(req, result);
  res.status(201).json(result);
});

router.get('/payments', requireRole(...FIN_READ), (req, res) => {
  const { from, to, method, student_id } = req.query;
  let sql = `SELECT p.*, s.first_name, s.last_name, s.student_no, u.full_name AS received_by_name
               FROM payments p JOIN students s ON s.id = p.student_id
               LEFT JOIN users u ON u.id = p.received_by
              WHERE p.deleted = 0 AND p.school_id = ?`;
  const params = [schoolScope(req)];
  if (from) { sql += ' AND p.date >= ?'; params.push(from); }
  if (to) { sql += ' AND p.date <= ?'; params.push(to); }
  if (method) { sql += ' AND p.method = ?'; params.push(method); }
  if (student_id) { sql += ' AND p.student_id = ?'; params.push(student_id); }
  sql += ' ORDER BY p.date DESC, p.id DESC LIMIT 1000';
  res.json({ data: all(sql, ...params) });
});

// Receipt detail for printing
router.get('/payments/:id/receipt', requireRole(...R.EVERYONE), (req, res) => {
  const p = get(
    `SELECT p.*, s.first_name, s.last_name, s.student_no, c.name AS class_name,
            u.full_name AS received_by_name
       FROM payments p JOIN students s ON s.id = p.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN users u ON u.id = p.received_by
      WHERE p.id = ? AND p.deleted = 0`, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (!studentAccessOk(req, p.student_id)) return res.status(403).json({ error: 'Not your receipt' });
  const school = get('SELECT name, address, county, phone, motto, currency FROM schools WHERE id = ?', p.school_id);
  res.json({ receipt: p, school });
});

// Mark payments reconciled (bank / momo statement check)
router.post('/payments/reconcile', requireRole(...FIN), (req, res) => {
  if (opGuard(req, res)) return;
  const { payment_ids } = req.body || {};
  if (!Array.isArray(payment_ids)) return res.status(400).json({ error: 'payment_ids[] required' });
  let n = 0;
  tx(() => {
    for (const id of payment_ids) {
      run(`UPDATE payments SET reconciled = 1, reconciled_at = datetime('now'),
             momo_status = CASE WHEN momo_status IS NOT NULL THEN 'confirmed' ELSE momo_status END,
             updated_at = datetime('now')
           WHERE id = ? AND school_id = ?`, id, req.user.school_id);
      n++;
    }
  });
  const result = { ok: true, reconciled: n };
  opRecord(req, result);
  res.json(result);
});

// ------------------------------------------------------------- defaulters & reminders
router.get('/defaulters', requireRole(...FIN_READ), (req, res) => {
  const { term_id } = req.query;
  let sql = `
    SELECT s.id AS student_id, s.student_no, s.first_name, s.last_name, c.name AS class_name,
           SUM(i.total_cents - i.discount_cents) AS billed_cents,
           COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                     WHERE p.student_id = s.id AND p.deleted = 0
                       AND (? IS NULL OR p.invoice_id IN
                            (SELECT id FROM invoices WHERE term_id = ? AND student_id = s.id))), 0) AS paid_cents
      FROM invoices i
      JOIN students s ON s.id = i.student_id
      LEFT JOIN classes c ON c.id = s.class_id
     WHERE i.deleted = 0 AND i.status != 'void' AND i.school_id = ?`;
  const params = [term_id || null, term_id || null, schoolScope(req)];
  if (term_id) { sql += ' AND i.term_id = ?'; params.push(term_id); }
  sql += ` GROUP BY s.id HAVING billed_cents > paid_cents ORDER BY (billed_cents - paid_cents) DESC`;
  const rows = all(sql, ...params).map(r => ({ ...r, balance_cents: r.billed_cents - r.paid_cents }));
  res.json({ data: rows });
});

// Queue fee reminder SMS to all defaulters (or a subset)
router.post('/defaulters/remind', requireRole(...FIN), (req, res) => {
  if (opGuard(req, res)) return;
  const { student_ids, message } = req.body || {};
  if (!Array.isArray(student_ids) || !student_ids.length) return res.status(400).json({ error: 'student_ids[] required' });
  const school = get('SELECT name, currency FROM schools WHERE id = ?', req.user.school_id);
  let queued = 0;
  for (const sid of student_ids) {
    const st = get('SELECT first_name, last_name FROM students WHERE id = ? AND school_id = ?', sid, req.user.school_id);
    if (!st) continue;
    const body = message
      ? message.replace('{name}', `${st.first_name} ${st.last_name}`)
      : `${school.name}: friendly reminder that school fees for ${st.first_name} ${st.last_name} are due. Please visit the school office or pay by mobile money. Thank you.`;
    queued += sms.notifyGuardians(sid, 'fee_due', body, req.user.school_id);
  }
  const result = { ok: true, sms_queued: queued };
  opRecord(req, result);
  res.json(result);
});

// ------------------------------------------------------------- expenses, budgets, donations
router.use('/expenses', makeResource({
  table: 'expenses',
  fields: ['school_id', 'date', 'category', 'description', 'amount_cents', 'currency',
    'paid_to', 'method', 'reference'],
  readRoles: FIN_READ, writeRoles: FIN,
  orderBy: 'date DESC',
  beforeWrite(req, data, existing) {
    if (!existing) data.entered_by = req.user.id;
    if (data.amount_cents !== undefined && !(Number(data.amount_cents) > 0)) {
      throw { status: 400, message: 'Amount must be greater than zero' };
    }
  },
}));

router.use('/budgets', makeResource({
  table: 'budgets',
  fields: ['school_id', 'academic_year_id', 'category', 'amount_cents', 'currency'],
  readRoles: FIN_READ, writeRoles: FIN,
}));

router.use('/donations', makeResource({
  table: 'donations',
  fields: ['school_id', 'date', 'donor', 'kind', 'description', 'amount_cents', 'currency', 'restricted_to'],
  readRoles: FIN_READ, writeRoles: FIN,
  orderBy: 'date DESC',
}));

// ------------------------------------------------------------- financial summary
router.get('/summary', requireRole(...FIN_READ), (req, res) => {
  const { from, to } = req.query;
  const f = from || '0000-01-01', t = to || '9999-12-31';
  const schoolId = schoolScope(req);
  const income = get(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ?`, schoolId, f, t).s;
  const donations = get(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM donations WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ?`, schoolId, f, t).s;
  const expenses = get(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM expenses WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ?`, schoolId, f, t).s;
  const byCategory = all(`SELECT category, SUM(amount_cents) AS cents FROM expenses WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ? GROUP BY category ORDER BY cents DESC`, schoolId, f, t);
  const byMethod = all(`SELECT method, SUM(amount_cents) AS cents, COUNT(*) AS n FROM payments WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ? GROUP BY method`, schoolId, f, t);
  const billed = get(`SELECT COALESCE(SUM(total_cents - discount_cents),0) AS s FROM invoices WHERE school_id = ? AND deleted = 0 AND status != 'void'`, schoolId).s;
  const budgets = all(`SELECT b.category, b.amount_cents FROM budgets b JOIN academic_years y ON y.id = b.academic_year_id AND y.is_current = 1 WHERE b.school_id = ? AND b.deleted = 0`, schoolId);
  const monthly = all(
    `SELECT strftime('%Y-%m', date) AS month,
            SUM(amount_cents) AS income_cents,
            0 AS expense_cents
       FROM payments WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ? GROUP BY month
     UNION ALL
     SELECT strftime('%Y-%m', date), 0, SUM(amount_cents)
       FROM expenses WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ? GROUP BY strftime('%Y-%m', date)`,
    schoolId, f, t, schoolId, f, t);
  // merge months
  const cash = {};
  for (const m of monthly) {
    const c = (cash[m.month] ||= { month: m.month, income_cents: 0, expense_cents: 0 });
    c.income_cents += m.income_cents; c.expense_cents += m.expense_cents;
  }
  res.json({
    income_cents: income, donations_cents: donations, expenses_cents: expenses,
    net_cents: income + donations - expenses,
    billed_cents: billed,
    collection_rate: billed > 0 ? Math.round((income / billed) * 1000) / 10 : null,
    expenses_by_category: byCategory, payments_by_method: byMethod,
    budgets, cash_flow: Object.values(cash).sort((a, b) => a.month.localeCompare(b.month)),
  });
});

module.exports = router;
