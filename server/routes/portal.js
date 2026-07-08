'use strict';
// Parent & student portal — read-only views of the caller's own children,
// designed for tiny payloads (one request returns everything a parent needs).
const express = require('express');
const { all, get } = require('../db/connection');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function myStudents(req) {
  if (req.user.role === 'student') {
    return all(`SELECT s.*, c.name AS class_name FROM students s
                 LEFT JOIN classes c ON c.id = s.class_id
                WHERE s.user_id = ? AND s.deleted = 0`, req.user.id);
  }
  return all(
    `SELECT s.*, c.name AS class_name, sg.is_primary FROM students s
      JOIN student_guardians sg ON sg.student_id = s.id
      JOIN guardians g ON g.id = sg.guardian_id
      LEFT JOIN classes c ON c.id = s.class_id
     WHERE g.user_id = ? AND s.deleted = 0`, req.user.id);
}

// Everything for the portal home screen in one call (low bandwidth)
router.get('/home', requireRole('parent', 'student'), (req, res) => {
  const students = myStudents(req);
  const school = get('SELECT id, name, motto, phone, county, currency FROM schools WHERE id = ?', req.user.school_id);
  const term = get(
    `SELECT t.* FROM terms t JOIN academic_years y ON y.id = t.academic_year_id
     WHERE y.school_id = ? AND t.is_current = 1 AND t.deleted = 0`, req.user.school_id);
  const children = students.map(s => {
    const att = get(
      `SELECT SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) AS late
         FROM attendance WHERE student_id = ? AND deleted = 0
          AND date >= COALESCE(?, '0000')`, s.id, term ? term.start_date : null) || {};
    const billed = get(
      `SELECT COALESCE(SUM(total_cents - discount_cents),0) AS s FROM invoices
        WHERE student_id = ? AND deleted = 0 AND status != 'void'`, s.id).s;
    const paid = get(
      `SELECT COALESCE(SUM(amount_cents),0) AS s FROM payments WHERE student_id = ? AND deleted = 0`, s.id).s;
    const card = term ? get(
      `SELECT term_id, average, rank, class_size, published FROM report_cards
        WHERE student_id = ? AND term_id = ? AND deleted = 0 AND published = 1`, s.id, term.id) : null;
    return {
      id: s.id, student_no: s.student_no, name: `${s.first_name} ${s.last_name}`,
      class_name: s.class_name, photo_path: s.photo_path,
      attendance: { present: att.present || 0, absent: att.absent || 0, late: att.late || 0 },
      fees: { billed_cents: billed, paid_cents: paid, balance_cents: billed - paid },
      report_card: card,
    };
  });
  const announcements = all(
    `SELECT id, title, body, publish_date FROM announcements
      WHERE school_id = ? AND deleted = 0 AND audience IN ('all','parents')
        AND (expires IS NULL OR expires >= date('now'))
      ORDER BY publish_date DESC LIMIT 10`, req.user.school_id);
  const events = all(
    `SELECT title, kind, start_date, end_date FROM calendar_events
      WHERE school_id = ? AND deleted = 0 AND start_date >= date('now','-7 days')
      ORDER BY start_date LIMIT 10`, req.user.school_id);
  res.json({ school, term, children, announcements, events });
});

// Child detail: recent attendance, discipline (parent-visible), payments
router.get('/child/:id', requireRole('parent', 'student'), (req, res) => {
  const mine = myStudents(req).find(s => s.id === Number(req.params.id));
  if (!mine) return res.status(403).json({ error: 'Not your child' });
  const attendance = all(
    `SELECT date, status, note FROM attendance WHERE student_id = ? AND deleted = 0
     ORDER BY date DESC LIMIT 60`, mine.id);
  const discipline = all(
    `SELECT date, category, description, action FROM discipline_records
      WHERE student_id = ? AND deleted = 0 AND visible_to_parent = 1 ORDER BY date DESC LIMIT 20`, mine.id);
  const payments = all(
    `SELECT receipt_no, amount_cents, method, date FROM payments
      WHERE student_id = ? AND deleted = 0 ORDER BY date DESC LIMIT 20`, mine.id);
  const cards = all(
    `SELECT rc.term_id, rc.average, rc.rank, rc.class_size, t.name AS term_name, y.name AS year_name
       FROM report_cards rc JOIN terms t ON t.id = rc.term_id
       JOIN academic_years y ON y.id = t.academic_year_id
      WHERE rc.student_id = ? AND rc.published = 1 AND rc.deleted = 0
      ORDER BY y.start_date DESC, t.seq DESC`, mine.id);
  res.json({
    student: { id: mine.id, name: `${mine.first_name} ${mine.last_name}`, student_no: mine.student_no, class_name: mine.class_name },
    attendance, discipline, payments, report_cards: cards,
  });
});

module.exports = router;
