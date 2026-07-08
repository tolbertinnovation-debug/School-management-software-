'use strict';
const express = require('express');
const { all, get, run, tx } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');
const sms = require('../services/sms');

const router = express.Router();
// NOTE: the root staff resource is mounted at the END of this file so its
// GET /:id route cannot shadow /leaves, /payroll, etc.

// Staff directory with user names (contact list)
router.get('/directory/list', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({
    data: all(
      `SELECT st.id, st.staff_no, st.position, st.qualification, st.phone, st.status,
              st.payroll_type, u.full_name, u.email, u.role
         FROM staff st LEFT JOIN users u ON u.id = st.user_id
        WHERE st.school_id = ? AND st.deleted = 0 ORDER BY u.full_name`, req.user.school_id),
  });
});

// ------------------------------------------------------------- staff attendance
router.post('/attendance/bulk', requireRole('school_admin'), (req, res) => {
  if (opGuard(req, res)) return;
  const { date, records } = req.body || {};
  if (!date || !Array.isArray(records)) return res.status(400).json({ error: 'date and records[] required' });
  let saved = 0;
  tx(() => {
    for (const r of records) {
      if (!r.staff_id || !['present', 'absent', 'late', 'leave'].includes(r.status)) continue;
      run(
        `INSERT INTO staff_attendance (uuid, staff_id, date, status, note, marked_by)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(staff_id, date) DO UPDATE SET
           status = excluded.status, note = excluded.note, deleted = 0, updated_at = datetime('now')`,
        uuid(), r.staff_id, date, r.status, r.note || null, req.user.id);
      saved++;
    }
  });
  const result = { ok: true, saved };
  opRecord(req, result);
  res.json(result);
});

router.get('/attendance/sheet', requireRole('school_admin', 'county_officer'), (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  res.json({
    data: all(
      `SELECT st.id AS staff_id, st.staff_no, st.position, u.full_name, a.status, a.note
         FROM staff st
         LEFT JOIN users u ON u.id = st.user_id
         LEFT JOIN staff_attendance a ON a.staff_id = st.id AND a.date = ? AND a.deleted = 0
        WHERE st.school_id = ? AND st.deleted = 0 AND st.status = 'active'
        ORDER BY u.full_name`, date, req.user.school_id),
  });
});

