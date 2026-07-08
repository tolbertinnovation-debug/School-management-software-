'use strict';
const express = require('express');
const { all, get, run, tx } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole, studentAccessOk } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');
const { computeTermResults } = require('../services/grading');
const sms = require('../services/sms');

const router = express.Router();

router.use('/assessments', makeResource({
  table: 'assessments',
  fields: ['school_id', 'class_id', 'subject_id', 'term_id', 'kind', 'title', 'date', 'max_score', 'weight'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN_TEACHER,
  orderBy: 'date DESC, id DESC',
  beforeWrite(req, data, existing) {
    if (!existing) data.created_by = undefined; // set below via afterWrite-free approach
    if (data.max_score !== undefined && !(Number(data.max_score) > 0)) {
      throw { status: 400, message: 'max_score must be greater than 0' };
    }
  },
}));

// Score sheet: all students of the class with their scores for one assessment
router.get('/assessments/:id/scores', requireRole(...R.ALL_STAFF), (req, res) => {
  const a = get('SELECT * FROM assessments WHERE id = ? AND deleted = 0', req.params.id);
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  const rows = all(
    `SELECT st.id AS student_id, st.student_no, st.first_name, st.last_name,
            sc.score, sc.remark
       FROM students st
       LEFT JOIN scores sc ON sc.student_id = st.id AND sc.assessment_id = ? AND sc.deleted = 0
      WHERE st.class_id = ? AND st.deleted = 0 AND st.status = 'active'
      ORDER BY st.last_name, st.first_name`, a.id, a.class_id);
  res.json({ assessment: a, data: rows });
});

// Bulk score entry: { scores: [{student_id, score, remark?}] }
router.post('/assessments/:id/scores', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const a = get('SELECT * FROM assessments WHERE id = ? AND deleted = 0', req.params.id);
  if (!a) return res.status(404).json({ error: 'Assessment not found' });
  const { scores } = req.body || {};
  if (!Array.isArray(scores)) return res.status(400).json({ error: 'scores[] required' });
  let saved = 0, rejected = 0;
  tx(() => {
    for (const s of scores) {
      if (!s.student_id) continue;
      const val = s.score === null || s.score === '' ? null : Number(s.score);
      if (val !== null && (isNaN(val) || val < 0 || val > a.max_score)) { rejected++; continue; }
      run(
        `INSERT INTO scores (uuid, assessment_id, student_id, score, remark, entered_by)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(assessment_id, student_id) DO UPDATE SET
           score = excluded.score, remark = excluded.remark, entered_by = excluded.entered_by,
           deleted = 0, updated_at = datetime('now')`,
        uuid(), a.id, s.student_id, val, s.remark || null, req.user.id);
      saved++;
    }
  });
  const result = { ok: true, saved, rejected, max_score: a.max_score };
  opRecord(req, result);
  res.json(result);
});

// Gradebook: computed CA/exam/final per subject for one class + term
router.get('/gradebook', requireRole(...R.ALL_STAFF), (req, res) => {
  const { class_id, term_id } = req.query;
  if (!class_id || !term_id) return res.status(400).json({ error: 'class_id and term_id required' });
  const results = computeTermResults(Number(class_id), Number(term_id), req.user.school_id);
  const students = all(
    `SELECT id, student_no, first_name, last_name FROM students
      WHERE class_id = ? AND deleted = 0 AND status = 'active' ORDER BY last_name`, class_id);
  const subjects = all(
    `SELECT s.id, s.name FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
      WHERE cs.class_id = ? AND cs.deleted = 0 ORDER BY s.name`, class_id);
  res.json({ students, subjects, results: results.students, config: results.config });
});

// ------------------------------------------------------------- report cards
// Generate (or regenerate) report cards for a whole class+term.
router.post('/report-cards/generate', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const { class_id, term_id, remarks } = req.body || {};   // remarks: {student_id: text}
  if (!class_id || !term_id) return res.status(400).json({ error: 'class_id and term_id required' });
  const term = get('SELECT * FROM terms WHERE id = ?', term_id);
  if (!term) return res.status(404).json({ error: 'Term not found' });
  const { students: results } = computeTermResults(Number(class_id), Number(term_id), req.user.school_id);
  const attendance = Object.fromEntries(all(
    `SELECT student_id,
            SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present,
            SUM(CASE WHEN status IN ('absent') THEN 1 ELSE 0 END) AS absent
       FROM attendance WHERE class_id = ? AND term_id = ? AND deleted = 0 GROUP BY student_id`,
    class_id, term_id).map(r => [r.student_id, r]));
  let count = 0;
  tx(() => {
    for (const [sid, r] of Object.entries(results)) {
      const att = attendance[sid] || { present: null, absent: null };
      run(
        `INSERT INTO report_cards (uuid, student_id, term_id, class_id, data_json, average, rank,
           class_size, days_present, days_absent, remarks, published)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 0)
         ON CONFLICT(student_id, term_id) DO UPDATE SET
           class_id = excluded.class_id, data_json = excluded.data_json,
           average = excluded.average, rank = excluded.rank, class_size = excluded.class_size,
           days_present = excluded.days_present, days_absent = excluded.days_absent,
           remarks = COALESCE(excluded.remarks, report_cards.remarks),
           deleted = 0, updated_at = datetime('now')`,
        uuid(), Number(sid), term_id, class_id, JSON.stringify(r.subjects),
        r.average, r.rank || null, r.class_size || null,
        att.present, att.absent, remarks && remarks[sid] ? remarks[sid] : null);
      count++;
    }
  });
  const result = { ok: true, generated: count };
  opRecord(req, result);
  res.json(result);
});

