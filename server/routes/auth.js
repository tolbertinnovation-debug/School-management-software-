'use strict';
const express = require('express');
const { get, run, all } = require('../db/connection');
const { hashSecret, verifySecret, signToken } = require('../utils/crypto');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function checkLock(user) {
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    return `Account locked. Try again in ${mins} minute(s).`;
  }
  return null;
}

function recordFail(user) {
  const failed = user.failed_logins + 1;
  const lock = failed >= MAX_FAILED
    ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
  run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', failed, lock, user.id);
}

function loginOk(user, res) {
  run(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = datetime('now') WHERE id = ?`, user.id);
  const token = signToken({ uid: user.id, role: user.role });
  const school = user.school_id ? get('SELECT id, name, county, currency, motto, settings_json FROM schools WHERE id = ?', user.school_id) : null;
  res.json({
    token,
    user: { id: user.id, name: user.full_name, role: user.role, school_id: user.school_id, phone: user.phone, username: user.username },
    school,
  });
}

// Staff login: username + password
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Enter username and password' });
  const user = get('SELECT * FROM users WHERE username = ? AND deleted = 0 AND active = 1', String(username).trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Wrong username or password' });
  const locked = checkLock(user);
  if (locked) return res.status(423).json({ error: locked });
  if (!verifySecret(password, user.password_hash)) {
    recordFail(user);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  loginOk(user, res);
});

// Parent/student login: phone number + PIN (no passwords to forget)
router.post('/login-pin', (req, res) => {
  const { phone, pin } = req.body || {};
  if (!phone || !pin) return res.status(400).json({ error: 'Enter phone number and PIN' });
  const normalized = String(phone).replace(/[^\d+]/g, '');
  const user = get(
    `SELECT * FROM users WHERE phone = ? AND role IN ('parent','student') AND deleted = 0 AND active = 1`,
    normalized
  );
  if (!user) return res.status(401).json({ error: 'Phone number not registered. Ask the school office.' });
  const locked = checkLock(user);
  if (locked) return res.status(423).json({ error: locked });
  if (!verifySecret(pin, user.pin_hash)) {
    recordFail(user);
    return res.status(401).json({ error: 'Wrong PIN' });
  }
  loginOk(user, res);
});

router.get('/me', authenticate, (req, res) => {
  const user = get('SELECT id, full_name, role, school_id, phone, username, email, last_login FROM users WHERE id = ?', req.user.id);
  const school = user.school_id ? get('SELECT id, name, county, currency, motto, settings_json FROM schools WHERE id = ?', user.school_id) : null;
  res.json({ user, school });
});

router.post('/change-password', authenticate, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (user.password_hash && !verifySecret(current || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, hashSecret(next), req.user.id);
  res.json({ ok: true });
});

router.post('/change-pin', authenticate, (req, res) => {
  const { current, next } = req.body || {};
  if (!/^\d{4,6}$/.test(String(next || ''))) return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  const user = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (user.pin_hash && !verifySecret(current || '', user.pin_hash)) {
    return res.status(401).json({ error: 'Current PIN is wrong' });
  }
  run(`UPDATE users SET pin_hash = ?, updated_at = datetime('now') WHERE id = ?`, hashSecret(next), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