// ------------------------------------------------------------- leave management
router.use('/leaves', makeResource({
  table: 'leaves',
  fields: ['staff_id', 'kind', 'start_date', 'end_date', 'reason', 'status', 'substitute_staff_id'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN_TEACHER,   // teachers request; admin approves
  schoolField: null,
  beforeWrite(req, data, existing) {
    if (req.user.role === 'teacher') {
      // teachers can create requests but not approve them
      if (data.status && data.status !== 'pending') throw { status: 403, message: 'Only the administrator can approve or reject leave' };
      data.status = existing ? existing.status : 'pending';
    } else if (data.status && ['approved', 'rejected'].includes(data.status)) {
      data.decided_by = req.user.id;
    }
  },
  afterWrite(req, row, action) {
    // notify the substitute teacher when a leave is approved with cover assigned
    if (row.status === 'approved' && row.substitute_staff_id) {
      const sub = get(`SELECT st.phone, u.full_name FROM staff st LEFT JOIN users u ON u.id = st.user_id WHERE st.id = ?`, row.substitute_staff_id);
      const away = get(`SELECT u.full_name FROM staff st LEFT JOIN users u ON u.id = st.user_id WHERE st.id = ?`, row.staff_id);
      if (sub && sub.phone) {
        sms.queue({
          schoolId: req.user.school_id, toPhone: sub.phone, trigger: 'substitute',
          body: `You are assigned as substitute for ${away ? away.full_name : 'a colleague'} from ${row.start_date} to ${row.end_date}.`,
        });
      }
    }
  },
}));

// ------------------------------------------------------------- payroll
// Generate draft payslips for a month: school-funded staff get computed pay,
// government staff are tracked read-only (gross recorded as 0 unless entered).
router.post('/payroll/generate', requireRole('school_admin', 'accountant'), (req, res) => {
  if (opGuard(req, res)) return;
  const { period } = req.body || {};   // "2026-01"
  if (!/^\d{4}-\d{2}$/.test(period || '')) return res.status(400).json({ error: 'period must be YYYY-MM' });
  const staff = all(
    `SELECT * FROM staff WHERE school_id = ? AND deleted = 0 AND status = 'active'
      AND payroll_type IN ('school','volunteer')`, req.user.school_id);
  let created = 0, skippedExisting = 0;
  tx(() => {
    for (const st of staff) {
      const existing = get('SELECT id FROM payslips WHERE staff_id = ? AND period = ? AND deleted = 0', st.id, period);
      if (existing) { skippedExisting++; continue; }
      const gross = st.base_salary_cents || 0;
      run(
        `INSERT INTO payslips (uuid, staff_id, period, gross_cents, allowances_json, deductions_json,
           net_cents, currency, status, prepared_by)
         VALUES (?,?,?,?,?,?,?,?,'draft',?)`,
        uuid(), st.id, period, gross, '[]', '[]', gross, st.salary_currency || 'LRD', req.user.id);
      created++;
    }
  });
  const result = { ok: true, created, skipped_existing: skippedExisting };
  opRecord(req, result);
  res.json(result);
});

router.use('/payroll', makeResource({
  table: 'payslips',
  fields: ['staff_id', 'period', 'gross_cents', 'allowances_json', 'deductions_json',
    'net_cents', 'currency', 'status', 'paid_date'],
  readRoles: ['school_admin', 'accountant'], writeRoles: ['school_admin', 'accountant'],
  schoolField: null,
  beforeWrite(req, data, existing) {
    // recompute net when components change
    const gross = data.gross_cents ?? (existing && existing.gross_cents) ?? 0;
    const allow = JSON.parse(data.allowances_json ?? (existing && existing.allowances_json) ?? '[]');
    const ded = JSON.parse(data.deductions_json ?? (existing && existing.deductions_json) ?? '[]');
    data.net_cents = gross
      + allow.reduce((s, a) => s + (Number(a.cents) || 0), 0)
      - ded.reduce((s, d) => s + (Number(d.cents) || 0), 0);
    if (data.status === 'paid' && !data.paid_date) data.paid_date = new Date().toISOString().slice(0, 10);
  },
}));

// Payslip detail for the printable view
router.get('/payroll/:id/slip', requireRole('school_admin', 'accountant'), (req, res) => {
  const slip = get(
    `SELECT p.*, st.staff_no, st.position, st.payroll_type, st.bank_or_momo, u.full_name
       FROM payslips p JOIN staff st ON st.id = p.staff_id
       LEFT JOIN users u ON u.id = st.user_id WHERE p.id = ? AND p.deleted = 0`, req.params.id);
  if (!slip) return res.status(404).json({ error: 'Not found' });
  const school = get('SELECT name, address, county, phone FROM schools WHERE id = ?', req.user.school_id);
  res.json({ slip: { ...slip, allowances: JSON.parse(slip.allowances_json), deductions: JSON.parse(slip.deductions_json) }, school });
});

// ------------------------------------------------------------- evaluations & PD
router.use('/evaluations', makeResource({
  table: 'evaluations',
  fields: ['staff_id', 'term_id', 'scores_json', 'overall', 'comments'],
  readRoles: ['school_admin', 'county_officer'], writeRoles: R.ADMIN,
  schoolField: null,
  beforeWrite(req, data, existing) { if (!existing) data.evaluator_id = req.user.id; },
}));

router.use('/pd', makeResource({
  table: 'professional_development',
  fields: ['staff_id', 'title', 'provider', 'date', 'hours', 'certificate'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN_TEACHER,
  schoolField: null,
}));

// Root staff CRUD — mounted last (see note at top)
router.use('/', makeResource({
  table: 'staff',
  fields: ['school_id', 'user_id', 'staff_no', 'position', 'qualification', 'certifications',
    'hire_date', 'payroll_type', 'gov_payroll_no', 'base_salary_cents', 'salary_currency',
    'bank_or_momo', 'phone', 'status'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
  orderBy: 'staff_no',
}));

module.exports = router;
