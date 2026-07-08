'use strict';
// Generic CRUD router factory. Gives every table the same contract:
//   GET    /            list (filters: any ?field=value on allowed fields, ?since= for sync)
//   GET    /:id         fetch one
//   POST   /            create   (accepts client uuid + X-Op-Id for offline replay)
//   PUT    /:id         update
//   DELETE /:id         soft delete
// Handles: school scoping, role gates, soft deletes, updated_at, audit metadata.
const express = require('express');
const { all, get, run } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole } = require('../middleware/auth');

// Replay-safe op guard: if the client already sent this op (offline queue
// retry), return the recorded result instead of applying it twice.
function opGuard(req, res) {
  const opId = req.headers['x-op-id'];
  if (!opId) return null;
  const prev = get('SELECT result_json FROM sync_ops WHERE op_id = ?', opId);
  if (prev) {
    res.status(200).json(JSON.parse(prev.result_json));
    return true;
  }
  return false;
}
function opRecord(req, result) {
  const opId = req.headers['x-op-id'];
  if (!opId) return;
  try {
    run('INSERT OR IGNORE INTO sync_ops (op_id, user_id, result_json) VALUES (?,?,?)',
      opId, req.user ? req.user.id : null, JSON.stringify(result));
  } catch { /* non-fatal */ }
}

/**
 * makeResource({
 *   table, fields, readRoles, writeRoles,
 *   schoolField   — column used for tenant scoping ('school_id' or null),
 *   listSql       — optional custom SELECT for list (must include d.deleted filter),
 *   beforeWrite(req, data)  — mutate/validate payload, throw {status,message} to reject
 *   afterWrite(req, row)    — side effects (SMS triggers etc.)
 * })
 */
function makeResource(opts) {
  const {
    table, fields, readRoles, writeRoles,
    schoolField = 'school_id', listSql = null,
    beforeWrite = null, afterWrite = null, orderBy = 'id DESC',
  } = opts;
  const router = express.Router();
  const cols = fields.join(', ');

  function scopeClause(req, alias = '') {
    const p = alias ? alias + '.' : '';
    if (!schoolField) return { sql: '', params: [] };
    if (req.user.role === 'super_admin') {
      if (req.query.school_id) return { sql: ` AND ${p}${schoolField} = ?`, params: [Number(req.query.school_id)] };
      return { sql: '', params: [] };
    }
    return { sql: ` AND ${p}${schoolField} = ?`, params: [req.user.school_id] };
  }

  router.get('/', requireRole(...readRoles), (req, res) => {
    const scope = scopeClause(req);
    let sql = listSql
      ? listSql
      : `SELECT id, uuid, ${cols}, updated_at, deleted FROM ${table} WHERE deleted = 0`;
    const params = [];
    if (!listSql) {
      sql += scope.sql; params.push(...scope.params);
      // simple equality filters on known fields
      for (const f of fields) {
        if (req.query[f] !== undefined && req.query[f] !== '') {
          sql += ` AND ${f} = ?`; params.push(req.query[f]);
        }
      }
      if (req.query.q && fields.includes('name')) { sql += ` AND name LIKE ?`; params.push(`%${req.query.q}%`); }
      if (req.query.since) {
        // sync pull: include soft-deleted rows so clients can remove them
        sql = sql.replace('WHERE deleted = 0', 'WHERE 1=1');
        sql += ` AND updated_at > ?`; params.push(req.query.since);
      }
      sql += ` ORDER BY ${orderBy} LIMIT ${Math.min(Number(req.query.limit) || 500, 2000)}`;
      if (req.query.offset) sql += ` OFFSET ${Number(req.query.offset)}`;
    } else {
      sql += scope.sql; params.push(...scope.params);
      sql += ` ORDER BY ${orderBy} LIMIT ${Math.min(Number(req.query.limit) || 500, 2000)}`;
    }
    res.json({ data: all(sql, ...params), server_time: new Date().toISOString() });
  });

  router.get('/:id', requireRole(...readRoles), (req, res) => {
    const row = get(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (schoolField && req.user.role !== 'super_admin' && row[schoolField] &&
        row[schoolField] !== req.user.school_id) {
      return res.status(403).json({ error: 'Belongs to another school' });
    }
    res.json({ data: row });
  });

  router.post('/', requireRole(...writeRoles), (req, res) => {
    if (opGuard(req, res)) return;
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    if (schoolField && data[schoolField] === undefined) data[schoolField] = req.user.school_id;
    try { if (beforeWrite) beforeWrite(req, data, null); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const id = uuid();
    const keys = Object.keys(data);
    const info = run(
      `INSERT INTO ${table} (uuid, ${keys.join(',')}) VALUES (?${',?'.repeat(keys.length)})`,
      req.body.uuid || id, ...keys.map(k => data[k])
    );
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, info.lastInsertRowid);
    req.auditEntity = table; req.auditEntityId = row.id;
    if (afterWrite) { try { afterWrite(req, row, 'create'); } catch (e) { console.error(e); } }
    const result = { data: row };
    opRecord(req, result);
    res.status(201).json(result);
  });

  router.put('/:id', requireRole(...writeRoles), (req, res) => {
    if (opGuard(req, res)) return;
    const existing = get(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (schoolField && req.user.role !== 'super_admin' && existing[schoolField] &&
        existing[schoolField] !== req.user.school_id) {
      return res.status(403).json({ error: 'Belongs to another school' });
    }
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    try { if (beforeWrite) beforeWrite(req, data, existing); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const keys = Object.keys(data);
    if (keys.length) {
      run(
        `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        ...keys.map(k => data[k]), req.params.id
      );
    }
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id);
    req.auditEntity = table; req.auditEntityId = row.id;
    if (afterWrite) { try { afterWrite(req, row, 'update'); } catch (e) { console.error(e); } }
    const result = { data: row };
    opRecord(req, result);
    res.json(result);
  });

  router.delete('/:id', requireRole(...writeRoles), (req, res) => {
    if (opGuard(req, res)) return;
    const existing = get(`SELECT * FROM ${table} WHERE id = ? AND deleted = 0`, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (schoolField && req.user.role !== 'super_admin' && existing[schoolField] &&
        existing[schoolField] !== req.user.school_id) {
      return res.status(403).json({ error: 'Belongs to another school' });
    }
    run(`UPDATE ${table} SET deleted = 1, updated_at = datetime('now') WHERE id = ?`, req.params.id);
    req.auditEntity = table; req.auditEntityId = req.params.id;
    const result = { ok: true };
    opRecord(req, result);
    res.json(result);
  });

  return router;
}

// Common role groups
const R = {
  ALL_STAFF: ['school_admin', 'teacher', 'accountant', 'county_officer'],
  ADMIN: ['school_admin'],
  ADMIN_TEACHER: ['school_admin', 'teacher'],
  ADMIN_ACCT: ['school_admin', 'accountant'],
  EVERYONE: ['school_admin', 'teacher', 'accountant', 'parent', 'student', 'county_officer'],
};

module.exports = { makeResource, R, opGuard, opRecord };
