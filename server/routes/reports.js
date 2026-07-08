'use strict';
const express = require('express');
const { all, get } = require('../db/connection');
const { requireRole, schoolScope } = require('../middleware/auth');
const { R } = require('../lib/resource');
const emis = require('../services/emis');

const router = express.Router();
const READ = ['school_admin', 'accountant', 'teacher', 'county_officer'];

// ------------------------------------------------------------- dashboard KPIs
router.get('/dashboard', requireRole(...READ), (req, res) => {
  const schoolId = schoolScope(req);
  const today = new Date().toISOString().slice(0, 10);
  const enrollment = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN gender='M' THEN 1 ELSE 0 END) AS male,
            SUM(CASE WHEN gender='F' THEN 1 ELSE 0 END) AS female
       FROM students WHERE school_id = ? AND deleted = 0 AND status = 'active'`, schoolId);
  const attendanceToday = get(
    `SELECT COUNT(*) AS marked,
            SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent
       FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE s.school_id = ? AND a.date = ? AND a.deleted = 0`, schoolId, today);
  const staffCount = get(`SELECT COUNT(*) AS n FROM staff WHERE school_id = ? AND deleted = 0 AND status='active'`, schoolId).n;
  const feesThisMonth = get(
    `SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments
      WHERE school_id = ? AND deleted = 0 AND strftime('%Y-%m', date) = strftime('%Y-%m','now')`, schoolId).s;
  const billed = get(`SELECT COALESCE(SUM(total_cents - discount_cents),0) AS s FROM invoices WHERE school_id = ? AND deleted = 0 AND status != 'void'`, schoolId).s;
  const collected = get(`SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE school_id = ? AND deleted = 0`, schoolId).s;
  const smsQueued = get(`SELECT COUNT(*) AS n FROM messages WHERE school_id = ? AND status='queued' AND deleted = 0`, schoolId).n;
  const upcoming = all(
    `SELECT title, kind, start_date FROM calendar_events
      WHERE school_id = ? AND deleted = 0 AND start_date >= date('now') ORDER BY start_date LIMIT 5`, schoolId);
  const byClass = all(
    `SELECT c.name, COUNT(s.id) AS students,
            SUM(CASE WHEN s.gender='F' THEN 1 ELSE 0 END) AS girls
       FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.deleted = 0 AND s.status='active'
      WHERE c.school_id = ? AND c.deleted = 0
      GROUP BY c.id
      ORDER BY CASE WHEN c.level GLOB '[0-9]*' THEN CAST(c.level AS INTEGER) ELSE -1 END, c.name`, schoolId);
  res.json({
    enrollment, attendance_today: attendanceToday, staff_count: staffCount,
    fees_this_month_cents: feesThisMonth,
    collection: { billed_cents: billed, collected_cents: collected,
      rate: billed > 0 ? Math.round(collected / billed * 1000) / 10 : null },
    sms_queued: smsQueued, upcoming_events: upcoming, enrollment_by_class: byClass,
  });
});

// ------------------------------------------------------------- attendance trends (monthly)
router.get('/attendance-trends', requireRole(...READ), (req, res) => {
  const rows = all(
    `SELECT strftime('%Y-%m', a.date) AS month,
            SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) AS absent,
            SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END) AS late,
            COUNT(*) AS marked
       FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE s.school_id = ? AND a.deleted = 0
      GROUP BY month ORDER BY month DESC LIMIT 24`, schoolScope(req));
  res.json({ data: rows.reverse() });
});

// ------------------------------------------------------------- academic performance
// average final grade per class+subject for a term
router.get('/performance', requireRole(...READ), (req, res) => {
  const { term_id } = req.query;
  if (!term_id) return res.status(400).json({ error: 'term_id required' });
  const rows = all(
    `SELECT c.name AS class_name, sub.name AS subject_name, u.full_name AS teacher_name,
            ROUND(AVG(CASE WHEN a.max_score > 0 THEN sc.score * 100.0 / a.max_score END), 1) AS avg_pct,
            COUNT(DISTINCT sc.student_id) AS students
       FROM assessments a
       JOIN scores sc ON sc.assessment_id = a.id AND sc.deleted = 0 AND sc.score IS NOT NULL
       JOIN classes c ON c.id = a.class_id
       JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN class_subjects cs ON cs.class_id = a.class_id AND cs.subject_id = a.subject_id AND cs.deleted = 0
       LEFT JOIN users u ON u.id = cs.teacher_id
      WHERE a.term_id = ? AND a.deleted = 0 AND c.school_id = ?
      GROUP BY c.id, sub.id ORDER BY c.name, sub.name`, term_id, schoolScope(req));
  res.json({ data: rows });
});

// ------------------------------------------------------------- enrollment report
router.get('/enrollment', requireRole(...READ, 'county_officer'), (req, res) => {
  const schoolId = schoolScope(req);
  const byGrade = all(
    `SELECT c.level, c.name,
            SUM(CASE WHEN s.gender='M' THEN 1 ELSE 0 END) AS male,
            SUM(CASE WHEN s.gender='F' THEN 1 ELSE 0 END) AS female,
            COUNT(s.id) AS total
       FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.deleted = 0 AND s.status='active'
      WHERE c.school_id = ? AND c.deleted = 0 GROUP BY c.id
      ORDER BY CASE WHEN c.level GLOB '[0-9]*' THEN CAST(c.level AS INTEGER) ELSE -1 END`, schoolId);
  const byCounty = all(
    `SELECT COALESCE(county,'Unknown') AS county, COUNT(*) AS students
       FROM students WHERE school_id = ? AND deleted = 0 AND status='active'
      GROUP BY county ORDER BY students DESC`, schoolId);
  const welfare = get(
    `SELECT SUM(ovc_flag) AS ovc, SUM(pregnancy_flag) AS pregnancy,
            SUM(CASE WHEN reentry_date IS NOT NULL THEN 1 ELSE 0 END) AS reentries,
            SUM(CASE WHEN disability IS NOT NULL AND disability != '' THEN 1 ELSE 0 END) AS disability
       FROM students WHERE school_id = ? AND deleted = 0 AND status='active'`, schoolId);
  const statusCounts = all(
    `SELECT status, COUNT(*) AS n FROM students WHERE school_id = ? AND deleted = 0 GROUP BY status`, schoolId);
  res.json({ by_grade: byGrade, by_county: byCounty, welfare, by_status: statusCounts });
});

// ------------------------------------------------------------- custom report builder
// POST { table, fields: [], filters: [{field, op, value}], group_by?, from?, to?, date_field? }
const REPORTABLE = {
  students: ['student_no', 'first_name', 'last_name', 'gender', 'dob', 'county', 'status', 'class_id', 'admission_date', 'ovc_flag'],
  attendance: ['student_id', 'class_id', 'date', 'status'],
  payments: ['student_id', 'receipt_no', 'amount_cents', 'method', 'date', 'reconciled'],
  expenses: ['date', 'category', 'description', 'amount_cents', 'paid_to', 'method'],
  invoices: ['student_id', 'invoice_no', 'total_cents', 'discount_cents', 'status', 'due_date'],
  book_loans: ['book_id', 'student_id', 'loan_date', 'due_date', 'return_date', 'fine_cents'],
};
const OPS = { eq: '=', ne: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=', like: 'LIKE' };

router.post('/custom', requireRole('school_admin', 'accountant', 'county_officer'), (req, res) => {
  const { table, fields, filters = [], group_by, from, to, date_field } = req.body || {};
  const allowed = REPORTABLE[table];
  if (!allowed) return res.status(400).json({ error: `table must be one of: ${Object.keys(REPORTABLE).join(', ')}` });
  const cols = (Array.isArray(fields) && fields.length ? fields : allowed).filter(f => allowed.includes(f));
  if (!cols.length) return res.status(400).json({ error: 'No valid fields selected' });
  const hasSchool = table !== 'book_loans';
  let sql, params = [];
  if (group_by && allowed.includes(group_by)) {
    sql = `SELECT ${group_by}, COUNT(*) AS count` +
      (allowed.includes('amount_cents') && (table === 'payments' || table === 'expenses' || table === 'invoices')
        ? `, SUM(${table === 'invoices' ? 'total_cents' : 'amount_cents'}) AS sum_cents` : '') +
      ` FROM ${table} WHERE deleted = 0`;
  } else {
    sql = `SELECT ${cols.join(', ')} FROM ${table} WHERE deleted = 0`;
  }
  if (hasSchool) { sql += ' AND school_id = ?'; params.push(schoolScope(req)); }
  for (const f of filters.slice(0, 10)) {
    if (!allowed.includes(f.field) || !OPS[f.op]) continue;
    sql += ` AND ${f.field} ${OPS[f.op]} ?`;
    params.push(f.op === 'like' ? `%${f.value}%` : f.value);
  }
  const df = date_field && allowed.includes(date_field) ? date_field : (allowed.includes('date') ? 'date' : null);
  if (from && df) { sql += ` AND ${df} >= ?`; params.push(from); }
  if (to && df) { sql += ` AND ${df} <= ?`; params.push(to); }
  if (group_by && allowed.includes(group_by)) sql += ` GROUP BY ${group_by}`;
  sql += ' LIMIT 5000';
  res.json({ data: all(sql, ...params) });
});

// ------------------------------------------------------------- EMIS exports
router.get('/emis/:kind', requireRole('school_admin', 'county_officer'), (req, res) => {
  const schoolId = schoolScope(req);
  const kinds = { enrollment: emis.enrollmentCsv, staff: emis.staffCsv, register: emis.registerCsv };
  const fn = kinds[req.params.kind];
  if (!fn) return res.status(400).json({ error: 'kind must be enrollment, staff or register' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="emis-${req.params.kind}.csv"`);
  res.send(fn(schoolId));
});

