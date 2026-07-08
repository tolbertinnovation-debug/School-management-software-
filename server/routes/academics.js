'use strict';
const express = require('express');
const { all, get } = require('../db/connection');
const { requireRole } = require('../middleware/auth');
const { makeResource, R } = require('../lib/resource');

const router = express.Router();

router.use('/classes', makeResource({
  table: 'classes',
  fields: ['school_id', 'name', 'level', 'section', 'teacher_id', 'capacity'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  orderBy: "CASE WHEN level GLOB '[0-9]*' THEN CAST(level AS INTEGER) ELSE -1 END, name",
}));

router.use('/subjects', makeResource({
  table: 'subjects',
  fields: ['school_id', 'name', 'code', 'level_group'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  orderBy: 'name',
}));

router.use('/class-subjects', makeResource({
  table: 'class_subjects',
  fields: ['class_id', 'subject_id', 'teacher_id'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  schoolField: null,
}));

// Assignments joined for display: which teacher teaches what, where
router.get('/assignments', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({
    data: all(
      `SELECT cs.id, cs.class_id, cs.subject_id, cs.teacher_id,
              c.name AS class_name, s.name AS subject_name, u.full_name AS teacher_name
         FROM class_subjects cs
         JOIN classes c ON c.id = cs.class_id
         JOIN subjects s ON s.id = cs.subject_id
         LEFT JOIN users u ON u.id = cs.teacher_id
        WHERE cs.deleted = 0 AND c.school_id = ? AND c.deleted = 0
        ORDER BY c.name, s.name`, req.user.school_id),
  });
});

// ------------------------------------------------------------- timetable
router.use('/timetable', makeResource({
  table: 'timetable_slots',
  fields: ['class_id', 'subject_id', 'teacher_id', 'weekday', 'start_time', 'end_time', 'room'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  schoolField: null,
  beforeWrite(req, data, existing) {
    // conflict detection: same teacher or same class double-booked
    const weekday = data.weekday ?? (existing && existing.weekday);
    const start = data.start_time ?? (existing && existing.start_time);
    const end = data.end_time ?? (existing && existing.end_time);
    const classId = data.class_id ?? (existing && existing.class_id);
    const teacherId = data.teacher_id ?? (existing && existing.teacher_id);
    if (!weekday || !start || !end) return;
    const overlap = `deleted = 0 AND weekday = ? AND NOT (end_time <= ? OR start_time >= ?)`;
    const skipSelf = existing ? ` AND id != ${Number(existing.id)}` : '';
    const classClash = get(
      `SELECT id FROM timetable_slots WHERE ${overlap} AND class_id = ?${skipSelf} LIMIT 1`,
      weekday, start, end, classId);
    if (classClash) throw { status: 409, message: 'This class already has a lesson in that time slot' };
    if (teacherId) {
      const teacherClash = get(
        `SELECT id FROM timetable_slots WHERE ${overlap} AND teacher_id = ?${skipSelf} LIMIT 1`,
        weekday, start, end, teacherId);
      if (teacherClash) throw { status: 409, message: 'This teacher is already booked in that time slot' };
    }
  },
}));

// Weekly grid for a class or teacher
router.get('/timetable-grid', requireRole(...R.EVERYONE), (req, res) => {
  const { class_id, teacher_id } = req.query;
  let sql = `SELECT ts.*, c.name AS class_name, s.name AS subject_name, u.full_name AS teacher_name
               FROM timetable_slots ts
               JOIN classes c ON c.id = ts.class_id
               JOIN subjects s ON s.id = ts.subject_id
               LEFT JOIN users u ON u.id = ts.teacher_id
              WHERE ts.deleted = 0 AND c.school_id = ?`;
  const params = [req.user.school_id];
  if (class_id) { sql += ' AND ts.class_id = ?'; params.push(class_id); }
  if (teacher_id) { sql += ' AND ts.teacher_id = ?'; params.push(teacher_id); }
  sql += ' ORDER BY ts.weekday, ts.start_time';
  res.json({ data: all(sql, ...params) });
});

// ------------------------------------------------------------- lesson plans
router.use('/lesson-plans', makeResource({
  table: 'lesson_plans',
  fields: ['school_id', 'teacher_id', 'class_id', 'subject_id', 'term_id', 'title', 'week', 'body', 'file_path'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN_TEACHER,
  beforeWrite(req, data, existing) {
    if (!existing && !data.teacher_id) data.teacher_id = req.user.id;
    if (req.user.role === 'teacher') {
      // teachers may only manage their own plans
      if (existing && existing.teacher_id !== req.user.id) throw { status: 403, message: 'Not your lesson plan' };
      data.teacher_id = existing ? existing.teacher_id : req.user.id;
    }
  },
}));

// ------------------------------------------------------------- calendar & lost time
router.use('/calendar', makeResource({
  table: 'calendar_events',
  fields: ['school_id', 'title', 'kind', 'start_date', 'end_date', 'notes'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  orderBy: 'start_date',
}));

router.use('/lost-days', makeResource({
  table: 'lost_instruction_days',
  fields: ['school_id', 'date', 'days_lost', 'reason', 'notes'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
  orderBy: 'date DESC',
}));

// ------------------------------------------------------------- years & terms
router.use('/years', makeResource({
  table: 'academic_years',
  fields: ['school_id', 'name', 'start_date', 'end_date', 'is_current'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  orderBy: 'start_date DESC',
  afterWrite(req, row) {
    if (row.is_current) {
      // only one current year per school
      const { run } = require('../db/connection');
      run(`UPDATE academic_years SET is_current = 0, updated_at = datetime('now') WHERE school_id = ? AND id != ?`,
        row.school_id, row.id);
    }
  },
}));

router.use('/terms', makeResource({
  table: 'terms',
  fields: ['academic_year_id', 'name', 'seq', 'start_date', 'end_date', 'is_current'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
  schoolField: null,
  orderBy: 'start_date',
  afterWrite(req, row) {
    if (row.is_current) {
      const { run } = require('../db/connection');
      run(`UPDATE terms SET is_current = 0, updated_at = datetime('now')
           WHERE id != ? AND academic_year_id IN
             (SELECT id FROM academic_years WHERE school_id = ?)`,
        row.id, req.user.school_id);
    }
  },
}));

// Current year + term shortcut used everywhere in the UI
router.get('/current', requireRole(...R.EVERYONE), (req, res) => {
  const year = get(`SELECT * FROM academic_years WHERE school_id = ? AND is_current = 1 AND deleted = 0`, req.user.school_id);
  const term = year
    ? get(`SELECT * FROM terms WHERE academic_year_id = ? AND is_current = 1 AND deleted = 0`, year.id)
    : null;
  res.json({ year, term });
});

module.exports = router;
