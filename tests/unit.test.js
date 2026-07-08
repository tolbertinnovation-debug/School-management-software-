'use strict';
// Unit tests for the pure logic: crypto primitives and the grading engine.
// Run with:  npm test
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.DB_PATH = path.join(__dirname, 'test.db');
const fs = require('fs');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch {}
}

const { hashSecret, verifySecret, signToken, verifyToken } = require('../server/utils/crypto');

test('password hashing round-trips and rejects wrong input', () => {
  const h = hashSecret('Secret#123');
  assert.ok(verifySecret('Secret#123', h));
  assert.ok(!verifySecret('secret#123', h));
  assert.ok(!verifySecret('', h));
  assert.notStrictEqual(hashSecret('Secret#123'), h, 'salted hashes must differ');
});

test('tokens verify, carry payload, and expire', () => {
  const t = signToken({ uid: 7, role: 'teacher' }, 10);
  const p = verifyToken(t);
  assert.strictEqual(p.uid, 7);
  assert.strictEqual(p.role, 'teacher');
  assert.strictEqual(verifyToken(t + 'x'), null, 'tampered token rejected');
  const expired = signToken({ uid: 7 }, -1);
  assert.strictEqual(verifyToken(expired), null, 'expired token rejected');
});

test('grading engine computes weighted finals, letters and rank', () => {
  const { migrate, run, get } = require('../server/db/connection');
  const { uuid } = require('../server/utils/crypto');
  migrate();
  run(`INSERT INTO schools (uuid, name) VALUES (?, 'Test School')`, uuid());
  const schoolId = get('SELECT id FROM schools LIMIT 1').id;
  run(`INSERT INTO academic_years (uuid, school_id, name, start_date, end_date, is_current) VALUES (?,?,?,?,?,1)`,
    uuid(), schoolId, 'Y', '2025-09-01', '2026-07-01');
  run(`INSERT INTO terms (uuid, academic_year_id, name, seq, start_date, end_date, is_current) VALUES (?,?,?,?,?,?,1)`,
    uuid(), 1, 'T1', 1, '2025-09-01', '2026-01-30');
  run(`INSERT INTO classes (uuid, school_id, name, level) VALUES (?,?,?,?)`, uuid(), schoolId, 'G7', '7');
  run(`INSERT INTO subjects (uuid, school_id, name) VALUES (?,?,?)`, uuid(), schoolId, 'Math');
  for (const n of ['A', 'B']) {
    run(`INSERT INTO students (uuid, school_id, student_no, first_name, last_name, class_id) VALUES (?,?,?,?,?,1)`,
      uuid(), schoolId, 'S' + n, n, 'Test');
  }
  // CA quiz (max 20) and exam (max 100)
  run(`INSERT INTO assessments (uuid, school_id, class_id, subject_id, term_id, kind, title, max_score) VALUES (?,?,?,?,?,?,?,?)`,
    uuid(), schoolId, 1, 1, 1, 'quiz', 'Q1', 20);
  run(`INSERT INTO assessments (uuid, school_id, class_id, subject_id, term_id, kind, title, max_score) VALUES (?,?,?,?,?,?,?,?)`,
    uuid(), schoolId, 1, 1, 1, 'exam', 'Exam', 100);
  // Student 1: quiz 18/20 (90%), exam 80 → final = 90*.4 + 80*.6 = 84 → B
  run(`INSERT INTO scores (uuid, assessment_id, student_id, score) VALUES (?,?,?,?)`, uuid(), 1, 1, 18);
  run(`INSERT INTO scores (uuid, assessment_id, student_id, score) VALUES (?,?,?,?)`, uuid(), 2, 1, 80);
  // Student 2: quiz 10/20 (50%), exam 60 → final = 50*.4 + 60*.6 = 56 → F, fails
  run(`INSERT INTO scores (uuid, assessment_id, student_id, score) VALUES (?,?,?,?)`, uuid(), 1, 2, 10);
  run(`INSERT INTO scores (uuid, assessment_id, student_id, score) VALUES (?,?,?,?)`, uuid(), 2, 2, 60);

  const { computeTermResults } = require('../server/services/grading');
  const { students } = computeTermResults(1, 1, schoolId);
  assert.strictEqual(students[1].subjects[1].final, 84);
  assert.strictEqual(students[1].subjects[1].letter, 'B');
  assert.strictEqual(students[1].subjects[1].pass, true);
  assert.strictEqual(students[1].rank, 1);
  assert.strictEqual(students[2].subjects[1].final, 56);
  assert.strictEqual(students[2].subjects[1].letter, 'F');
  assert.strictEqual(students[2].subjects[1].pass, false);
  assert.strictEqual(students[2].rank, 2);
  assert.strictEqual(students[1].class_size, 2);
});
