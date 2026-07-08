'use strict';
// Backup: uses SQLite VACUUM INTO for a consistent snapshot even while the
// server is running. Snapshots land in data/backups and can be copied to a
// USB stick / SD card for schools with no connectivity. Run directly
// (`npm run backup`) or on a timer from the server (BACKUP_HOURS).
const fs = require('fs');
const path = require('path');
const config = require('../config');

function makeBackup(db) {
  fs.mkdirSync(config.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(config.backupsDir, `school-${stamp}.db`);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  // keep the 30 newest snapshots
  const files = fs.readdirSync(config.backupsDir).filter(f => f.endsWith('.db')).sort();
  while (files.length > 30) fs.unlinkSync(path.join(config.backupsDir, files.shift()));
  return dest;
}

function startSchedule(db) {
  if (!config.backupHours) return;
  setInterval(() => {
    try { console.log('[backup] wrote', makeBackup(db)); }
    catch (e) { console.error('[backup] failed:', e.message); }
  }, config.backupHours * 3600 * 1000).unref();
}

if (require.main === module) {
  const { db } = require('./connection');
  console.log('Backup written to', makeBackup(db));
}

module.exports = { makeBackup, startSchedule };