// ------------------------------------------------------------- audit trail
router.get('/audit', requireRole('school_admin', 'county_officer'), (req, res) => {
  const { user_id, from, to } = req.query;
  let sql = `SELECT * FROM audit_log WHERE school_id = ?`;
  const params = [schoolScope(req)];
  if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
  if (from) { sql += ' AND at >= ?'; params.push(from); }
  if (to) { sql += ' AND at <= ?'; params.push(to + ' 23:59:59'); }
  sql += ' ORDER BY id DESC LIMIT 500';
  res.json({ data: all(sql, ...params) });
});

// ------------------------------------------------------------- year-over-year comparison
router.get('/year-comparison', requireRole(...READ), (req, res) => {
  const schoolId = schoolScope(req);
  const years = all(`SELECT * FROM academic_years WHERE school_id = ? AND deleted = 0 ORDER BY start_date`, schoolId);
  const rows = years.map(y => {
    const enrolled = get(
      `SELECT COUNT(*) AS n FROM students WHERE school_id = ? AND deleted = 0
        AND admission_date <= ? AND (status = 'active' OR status_date >= ?)`,
      schoolId, y.end_date, y.start_date).n;
    const collected = get(
      `SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments
        WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ?`,
      schoolId, y.start_date, y.end_date).s;
    const lost = get(
      `SELECT COALESCE(SUM(days_lost),0) AS d FROM lost_instruction_days
        WHERE school_id = ? AND deleted = 0 AND date BETWEEN ? AND ?`,
      schoolId, y.start_date, y.end_date).d;
    return { year: y.name, enrolled, collected_cents: collected, lost_instruction_days: lost };
  });
  res.json({ data: rows });
});

module.exports = router;
