'use strict';
const express = require('express');
const { all, get, run, tx } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');

const router = express.Router();
const FINE_PER_DAY_CENTS = 500; // LRD 5.00/day default; change in settings later

router.use('/books', makeResource({
  table: 'books',
  fields: ['school_id', 'title', 'author', 'isbn', 'category', 'copies', 'available', 'shelf'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN_TEACHER,
  orderBy: 'title',
  beforeWrite(req, data, existing) {
    if (!existing && data.copies !== undefined && data.available === undefined) {
      data.available = data.copies;
    }
  },
}));

// Search catalog by title/author
router.get('/search', requireRole(...R.EVERYONE), (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json({
    data: all(
      `SELECT * FROM books WHERE school_id = ? AND deleted = 0
        AND (title LIKE ? OR author LIKE ? OR category LIKE ?)
       ORDER BY title LIMIT 100`, req.user.school_id, q, q, q),
  });
});

// Borrow: { book_id, student_id | staff_id, due_date }
router.post('/loans', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const { book_id, student_id, staff_id, due_date } = req.body || {};
  if (!book_id || (!student_id && !staff_id)) {
    return res.status(400).json({ error: 'book_id and a borrower (student_id or staff_id) required' });
  }
  const book = get('SELECT * FROM books WHERE id = ? AND deleted = 0', book_id);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (book.available < 1) return res.status(409).json({ error: 'No copies available' });
  const loan = tx(() => {
    run('UPDATE books SET available = available - 1, updated_at = datetime(\'now\') WHERE id = ?', book_id);
    const info = run(
      `INSERT INTO book_loans (uuid, book_id, student_id, staff_id, loan_date, due_date, issued_by)
       VALUES (?,?,?,?,?,?,?)`,
      uuid(), book_id, student_id || null, staff_id || null,
      new Date().toISOString().slice(0, 10),
      due_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      req.user.id);
    return get('SELECT * FROM book_loans WHERE id = ?', info.lastInsertRowid);
  });
  const result = { data: loan };
  opRecord(req, result);
  res.status(201).json(result);
});

// Return: computes overdue fine automatically
router.post('/loans/:id/return', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const loan = get('SELECT * FROM book_loans WHERE id = ? AND deleted = 0', req.params.id);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.return_date) return res.status(409).json({ error: 'Already returned' });
  const today = new Date().toISOString().slice(0, 10);
  const daysLate = Math.max(0, Math.floor((new Date(today) - new Date(loan.due_date)) / 86400000));
  const fine = daysLate * FINE_PER_DAY_CENTS;
  tx(() => {
    run(`UPDATE book_loans SET return_date = ?, fine_cents = ?, updated_at = datetime('now') WHERE id = ?`,
      today, fine, loan.id);
    run(`UPDATE books SET available = available + 1, updated_at = datetime('now') WHERE id = ?`, loan.book_id);
  });
  const result = { ok: true, days_late: daysLate, fine_cents: fine };
  opRecord(req, result);
  res.json(result);
});

// Open loans + overdue list
router.get('/loans', requireRole(...R.ALL_STAFF), (req, res) => {
  const overdueOnly = req.query.overdue === '1';
  let sql = `SELECT l.*, b.title, b.author,
                    s.first_name || ' ' || s.last_name AS student_name, s.student_no,
                    u.full_name AS staff_name
               FROM book_loans l
               JOIN books b ON b.id = l.book_id AND b.school_id = ?
               LEFT JOIN students s ON s.id = l.student_id
               LEFT JOIN staff st ON st.id = l.staff_id
               LEFT JOIN users u ON u.id = st.user_id
              WHERE l.deleted = 0`;
  if (req.query.open === '1' || overdueOnly) sql += ' AND l.return_date IS NULL';
  if (overdueOnly) sql += ` AND l.due_date < date('now')`;
  sql += ' ORDER BY l.due_date LIMIT 500';
  res.json({ data: all(sql, req.user.school_id) });
});

// ------------------------------------------------------------- inventory & procurement
router.use('/assets', makeResource({
  table: 'assets',
  fields: ['school_id', 'tag_no', 'name', 'category', 'quantity', 'location', 'condition',
    'acquired', 'value_cents', 'reorder_level', 'is_consumable'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
  orderBy: 'name',
}));

// Low-stock alert list
router.get('/assets-low-stock', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({
    data: all(
      `SELECT * FROM assets WHERE school_id = ? AND deleted = 0 AND is_consumable = 1
        AND quantity <= reorder_level ORDER BY name`, req.user.school_id),
  });
});

router.use('/procurements', makeResource({
  table: 'procurements',
  fields: ['school_id', 'date', 'item', 'quantity', 'supplier', 'cost_cents', 'status'],
  readRoles: R.ALL_STAFF, writeRoles: ['school_admin', 'accountant'],
  orderBy: 'date DESC',
  beforeWrite(req, data, existing) { if (!existing) data.requested_by = req.user.id; },
}));

module.exports = router;
