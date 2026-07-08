'use strict';
const express = require('express');
const { all, get, run } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');
const sms = require('../services/sms');

const router = express.Router();

// ------------------------------------------------------------- announcements
router.use('/announcements', makeResource({
  table: 'announcements',
  fields: ['school_id', 'title', 'body', 'audience', 'publish_date', 'expires'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN_TEACHER,
  orderBy: 'publish_date DESC',
  beforeWrite(req, data, existing) {
    if (!existing) {
      data.created_by = req.user.id;
      if (!data.publish_date) data.publish_date = new Date().toISOString().slice(0, 10);
    }
  },
}));

// ------------------------------------------------------------- bulk SMS
// { to: 'all_parents' | 'class:<id>' | 'staff' | 'defaulters', body, phones?: [] }
router.post('/bulk-sms', requireRole('school_admin', 'accountant'), (req, res) => {
  if (opGuard(req, res)) return;
  const { to, body, phones } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  const schoolId = req.user.school_id;
  let targets = [];
  if (Array.isArray(phones) && phones.length) {
    targets = phones.map(p => ({ phone: String(p).replace(/[^\d+]/g, ''), user_id: null }));
  } else if (to === 'all_parents') {
    targets = all(`SELECT DISTINCT g.phone, g.user_id FROM guardians g
                    JOIN student_guardians sg ON sg.guardian_id = g.id
                    JOIN students s ON s.id = sg.student_id AND s.status = 'active' AND s.deleted = 0
                   WHERE g.school_id = ? AND g.deleted = 0 AND g.phone IS NOT NULL`, schoolId);
  } else if (to && to.startsWith('class:')) {
    targets = all(`SELECT DISTINCT g.phone, g.user_id FROM guardians g
                    JOIN student_guardians sg ON sg.guardian_id = g.id
                    JOIN students s ON s.id = sg.student_id AND s.deleted = 0 AND s.status = 'active'
                   WHERE s.class_id = ? AND g.deleted = 0 AND g.phone IS NOT NULL`,
      Number(to.slice(6)));
  } else if (to === 'staff') {
    targets = all(`SELECT phone, user_id FROM staff WHERE school_id = ? AND deleted = 0
                    AND status = 'active' AND phone IS NOT NULL`, schoolId);
  } else {
    return res.status(400).json({ error: 'Choose recipients: all_parents, class:<id>, staff, or a phones[] list' });
  }
  const seen = new Set();
  let queued = 0;
  for (const t of targets) {
    if (!t.phone || seen.has(t.phone)) continue;
    seen.add(t.phone);
    sms.queue({ schoolId, toPhone: t.phone, toUserId: t.user_id, fromUserId: req.user.id, trigger: 'manual', body });
    queued++;
  }
  const result = { ok: true, sms_queued: queued };
  opRecord(req, result);
  res.json(result);
});

// ------------------------------------------------------------- outbox / history
router.get('/messages', requireRole(...R.ALL_STAFF), (req, res) => {
  const { status, trigger, direction } = req.query;
  let sql = `SELECT m.*, u.full_name AS to_user_name, s.first_name || ' ' || s.last_name AS student_name
               FROM messages m
               LEFT JOIN users u ON u.id = m.to_user_id
               LEFT JOIN students s ON s.id = m.student_id
              WHERE m.deleted = 0 AND m.school_id = ?`;
  const params = [req.user.school_id];
  if (status) { sql += ' AND m.status = ?'; params.push(status); }
  if (trigger) { sql += ' AND m.trigger = ?'; params.push(trigger); }
  if (direction) { sql += ' AND m.direction = ?'; params.push(direction); }
  sql += ' ORDER BY m.id DESC LIMIT 500';
  res.json({ data: all(sql, ...params) });
});

// Export queued SMS as CSV (for offline schools that send from a phone)
router.get('/messages/export-queued', requireRole('school_admin'), (req, res) => {
  const rows = all(`SELECT id, to_phone, body FROM messages
                     WHERE school_id = ? AND status = 'queued' AND direction = 'out' AND deleted = 0`,
    req.user.school_id);
  const csv = 'phone,message\n' + rows.map(r => `${r.to_phone},"${r.body.replace(/"/g, '""')}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sms-outbox.csv"');
  res.send(csv);
});

// Mark exported messages as sent manually
router.post('/messages/mark-sent', requireRole('school_admin'), (req, res) => {
  const { message_ids } = req.body || {};
  if (!Array.isArray(message_ids)) return res.status(400).json({ error: 'message_ids[] required' });
  for (const id of message_ids) {
    run(`UPDATE messages SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND school_id = ?`, id, req.user.school_id);
  }
  res.json({ ok: true, marked: message_ids.length });
});

// ------------------------------------------------------------- two-way threads
// A parent (or staff) sends an in-app message; replies share thread_id.
router.post('/threads', requireRole(...R.EVERYONE), (req, res) => {
  if (opGuard(req, res)) return;
  const { thread_id, to_user_id, student_id, body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Message body required' });
  const tid = thread_id || uuid();
  // parents can only start threads about their own children
  if (req.user.role === 'parent' && student_id) {
    const ok = get(`SELECT sg.student_id FROM student_guardians sg
                     JOIN guardians g ON g.id = sg.guardian_id
                    WHERE g.user_id = ? AND sg.student_id = ?`, req.user.id, student_id);
    if (!ok) return res.status(403).json({ error: 'Not your student' });
  }
  const info = run(
    `INSERT INTO messages (uuid, school_id, direction, channel, to_user_id, from_user_id,
       student_id, thread_id, trigger, body, status)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'sent')`,
    uuid(), req.user.school_id, ['parent', 'student'].includes(req.user.role) ? 'in' : 'out',
    'app', to_user_id || null, req.user.id, student_id || null, tid, 'manual', String(body).slice(0, 1000));
  const result = { data: get('SELECT * FROM messages WHERE id = ?', info.lastInsertRowid) };
  opRecord(req, result);
  res.status(201).json(result);
});

router.get('/threads', requireRole(...R.EVERYONE), (req, res) => {
  // staff see school threads; parents see their own
  let rows;
  if (['parent', 'student'].includes(req.user.role)) {
    rows = all(`SELECT m.*, u.full_name AS from_name FROM messages m
                 LEFT JOIN users u ON u.id = m.from_user_id
                WHERE m.channel = 'app' AND m.deleted = 0
                  AND (m.from_user_id = ? OR m.to_user_id = ?)
                ORDER BY m.id DESC LIMIT 200`, req.user.id, req.user.id);
  } else {
    rows = all(`SELECT m.*, u.full_name AS from_name FROM messages m
                 LEFT JOIN users u ON u.id = m.from_user_id
                WHERE m.channel = 'app' AND m.deleted = 0 AND m.school_id = ?
                ORDER BY m.id DESC LIMIT 500`, req.user.school_id);
  }
  res.json({ data: rows });
});

// ------------------------------------------------------------- parent-teacher meetings
router.use('/meetings', makeResource({
  table: 'meetings',
  fields: ['school_id', 'teacher_id', 'guardian_id', 'student_id', 'date', 'time', 'purpose', 'status'],
  readRoles: R.EVERYONE, writeRoles: [...R.ADMIN_TEACHER, 'parent'],
  orderBy: 'date DESC',
  afterWrite(req, row, action) {
    if (row.status === 'confirmed' && row.guardian_id) {
      const g = get('SELECT phone FROM guardians WHERE id = ?', row.guardian_id);
      if (g && g.phone) {
        const t = get('SELECT full_name FROM users WHERE id = ?', row.teacher_id);
        sms.queue({
          schoolId: row.school_id, toPhone: g.phone, trigger: 'meeting',
          body: `Meeting confirmed with ${t ? t.full_name : 'the teacher'} on ${row.date}${row.time ? ' at ' + row.time : ''}. ${row.purpose || ''}`.trim(),
        });
      }
    }
  },
}));

// Emergency broadcast (school closure etc.) — SMS everyone
router.post('/emergency', requireRole('school_admin'), (req, res) => {
  if (opGuard(req, res)) return;
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Message body required' });
  const schoolId = req.user.school_id;
  const parents = all(`SELECT DISTINCT phone, user_id FROM guardians WHERE school_id = ? AND deleted = 0 AND phone IS NOT NULL`, schoolId);
  const staff = all(`SELECT phone, user_id FROM staff WHERE school_id = ? AND deleted = 0 AND phone IS NOT NULL`, schoolId);
  const seen = new Set();
  let queued = 0;
  for (const t of [...parents, ...staff]) {
    if (!t.phone || seen.has(t.phone)) continue;
    seen.add(t.phone);
    sms.queue({ schoolId, toPhone: t.phone, toUserId: t.user_id, fromUserId: req.user.id, trigger: 'emergency', body: `URGENT: ${body}` });
    queued++;
  }
  const result = { ok: true, sms_queued: queued };
  opRecord(req, result);
  res.json(result);
});

module.exports = router;
