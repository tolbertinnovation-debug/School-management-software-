'use strict';
// SMS layer. Everything is written to the `messages` outbox first, so the
// system works with zero connectivity — a background pump delivers queued
// messages whenever the configured gateway is reachable. With the default
// "outbox" provider, messages stay queued and can be exported/sent manually
// (or read out to parents at the school office).
const config = require('../config');
const { all, run, get } = require('../db/connection');
const { uuid } = require('../utils/crypto');

function queue({ schoolId, toPhone, toUserId = null, fromUserId = null, studentId = null,
                 trigger = 'manual', body, threadId = null, channel = 'sms' }) {
  if (!body) return null;
  const info = run(
    `INSERT INTO messages (uuid, school_id, direction, channel, to_phone, to_user_id,
       from_user_id, student_id, thread_id, trigger, body, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'queued')`,
    uuid(), schoolId, 'out', channel, toPhone || null, toUserId, fromUserId,
    studentId, threadId, trigger, String(body).slice(0, 480)
  );
  return info.lastInsertRowid;
}

// Notify all guardians of a student. Used by absence alerts, fee reminders,
// report-card notifications, receipts.
function notifyGuardians(studentId, trigger, body, schoolId) {
  const guardians = all(
    `SELECT g.phone, g.user_id FROM guardians g
      JOIN student_guardians sg ON sg.guardian_id = g.id
     WHERE sg.student_id = ? AND g.deleted = 0 AND g.phone IS NOT NULL`,
    studentId
  );
  for (const g of guardians) {
    queue({ schoolId, toPhone: g.phone, toUserId: g.user_id, studentId, trigger, body });
  }
  return guardians.length;
}

async function deliverViaGateway(msg) {
  const p = config.sms.provider;
  if (p === 'outbox') return { ok: false, keepQueued: true };  // offline mode: stay queued
  if (!config.sms.apiUrl && p === 'custom') return { ok: false, keepQueued: true };
  try {
    let url, options;
    if (p === 'twilio') {
      // Twilio-compatible: SMS_API_URL = https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json
      // SMS_API_KEY = "<SID>:<AuthToken>"
      url = config.sms.apiUrl;
      options = {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(config.sms.apiKey).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: msg.to_phone, From: config.sms.senderId, Body: msg.body }),
      };
    } else {
      // Generic local gateway (Orange Liberia / Lonestar MTN aggregators expose
      // simple HTTP APIs; set SMS_API_URL + SMS_API_KEY to match your contract).
      url = config.sms.apiUrl;
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.sms.apiKey}` },
        body: JSON.stringify({ to: msg.to_phone, from: config.sms.senderId, message: msg.body }),
      };
    }
    const resp = await fetch(url, options);
    if (!resp.ok) throw new Error(`gateway ${resp.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

let pumping = false;
async function pumpOutbox() {
  if (pumping || config.sms.provider === 'outbox') return;
  pumping = true;
  try {
    const queued = all(
      `SELECT * FROM messages WHERE status = 'queued' AND direction = 'out'
        AND channel = 'sms' AND to_phone IS NOT NULL AND deleted = 0 LIMIT 50`
    );
    for (const msg of queued) {
      const r = await deliverViaGateway(msg);
      if (r.ok) {
        run(`UPDATE messages SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, msg.id);
      } else if (!r.keepQueued && r.error) {
        run(`UPDATE messages SET error = ?, updated_at = datetime('now') WHERE id = ?`, r.error.slice(0, 200), msg.id);
      }
    }
  } finally { pumping = false; }
}

function startPump(intervalMs = 60000) {
  if (config.sms.provider === 'outbox') return;   // nothing to pump offline
  setInterval(() => pumpOutbox().catch(() => {}), intervalMs).unref();
}

module.exports = { queue, notifyGuardians, pumpOutbox, startPump };
