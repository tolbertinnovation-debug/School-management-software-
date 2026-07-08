'use strict';
const { verifyToken } = require('../utils/crypto');
const { get, run } = require('../db/connection');

// Attach req.user from Authorization: Bearer <token>
function authenticate(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not signed in or session expired' });
  const user = get('SELECT * FROM users WHERE id = ? AND deleted = 0 AND active = 1', payload.uid);
  if (!user) return res.status(401).json({ error: 'Account disabled' });
  req.user = {
    id: user.id, role: user.role, school_id: user.school_id,
    name: user.full_name, county: user.county,
  };
  next();
}

// Role gate. Usage: requireRole('school_admin','accountant')
// super_admin passes every gate; county_officer passes read-only gates via 'county_officer'.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });
    if (req.user.role === 'super_admin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Your role does not allow this action' });
  };
}

// Every mutating request is written to the audit trail.
function audit(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      try {
        const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
        for (const k of ['password', 'pin', 'new_password', 'password_hash', 'pin_hash']) delete body[k];
        run(
          `INSERT INTO audit_log (user_id, user_name, role, school_id, action, entity, entity_id, detail, ip)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          req.user ? req.user.id : null,
          req.user ? req.user.name : 'anonymous',
          req.user ? req.user.role : null,
          req.user ? req.user.school_id : null,
          `${req.method} ${req.baseUrl}${req.path}`,
          req.auditEntity || null,
          req.auditEntityId != null ? String(req.auditEntityId) : null,
          JSON.stringify(body).slice(0, 2000),
          req.ip
        );
      } catch { /* auditing must never break the request */ }
    });
  }
  next();
}

// Restrict a query to the caller's school. Super admin may pass ?school_id=.
function schoolScope(req) {
  if (req.user.role === 'super_admin' && req.query.school_id) return Number(req.query.school_id);
  return req.user.school_id;
}

// Parents/students may only see students linked to them; staff see their school.
function studentAccessOk(req, studentId) {
  if (['super_admin', 'county_officer'].includes(req.user.role)) return true;
  if (['school_admin', 'teacher', 'accountant'].includes(req.user.role)) {
    const s = get('SELECT id FROM students WHERE id = ? AND school_id = ?', studentId, req.user.school_id);
    return Boolean(s);
  }
  if (req.user.role === 'student') {
    return Boolean(get('SELECT id FROM students WHERE id = ? AND user_id = ?', studentId, req.user.id));
  }
  if (req.user.role === 'parent') {
    return Boolean(get(
      `SELECT sg.student_id FROM student_guardians sg
        JOIN guardians g ON g.id = sg.guardian_id
       WHERE g.user_id = ? AND sg.student_id = ?`, req.user.id, studentId));
  }
  return false;
}

module.exports = { authenticate, requireRole, audit, schoolScope, studentAccessOk };
