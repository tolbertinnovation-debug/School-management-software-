'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { all, get, run, tx } = require('../db/connection');
const { uuid, hashSecret } = require('../utils/crypto');
const { requireRole, schoolScope } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');
const sms = require('../services/sms');
const config = require('../config');

const router = express.Router();

const STUDENT_FIELDS = [
  'school_id', 'student_no', 'first_name', 'middle_name', 'last_name', 'gender', 'dob',
  'photo_path', 'address', 'county', 'nationality', 'class_id', 'admission_date',
  'status', 'status_reason', 'status_date', 'ovc_flag', 'ovc_notes', 'pregnancy_flag',
  'reentry_date', 'disability', 'medical_notes', 'blood_group', 'immunizations',
];

// Generate the next student number: <EMIS-or-SCH>-<year>-<seq>
function nextStudentNo(schoolId) {
  const school = get('SELECT emis_code FROM schools WHERE id = ?', schoolId);
  const prefix = (school && school.emis_code ? school.emis_code : 'SCH') + '-' + new Date().getFullYear() + '-';
  const last = get(
    `SELECT student_no FROM students WHERE school_id = ? AND student_no LIKE ? ORDER BY id DESC LIMIT 1`,
    schoolId, prefix + '%'
  );
  const seq = last ? parseInt(last.student_no.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(seq).padStart(4, '0');
}

// ------------------------------------------------------------- CRUD
router.use('/', makeResource({
  table: 'students',
  fields: STUDENT_FIELDS,
  readRoles: R.ALL_STAFF,
  writeRoles: ['school_admin', 'teacher'],
  orderBy: 'last_name, first_name',
  beforeWrite(req, data, existing) {
    if (!existing) {
      if (!data.first_name || !data.last_name) throw { status: 400, message: 'First and last name are required' };
      if (!data.student_no) data.student_no = nextStudentNo(data.school_id || req.user.school_id);
      if (!data.admission_date) data.admission_date = new Date().toISOString().slice(0, 10);
    }
    // welfare fields are restricted to admins
    if (req.user.role === 'teacher') {
      for (const k of ['ovc_flag', 'ovc_notes', 'pregnancy_flag', 'reentry_date']) delete data[k];
    }
  },
}));

// ------------------------------------------------------------- photo upload (base64, kept small for low bandwidth)
router.post('/:id/photo', requireRole('school_admin', 'teacher'), (req, res) => {
  const student = get('SELECT * FROM students WHERE id = ? AND deleted = 0', req.params.id);
  if (!student) return res.status(404).json({ error: 'Not found' });
  const { image } = req.body || {};  // data URL: data:image/jpeg;base64,...
  const m = /^data:image\/(jpe?g|png|webp);base64,(.+)$/.exec(image || '');
  if (!m) return res.status(400).json({ error: 'Send a JPEG/PNG/WebP data URL in "image"' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 300 * 1024) return res.status(400).json({ error: 'Photo too large — max 300KB. Use the in-app camera which compresses automatically.' });
  const file = `student-${student.id}.${m[1] === 'jpg' ? 'jpeg' : m[1]}`;
  fs.writeFileSync(path.join(config.uploadsDir, file), buf);
  run(`UPDATE students SET photo_path = ?, updated_at = datetime('now') WHERE id = ?`, file, student.id);
  res.json({ ok: true, photo_path: file });
});

// ------------------------------------------------------------- guardians
router.get('/:id/guardians', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({
    data: all(
      `SELECT g.*, sg.is_primary, sg.is_emergency FROM guardians g
        JOIN student_guardians sg ON sg.guardian_id = g.id
       WHERE sg.student_id = ? AND g.deleted = 0`, req.params.id),
  });
});

// Attach a guardian (creates guardian + parent portal account if new phone)
router.post('/:id/guardians', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const student = get('SELECT * FROM students WHERE id = ? AND deleted = 0', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const { full_name, relation, phone, phone2, email, address, occupation, is_primary, pin } = req.body || {};
  if (!full_name) return res.status(400).json({ error: 'Guardian name is required' });
  const normPhone = phone ? String(phone).replace(/[^\d+]/g, '') : null;

  const result = tx(() => {
    let guardian = normPhone
      ? get('SELECT * FROM guardians WHERE phone = ? AND school_id = ? AND deleted = 0', normPhone, student.school_id)
      : null;
    if (!guardian) {
      let userId = null;
      if (normPhone) {
        // create (or reuse) the parent portal login keyed by phone
        const existingUser = get(`SELECT id FROM users WHERE phone = ? AND role = 'parent' AND deleted = 0`, normPhone);
        if (existingUser) userId = existingUser.id;
        else {
          const defaultPin = pin && /^\d{4,6}$/.test(String(pin)) ? String(pin) : normPhone.slice(-4);
          const info = run(
            `INSERT INTO users (uuid, school_id, role, full_name, phone, pin_hash) VALUES (?,?,?,?,?,?)`,
            uuid(), student.school_id, 'parent', full_name, normPhone, hashSecret(defaultPin)
          );
          userId = info.lastInsertRowid;
        }
      }
      const info = run(
        `INSERT INTO guardians (uuid, school_id, full_name, relation, phone, phone2, email, address, occupation, user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uuid(), student.school_id, full_name, relation || null, normPhone, phone2 || null,
        email || null, address || null, occupation || null, userId
      );
      guardian = get('SELECT * FROM guardians WHERE id = ?', info.lastInsertRowid);
    }
    run(`INSERT OR IGNORE INTO student_guardians (student_id, guardian_id, is_primary) VALUES (?,?,?)`,
      student.id, guardian.id, is_primary ? 1 : 0);
    return guardian;
  });
  const out = { data: result, note: result.phone ? 'Parent can now log in with this phone number. Default PIN is the last 4 digits of the phone unless one was provided.' : undefined };
  opRecord(req, out);
  res.status(201).json(out);
});

// ------------------------------------------------------------- attendance
// Bulk mark a whole class: { class_id, date, records: [{student_id, status, note?}] }
router.post('/attendance/bulk', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const { class_id, date, records } = req.body || {};
  if (!class_id || !date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'class_id, date and records[] are required' });
  }
  const term = get(`SELECT t.id FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
                    WHERE t.is_current = 1 AND y.school_id = ? AND t.deleted = 0`, req.user.school_id);
  let absents = 0;
  tx(() => {
    for (const r of records) {
      if (!r.student_id || !['present', 'absent', 'late', 'excused'].includes(r.status)) continue;
      run(
        `INSERT INTO attendance (uuid, student_id, class_id, term_id, date, status, note, marked_by)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(student_id, date) DO UPDATE SET
           status = excluded.status, note = excluded.note, marked_by = excluded.marked_by,
           deleted = 0, updated_at = datetime('now')`,
        uuid(), r.student_id, class_id, term ? term.id : null, date, r.status, r.note || null, req.user.id
      );
      if (r.status === 'absent') absents++;
    }
  });
  // Automated absence alerts to guardians
  let alerts = 0;
  const school = get('SELECT name FROM schools WHERE id = ?', req.user.school_id);
  for (const r of records) {
    if (r.status !== 'absent') continue;
    const st = get('SELECT first_name, last_name FROM students WHERE id = ?', r.student_id);
    if (!st) continue;
    alerts += sms.notifyGuardians(
      r.student_id, 'absence',
      `${school.name}: ${st.first_name} ${st.last_name} was marked ABSENT today ${date}. Please contact the school if this is unexpected.`,
      req.user.school_id
    );
  }
  const result = { ok: true, saved: records.length, absents, sms_queued: alerts };
  opRecord(req, result);
  res.json(result);
});

// Attendance sheet for a class+date (roll call view)
router.get('/attendance/sheet', requireRole(...R.ALL_STAFF), (req, res) => {
  const { class_id, date } = req.query;
  if (!class_id || !date) return res.status(400).json({ error: 'class_id and date are required' });
  const rows = all(
    `SELECT s.id AS student_id, s.student_no, s.first_name, s.last_name, s.gender, s.photo_path,
            a.status, a.note
       FROM students s
       LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ? AND a.deleted = 0
      WHERE s.class_id = ? AND s.deleted = 0 AND s.status = 'active'
      ORDER BY s.last_name, s.first_name`, date, class_id
  );
  res.json({ data: rows });
});

// Attendance report: daily/weekly/monthly/term/year via from+to
router.get('/attendance/report', requireRole(...R.ALL_STAFF), (req, res) => {
  const { from, to, class_id, student_id } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });
  let sql = `
    SELECT s.id AS student_id, s.student_no, s.first_name, s.last_name, c.name AS class_name,
           SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
           SUM(CASE WHEN a.status='absent'  THEN 1 ELSE 0 END) AS absent,
           SUM(CASE WHEN a.status='late'    THEN 1 ELSE 0 END) AS late,
           SUM(CASE WHEN a.status='excused' THEN 1 ELSE 0 END) AS excused,
           COUNT(a.id) AS days_marked
      FROM students s
      LEFT JOIN classes c ON c.id = s.class_id
      LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN ? AND ? AND a.deleted = 0
     WHERE s.school_id = ? AND s.deleted = 0`;
  const params = [from, to, schoolScope(req)];
  if (class_id) { sql += ' AND s.class_id = ?'; params.push(class_id); }
  if (student_id) { sql += ' AND s.id = ?'; params.push(student_id); }
  sql += ' GROUP BY s.id ORDER BY c.name, s.last_name';
  res.json({ data: all(sql, ...params), from, to });
});

// ------------------------------------------------------------- transfers / withdrawal
router.post('/:id/transfer', requireRole('school_admin'), (req, res) => {
  if (opGuard(req, res)) return;
  const student = get('SELECT * FROM students WHERE id = ? AND deleted = 0', req.params.id);
  if (!student) return res.status(404).json({ error: 'Not found' });
  const { kind, date, other_school, reason } = req.body || {};
  if (!['transfer_in', 'transfer_out', 'withdrawal', 'reentry'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be transfer_in, transfer_out, withdrawal or reentry' });
  }
  const newStatus = { transfer_out: 'transferred', withdrawal: 'withdrawn', transfer_in: 'active', reentry: 'active' }[kind];
  tx(() => {
    run(`INSERT INTO student_transfers (uuid, student_id, kind, date, other_school, reason, approved_by)
         VALUES (?,?,?,?,?,?,?)`,
      uuid(), student.id, kind, date || new Date().toISOString().slice(0, 10), other_school || null, reason || null, req.user.id);
    run(`UPDATE students SET status = ?, status_reason = ?, status_date = ?, updated_at = datetime('now') WHERE id = ?`,
      newStatus, reason || kind, date || new Date().toISOString().slice(0, 10), student.id);
    if (kind === 'reentry') {
      run(`UPDATE students SET reentry_date = ?, updated_at = datetime('now') WHERE id = ?`,
        date || new Date().toISOString().slice(0, 10), student.id);
    }
  });
  const result = { ok: true, status: newStatus };
  opRecord(req, result);
  res.json(result);
});

router.get('/:id/transfers', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({ data: all('SELECT * FROM student_transfers WHERE student_id = ? AND deleted = 0 ORDER BY date DESC', req.params.id) });
});

// ------------------------------------------------------------- discipline
router.get('/:id/discipline', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({ data: all(`SELECT d.*, u.full_name AS reported_by_name FROM discipline_records d
                        LEFT JOIN users u ON u.id = d.reported_by
                        WHERE d.student_id = ? AND d.deleted = 0 ORDER BY d.date DESC`, req.params.id) });
});
router.post('/:id/discipline', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const { date, category, description, action, visible_to_parent } = req.body || {};
  if (!description) return res.status(400).json({ error: 'Description is required' });
  const info = run(
    `INSERT INTO discipline_records (uuid, student_id, date, category, description, action, reported_by, visible_to_parent)
     VALUES (?,?,?,?,?,?,?,?)`,
    uuid(), req.params.id, date || new Date().toISOString().slice(0, 10), category || null,
    description, action || null, req.user.id, visible_to_parent === 0 ? 0 : 1
  );
  const result = { data: get('SELECT * FROM discipline_records WHERE id = ?', info.lastInsertRowid) };
  opRecord(req, result);
  res.status(201).json(result);
});

// ------------------------------------------------------------- transcript (academic history)
router.get('/:id/transcript', requireRole(...R.ALL_STAFF), (req, res) => {
  const student = get(
    `SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.id = ? AND s.deleted = 0`, req.params.id);
  if (!student) return res.status(404).json({ error: 'Not found' });
  const cards = all(
    `SELECT rc.*, t.name AS term_name, y.name AS year_name, c.name AS class_name
       FROM report_cards rc
       JOIN terms t ON t.id = rc.term_id
       JOIN academic_years y ON y.id = t.academic_year_id
       LEFT JOIN classes c ON c.id = rc.class_id
      WHERE rc.student_id = ? AND rc.deleted = 0 ORDER BY y.start_date, t.seq`, req.params.id);
  const subjects = all('SELECT id, name FROM subjects WHERE school_id = ? AND deleted = 0', student.school_id);
  res.json({
    student, subjects,
    terms: cards.map(c => ({
      term: c.term_name, year: c.year_name, class: c.class_name,
      average: c.average, rank: c.rank, class_size: c.class_size,
      results: JSON.parse(c.data_json),
    })),
  });
});

// ------------------------------------------------------------- CSV import/export
router.get('/export/csv', requireRole('school_admin', 'county_officer'), (req, res) => {
  const rows = all(
    `SELECT s.student_no, s.first_name, s.middle_name, s.last_name, s.gender, s.dob, s.county,
            s.address, s.status, s.admission_date, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.school_id = ? AND s.deleted = 0 ORDER BY c.name, s.last_name`, schoolScope(req));
  const esc = v => v == null ? '' : (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = 'student_no,first_name,middle_name,last_name,gender,dob,county,address,status,admission_date,class_name';
  const csv = head + '\n' + rows.map(r => head.split(',').map(k => esc(r[k])).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
  res.send(csv);
});

// Import: JSON body { rows: [{first_name,last_name,gender,dob,class_name,...}] }
// (the PWA parses the CSV/Excel file client-side to keep the server simple)
router.post('/import', requireRole('school_admin'), (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows[] required' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Max 2000 rows per import' });
  const classes = all('SELECT id, name FROM classes WHERE school_id = ? AND deleted = 0', req.user.school_id);
  const classByName = Object.fromEntries(classes.map(c => [c.name.toLowerCase(), c.id]));
  let created = 0, skipped = 0;
  const errors = [];
  tx(() => {
    rows.forEach((r, i) => {
      if (!r.first_name || !r.last_name) { skipped++; errors.push(`Row ${i + 1}: missing name`); return; }
      const classId = r.class_name ? classByName[String(r.class_name).toLowerCase()] : null;
      run(
        `INSERT INTO students (uuid, school_id, student_no, first_name, middle_name, last_name,
           gender, dob, county, address, class_id, admission_date, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
        uuid(), req.user.school_id, r.student_no || nextStudentNo(req.user.school_id),
        r.first_name, r.middle_name || null, r.last_name,
        ['M', 'F'].includes(r.gender) ? r.gender : null, r.dob || null, r.county || null,
        r.address || null, classId, r.admission_date || new Date().toISOString().slice(0, 10)
      );
      created++;
    });
  });
  res.json({ ok: true, created, skipped, errors: errors.slice(0, 20) });
});

module.exports = router;
