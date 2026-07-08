'use strict';
const express = require('express');
const { all, run, tx } = require('../db/connection');
const { uuid } = require('../utils/crypto');
const { requireRole } = require('../middleware/auth');
const { makeResource, R, opGuard, opRecord } = require('../lib/resource');

const router = express.Router();

router.use('/vehicles', makeResource({
  table: 'vehicles',
  fields: ['school_id', 'plate_no', 'model', 'capacity', 'driver_staff_id', 'status'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
}));

router.use('/routes', makeResource({
  table: 'bus_routes',
  fields: ['school_id', 'name', 'stops_json', 'vehicle_id', 'fee_cents'],
  readRoles: R.EVERYONE, writeRoles: R.ADMIN,
}));

router.use('/assignments', makeResource({
  table: 'route_assignments',
  fields: ['route_id', 'student_id', 'stop'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
  schoolField: null,
}));

router.use('/maintenance', makeResource({
  table: 'vehicle_maintenance',
  fields: ['vehicle_id', 'date', 'description', 'cost_cents', 'odometer'],
  readRoles: R.ALL_STAFF, writeRoles: R.ADMIN,
  schoolField: null,
  orderBy: 'date DESC',
}));

// Route roster with student names
router.get('/routes/:id/roster', requireRole(...R.ALL_STAFF), (req, res) => {
  res.json({
    data: all(
      `SELECT ra.id, ra.stop, s.id AS student_id, s.student_no, s.first_name, s.last_name,
              c.name AS class_name
         FROM route_assignments ra
         JOIN students s ON s.id = ra.student_id AND s.deleted = 0
         LEFT JOIN classes c ON c.id = s.class_id
        WHERE ra.route_id = ? AND ra.deleted = 0 ORDER BY ra.stop, s.last_name`, req.params.id),
  });
});

// Daily bus roll call: { route_id, date, trip, records: [{student_id, boarded}] }
router.post('/bus-attendance/bulk', requireRole('school_admin', 'teacher'), (req, res) => {
  if (opGuard(req, res)) return;
  const { route_id, date, trip, records } = req.body || {};
  if (!route_id || !date || !Array.isArray(records)) {
    return res.status(400).json({ error: 'route_id, date and records[] required' });
  }
  let saved = 0;
  tx(() => {
    for (const r of records) {
      if (!r.student_id) continue;
      run(
        `INSERT INTO bus_attendance (uuid, route_id, student_id, date, trip, boarded)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(route_id, student_id, date, trip) DO UPDATE SET
           boarded = excluded.boarded, deleted = 0, updated_at = datetime('now')`,
        uuid(), route_id, r.student_id, date, trip || 'morning', r.boarded ? 1 : 0);
      saved++;
    }
  });
  const result = { ok: true, saved };
  opRecord(req, result);
  res.json(result);
});

module.exports = router;
