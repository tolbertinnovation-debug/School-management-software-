'use strict';
// Grading engine. All scales are configurable per school (settings key
// "grading"); these are the defaults used by most Liberian schools:
//   term grade = CA average x ca_weight + exam x exam_weight (default 40/60)
//   pass mark 70, Liberian letter scale A 90-100 ... F below 60.
const { all, get } = require('../db/connection');

const DEFAULTS = {
  ca_weight: 0.4,
  exam_weight: 0.6,
  pass_mark: 70,
  scale: 'liberian',
  scales: {
    liberian: [
      { min: 90, letter: 'A', remark: 'Excellent', gpa: 4.0 },
      { min: 80, letter: 'B', remark: 'Very Good', gpa: 3.0 },
      { min: 70, letter: 'C', remark: 'Good', gpa: 2.0 },
      { min: 60, letter: 'D', remark: 'Fair', gpa: 1.0 },
      { min: 0,  letter: 'F', remark: 'Fail', gpa: 0.0 },
    ],
    waec: [
      { min: 75, letter: 'A1', remark: 'Excellent', gpa: 4.0 },
      { min: 70, letter: 'B2', remark: 'Very Good', gpa: 3.5 },
      { min: 65, letter: 'B3', remark: 'Good', gpa: 3.0 },
      { min: 60, letter: 'C4', remark: 'Credit', gpa: 2.5 },
      { min: 55, letter: 'C5', remark: 'Credit', gpa: 2.2 },
      { min: 50, letter: 'C6', remark: 'Credit', gpa: 2.0 },
      { min: 45, letter: 'D7', remark: 'Pass', gpa: 1.5 },
      { min: 40, letter: 'E8', remark: 'Pass', gpa: 1.0 },
      { min: 0,  letter: 'F9', remark: 'Fail', gpa: 0.0 },
    ],
  },
};

function schoolGradingConfig(schoolId) {
  const row = get(`SELECT value FROM settings WHERE school_id = ? AND key = 'grading'`, schoolId);
  if (!row) return DEFAULTS;
  try { return { ...DEFAULTS, ...JSON.parse(row.value) }; } catch { return DEFAULTS; }
}

function letterFor(pct, cfg) {
  const scale = cfg.scales[cfg.scale] || cfg.scales.liberian;
  for (const band of scale) if (pct >= band.min) return band;
  return scale[scale.length - 1];
}

// Compute per-subject term results for one class+term.
// Returns { students: { [student_id]: { subjects: {subject_id: {...}}, average } } }
function computeTermResults(classId, termId, schoolId) {
  const cfg = schoolGradingConfig(schoolId);
  const rows = all(
    `SELECT a.subject_id, a.kind, a.max_score, a.weight, s.student_id, s.score
       FROM scores s JOIN assessments a ON a.id = s.assessment_id
      WHERE a.class_id = ? AND a.term_id = ? AND a.deleted = 0 AND s.deleted = 0
        AND s.score IS NOT NULL`,
    classId, termId
  );
  // bucket: student -> subject -> {caPts, caWt, examPts, examWt}
  const acc = {};
  for (const r of rows) {
    const pct = r.max_score > 0 ? (r.score / r.max_score) * 100 : 0;
    const st = (acc[r.student_id] ||= {});
    const sub = (st[r.subject_id] ||= { caPts: 0, caWt: 0, examPts: 0, examWt: 0 });
    if (r.kind === 'exam') { sub.examPts += pct * r.weight; sub.examWt += r.weight; }
    else { sub.caPts += pct * r.weight; sub.caWt += r.weight; }
  }
  const students = {};
  for (const [sid, subjects] of Object.entries(acc)) {
    let total = 0, count = 0;
    const out = {};
    for (const [subId, b] of Object.entries(subjects)) {
      const ca = b.caWt > 0 ? b.caPts / b.caWt : null;
      const exam = b.examWt > 0 ? b.examPts / b.examWt : null;
      let final;
      if (ca !== null && exam !== null) final = ca * cfg.ca_weight + exam * cfg.exam_weight;
      else final = ca !== null ? ca : exam;
      if (final === null || final === undefined) continue;
      final = Math.round(final * 10) / 10;
      const band = letterFor(final, cfg);
      out[subId] = {
        ca: ca === null ? null : Math.round(ca * 10) / 10,
        exam: exam === null ? null : Math.round(exam * 10) / 10,
        final, letter: band.letter, gpa: band.gpa, remark: band.remark,
        pass: final >= cfg.pass_mark,
      };
      total += final; count += 1;
    }
    students[sid] = {
      subjects: out,
      average: count ? Math.round((total / count) * 10) / 10 : null,
      gpa: count
        ? Math.round((Object.values(out).reduce((s, x) => s + x.gpa, 0) / count) * 100) / 100
        : null,
    };
  }
  // class rank by average
  const ranked = Object.entries(students)
    .filter(([, v]) => v.average !== null)
    .sort((a, b) => b[1].average - a[1].average);
  ranked.forEach(([sid], i) => { students[sid].rank = i + 1; });
  const classSize = ranked.length;
  for (const v of Object.values(students)) v.class_size = classSize;
  return { students, config: { ca_weight: cfg.ca_weight, exam_weight: cfg.exam_weight, pass_mark: cfg.pass_mark, scale: cfg.scale } };
}

module.exports = { computeTermResults, schoolGradingConfig, letterFor, DEFAULTS };
