'use strict';
const express = require('express');
const path = require('path');
const zlib = require('zlib');
const config = require('./config');
const { migrate, db, get } = require('./db/connection');
const { authenticate, audit } = require('./middleware/auth');
const backup = require('./db/backup');
const sms = require('./services/sms');

migrate();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));   // student photos arrive as small data URLs

// Security headers (self-contained CSP: no external requests, everything local)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  next();
});

// Low-bandwidth mode: gzip JSON responses over ~1KB
app.use((req, res, next) => {
  const accept = req.headers['accept-encoding'] || '';
  if (!accept.includes('gzip')) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    const str = JSON.stringify(body);
    if (str.length < 1024) return json(body);
    const buf = zlib.gzipSync(Buffer.from(str), { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(buf);
  };
  next();
});

// Static PWA + uploaded photos + offline user manual
app.use(express.static(path.join(config.root, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(config.uploadsDir, { maxAge: '7d' }));
app.use('/docs', express.static(path.join(config.root, 'docs'), { maxAge: '1h' }));

// Health check (also used by the PWA to detect connectivity for sync)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), version: require('../package.json').version });
});

// Public routes
app.use('/api/auth', require('./routes/auth'));

// Everything below requires a signed-in user; all writes hit the audit log.
app.use('/api', authenticate, audit);
app.use('/api/students', require('./routes/students'));
app.use('/api/academics', require('./routes/academics'));
app.use('/api/grades', require('./routes/grades'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/comms', require('./routes/comms'));
app.use('/api/transport', require('./routes/transport'));
app.use('/api/library', require('./routes/library'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));

// SPA fallback for client-side routes
app.get(/^\/(?!api|uploads).*/, (req, res) => {
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

// Error handler — never leak stack traces
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong. Try again.' });
});

app.listen(config.port, config.host, () => {
  const school = get('SELECT name FROM schools WHERE deleted = 0 LIMIT 1');
  console.log(`Ma Weade School Suite running at http://${config.host}:${config.port}`);
  console.log(school
    ? `School: ${school.name}`
    : 'No school configured yet — run "npm run seed" for demo data or sign in as the setup admin.');
  if (config.authSecret === 'change-me-please') {
    console.warn('WARNING: AUTH_SECRET is the default. Set a real secret in .env before going live.');
  }
  backup.startSchedule(db);
  sms.startPump();
});
