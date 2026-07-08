'use strict';
const path = require('path');
const fs = require('fs');

// Load .env if present (no dependency needed)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const root = path.join(__dirname, '..');

module.exports = {
  root,
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'school.db'),
  authSecret: process.env.AUTH_SECRET || 'change-me-please',
  sessionMinutes: parseInt(process.env.SESSION_MINUTES || '480', 10),
  uploadsDir: process.env.UPLOADS_DIR || path.join(root, 'data', 'uploads'),
  backupsDir: process.env.BACKUPS_DIR || path.join(root, 'data', 'backups'),
  backupHours: parseInt(process.env.BACKUP_HOURS || '24', 10),
  sms: {
    provider: process.env.SMS_PROVIDER || 'outbox',
    apiUrl: process.env.SMS_API_URL || '',
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || 'SCHOOL',
  },
  momo: {
    mtnKey: process.env.MOMO_MTN_API_KEY || '',
    orangeKey: process.env.MOMO_ORANGE_API_KEY || '',
  },
};
