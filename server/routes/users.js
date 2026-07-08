'use strict';
const express = require('express');
const { all, get, run } = require('../db/connection');
const { uuid, hashSecret } = require('../utils/crypto');
const { requireRole } = require('../middleware/auth');
const { opGuard, opRecord } = require('../lib/resource');

const router = express.Router();
const STAFF_ROLES = ['school_admin', 'teacher', 'accountant'];

router.get('/', requireRole('school_admin', 'county_officer'), (req, res) => {
  const { role } = req.query;
  let sql = `SELECT id, uuid, role, full_name, username, phone, email, active, last_login, updated_at
               FROM users WHERE deleted = 0 AND school_id = ?`;
  const params = [req.user.school_id];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  sql += ' ORDER BY role, full_name';
  res.json({ data: all(sql, ...params) });
});

// Create a staff account (teachers, accountants, additional admins)
router.post('/', requireRole('school_admin'), (req, res) => {
  if (opGuard(req, res)) return;
  const { role, full_name, username, phone, email, password } = req.body || {};
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: `role must be one of ${STAFF_ROLES.join(', ')}` });
  if (!full_name || !username) return res.status(400).json({ error: 'full_name and username are required' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const uname = String(username).trim().toLowerCase();
  if (get('SELECT id FROM users WHERE username = ? AND deleted = 0', uname)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const info = run(
    `INSERT INTO users (uuid, school_id, role, full_name, username, phone, email, password_hash)
     VALUES (?,?,?,?,?,?,?,?)`,
    uuid(), req.user.school_id, role, full_name, uname,
    phone ? String(phone).replace(/[^\d+]/g, '') : null, email || null, hashSecret(password));
  const row = get('SELECT id, role, full_name, username, phone, email FROM users WHERE id = ?', info.lastInsertRowid);
  req.auditEntity = 'users'; req.auditEntityId = row.id;
  const result = { data: row };
  opRecord(req, result);
  res.status(201).json(result);
});

// Update account (name, contact, role, active). Password resets are separate.
router.put('/:id', requireRole('school_admin'), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ? AND deleted = 0 AND school_id = ?', req.params.id, req.user.school_id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { full_name, phone, email, role, active } = req.body || {};
  if (role && user.role !== role) {
    if (!STAFF_ROLES.includes(role) || !STAFF_ROLES.concat('parent', 'student').includes(user.role)) {
      return res.status(400).json({ error: 'Cannot change to that role' });
    }
  }
  if (Number(req.params.id) === req.user.id && active === 0) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  run(
    `UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone),
       email = COALESCE(?, email), role = COALESCE(?, role),
       active = COALESCE(?, active), updated_at = datetime('now') WHERE id = ?`,
    full_name ?? null, phone ? String(phone).replace(/[^\d+]/g, '') : null,
    email ?? null, role ?? null, active ?? null, req.params.id);
  req.auditEntity = 'users'; req.auditEntityId = req.params.id;
  res.json({ data: get('SELECT id, role, full_name, username, phone, email, active FROM users WHERE id = ?', req.params.id) });
});

// Reset a staff password or parent PIN
router.post('/:id/reset-credential', requireRole('school_admin'), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ? AND deleted = 0 AND school_id = ?', req.params.id, req.user.school_id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { password, pin } = req.body || {};
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    run(`UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`,
      hashSecret(password), user.id);
  } else if (pin) {
    if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    run(`UPDATE users SET pin_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`,
      hashSecret(pin), user.id);
  } else {
    return res.status(400).json({ error: 'Provide password or pin' });
  }
  req.auditEntity = 'users'; req.auditEntityId = user.id;
  res.json({ ok: true });
});

module.exports = router;
