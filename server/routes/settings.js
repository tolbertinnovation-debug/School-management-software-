'use strict';
const express = require('express');
const path = require('path');
const { all, get, run, db } = require('../db/connection');
const { requireRole } = require('../middleware/auth');
const { makeBackup } = require('../db/backup');
const { DEFAULTS } = require('../services/grading');

const router = express.Router();

// School profile
router.get('/school', requireRole('school_admin', 'teacher', 'accountant', 'county_officer'), (req, res) => {
  res.json({ data: get('SELECT * FROM schools WHERE id = ?', req.user.school_id) });
});

router.put('/school', requireRole('school_admin'), (req, res) => {
  const allowed = ['name', 'emis_code', 'county', 'district', 'address', 'phone', 'email',
    'motto', 'principal', 'school_type', 'levels', 'currency'];
  const sets = [], params = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { sets.push(`${k} = ?`); params.push(req.body[k]); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  run(`UPDATE schools SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    ...params, req.user.school_id);
  res.json({ data: get('SELECT * FROM schools WHERE id = ?', req.user.school_id) });
});

// Key-value settings (grading config, notification prefs, language, sms sender...)
router.get('/kv', requireRole('school_admin', 'teacher', 'accountant'), (req, res) => {
  const rows = all('SELECT key, value FROM settings WHERE school_id = ?', req.user.school_id);
  const out = Object.fromEntries(rows.map(r => {
    try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, r.value]; }
  }));
  if (!out.grading) out.grading = DEFAULTS;
  res.json({ data: out });
});

router.put('/kv/:key', requireRole('school_admin'), (req, res) => {
  const key = req.params.key;
  const allowed = ['grading', 'notifications', 'language', 'library_fine_per_day_cents', 'report_card_footer'];
  if (!allowed.includes(key)) return res.status(400).json({ error: `key must be one of: ${allowed.join(', ')}` });
  run(`INSERT INTO settings (school_id, key, value) VALUES (?,?,?)
       ON CONFLICT(school_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    req.user.school_id, key, JSON.stringify(req.body.value));
  res.json({ ok: true });
});

// Trigger an on-demand backup; the snapshot can then be copied to USB/SD.
router.post('/backup', requireRole('school_admin'), (req, res) => {
  try {
    const file = makeBackup(db);
    res.json({ ok: true, file: path.basename(file), note: 'Snapshot saved in data/backups — copy it to a USB drive for safe keeping.' });
  } catch (e) {
    res.status(500).json({ error: 'Backup failed: ' + e.message });
  }
});

router.get('/backups', requireRole('school_admin'), (req, res) => {
  const fs = require('fs');
  const config = require('../config');
  const files = fs.existsSync(config.backupsDir)
    ? fs.readdirSync(config.backupsDir).filter(f => f.endsWith('.db')).sort().reverse()
    : [];
  res.json({ data: files });
});

module.exports = router;