// Publish: freeze + notify parents by SMS
router.post('/report-cards/publish', requireRole('school_admin'), (req, res) => {
  if (opGuard(req, res)) return;
  const { class_id, term_id } = req.body || {};
  if (!class_id || !term_id) return res.status(400).json({ error: 'class_id and term_id required' });
  const cards = all(
    `SELECT rc.id, rc.student_id, rc.average, s.first_name, s.last_name
       FROM report_cards rc JOIN students s ON s.id = rc.student_id
      WHERE rc.class_id = ? AND rc.term_id = ? AND rc.deleted = 0`, class_id, term_id);
  const school = get('SELECT name FROM schools WHERE id = ?', req.user.school_id);
  let smsCount = 0;
  tx(() => {
    for (const c of cards) {
      run(`UPDATE report_cards SET published = 1, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, c.id);
    }
  });
  for (const c of cards) {
    smsCount += sms.notifyGuardians(
      c.student_id, 'report_card',
      `${school.name}: ${c.first_name} ${c.last_name}'s report card is ready. Term average: ${c.average ?? 'N/A'}%. View it in the parent portal or collect a printed copy.`,
      req.user.school_id);
  }
  const result = { ok: true, published: cards.length, sms_queued: smsCount };
  opRecord(req, result);
  res.json(result);
});

// One student's full report card (used by the printable view + parent portal)
router.get('/report-cards/:studentId/:termId', requireRole(...R.EVERYONE), (req, res) => {
  if (!studentAccessOk(req, req.params.studentId)) return res.status(403).json({ error: 'Not your student record' });
  const card = get(
    `SELECT rc.*, s.first_name, s.middle_name, s.last_name, s.student_no, s.photo_path,
            c.name AS class_name, t.name AS term_name, y.name AS year_name
       FROM report_cards rc
       JOIN students s ON s.id = rc.student_id
       LEFT JOIN classes c ON c.id = rc.class_id
       JOIN terms t ON t.id = rc.term_id
       JOIN academic_years y ON y.id = t.academic_year_id
      WHERE rc.student_id = ? AND rc.term_id = ? AND rc.deleted = 0`,
    req.params.studentId, req.params.termId);
  if (!card) return res.status(404).json({ error: 'No report card yet' });
  // parents/students may only see published cards for their own children
  if (['parent', 'student'].includes(req.user.role) && !card.published) {
    return res.status(403).json({ error: 'Report card not yet published' });
  }
  const subjects = Object.fromEntries(
    all('SELECT id, name FROM subjects WHERE deleted = 0').map(s => [s.id, s.name]));
  const school = get('SELECT name, motto, address, county, principal, phone FROM schools WHERE id = ?', req.user.school_id || card.school_id);
  res.json({ card: { ...card, data: JSON.parse(card.data_json) }, subjects, school });
});

// ------------------------------------------------------------- promotion workflow
// Bulk decide: { from_class_id, to_class_id, year_id, decisions: [{student_id, decision}] }
router.post('/promotions/bulk', requireRole('school_admin'), (req, res) => {
  if (opGuard(req, res)) return;
  const { from_class_id, to_class_id, year_id, decisions } = req.body || {};
  if (!Array.isArray(decisions)) return res.status(400).json({ error: 'decisions[] required' });
  let n = 0;
  tx(() => {
    for (const d of decisions) {
      if (!d.student_id || !['promoted', 'retained', 'graduated', 'conditional'].includes(d.decision)) continue;
      run(`INSERT INTO promotions (uuid, student_id, from_year_id, from_class_id, to_class_id, decision, decided_by)
           VALUES (?,?,?,?,?,?,?)`,
        uuid(), d.student_id, year_id || null, from_class_id || null,
        d.decision === 'promoted' || d.decision === 'conditional' ? (to_class_id || null) : null,
        d.decision, req.user.id);
      if ((d.decision === 'promoted' || d.decision === 'conditional') && to_class_id) {
        run(`UPDATE students SET class_id = ?, updated_at = datetime('now') WHERE id = ?`, to_class_id, d.student_id);
      }
      if (d.decision === 'graduated') {
        run(`UPDATE students SET status = 'graduated', status_date = date('now'), updated_at = datetime('now') WHERE id = ?`, d.student_id);
      }
      n++;
    }
  });
  const result = { ok: true, decided: n };
  opRecord(req, result);
  res.json(result);
});

// ------------------------------------------------------------- national exams (WAEC)
router.use('/national-exams', makeResource({
  table: 'national_exams',
  fields: ['student_id', 'exam', 'year', 'index_no', 'registered', 'fee_paid', 'results_json'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
  schoolField: null,
  beforeWrite(req, data) {
    if (data.exam && !['NPSE', 'BECE', 'WASSCE', 'LJHSCE', 'LSHSCE'].includes(data.exam)) {
      throw { status: 400, message: 'exam must be one of NPSE, BECE, LJHSCE, LSHSCE, WASSCE' };
    }
  },
}));

// ------------------------------------------------------------- question bank
router.use('/questions', makeResource({
  table: 'question_bank',
  fields: ['school_id', 'subject_id', 'level', 'question', 'answer', 'kind'],
  readRoles: R.ADMIN_TEACHER, writeRoles: R.ADMIN_TEACHER,
}));

module.exports = router;
