'use strict';
// EMIS export — produces the Annual School Census–style dataset the Liberia
// Ministry of Education collects (school identification, enrollment by grade
// x gender x age, staff by qualification, WASH-adjacent facility fields are
// left for manual entry). Output is CSV so it can be loaded into the LEMIS
// templates or emailed to the County Education Office.
const { all, get } = require('../db/connection');

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  const head = columns.map(c => csvEscape(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvEscape(r[c.key])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

function age(dob, onDate) {
  if (!dob) return null;
  const d = new Date(dob), o = new Date(onDate || Date.now());
  let a = o.getFullYear() - d.getFullYear();
  if (o.getMonth() < d.getMonth() || (o.getMonth() === d.getMonth() && o.getDate() < d.getDate())) a--;
  return a;
}

// Enrollment by grade level, gender and age band
function enrollmentCsv(schoolId) {
  const school = get('SELECT * FROM schools WHERE id = ?', schoolId);
  const students = all(
    `SELECT s.gender, s.dob, s.county, c.level
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.school_id = ? AND s.deleted = 0 AND s.status = 'active'`, schoolId
  );
  const byLevel = {};
  for (const s of students) {
    const lvl = s.level || 'unassigned';
    const b = (byLevel[lvl] ||= { level: lvl, male: 0, female: 0, under6: 0, a6_11: 0, a12_14: 0, a15_17: 0, over17: 0, total: 0 });
    if (s.gender === 'M') b.male++; else if (s.gender === 'F') b.female++;
    const a = age(s.dob);
    if (a !== null) {
      if (a < 6) b.under6++; else if (a <= 11) b.a6_11++;
      else if (a <= 14) b.a12_14++; else if (a <= 17) b.a15_17++; else b.over17++;
    }
    b.total++;
  }
  const rows = Object.values(byLevel).map(r => ({
    emis_code: school.emis_code, school_name: school.name, county: school.county,
    district: school.district, ...r,
  }));
  return toCsv(rows, [
    { key: 'emis_code', label: 'EMIS Code' }, { key: 'school_name', label: 'School Name' },
    { key: 'county', label: 'County' }, { key: 'district', label: 'District' },
    { key: 'level', label: 'Grade Level' }, { key: 'male', label: 'Male' },
    { key: 'female', label: 'Female' }, { key: 'under6', label: 'Age <6' },
    { key: 'a6_11', label: 'Age 6-11' }, { key: 'a12_14', label: 'Age 12-14' },
    { key: 'a15_17', label: 'Age 15-17' }, { key: 'over17', label: 'Age 18+' },
    { key: 'total', label: 'Total' },
  ]);
}

// Teaching staff by qualification and gender
function staffCsv(schoolId) {
  const school = get('SELECT * FROM schools WHERE id = ?', schoolId);
  const rows = all(
    `SELECT st.staff_no, u.full_name, st.position, st.qualification, st.payroll_type,
            st.gov_payroll_no, st.hire_date, st.status
       FROM staff st LEFT JOIN users u ON u.id = st.user_id
      WHERE st.school_id = ? AND st.deleted = 0`, schoolId
  ).map(r => ({ emis_code: school.emis_code, school_name: school.name, ...r }));
  return toCsv(rows, [
    { key: 'emis_code', label: 'EMIS Code' }, { key: 'school_name', label: 'School Name' },
    { key: 'staff_no', label: 'Staff No' }, { key: 'full_name', label: 'Name' },
    { key: 'position', label: 'Position' }, { key: 'qualification', label: 'Qualification' },
    { key: 'payroll_type', label: 'Payroll Type' }, { key: 'gov_payroll_no', label: 'Govt Payroll No' },
    { key: 'hire_date', label: 'Hire Date' }, { key: 'status', label: 'Status' },
  ]);
}

// Full student register (for census verification / transfers)
function registerCsv(schoolId) {
  const rows = all(
    `SELECT s.student_no, s.first_name, s.middle_name, s.last_name, s.gender, s.dob,
            s.county, s.status, s.admission_date, c.name AS class_name, c.level
       FROM students s LEFT JOIN classes c ON c.id = s.class_id
      WHERE s.school_id = ? AND s.deleted = 0 ORDER BY c.level, s.last_name`, schoolId
  );
  return toCsv(rows, [
    { key: 'student_no', label: 'Student ID' }, { key: 'first_name', label: 'First Name' },
    { key: 'middle_name', label: 'Middle Name' }, { key: 'last_name', label: 'Last Name' },
    { key: 'gender', label: 'Sex' }, { key: 'dob', label: 'Date of Birth' },
    { key: 'county', label: 'County of Origin' }, { key: 'class_name', label: 'Class' },
    { key: 'level', label: 'Grade' }, { key: 'status', label: 'Status' },
    { key: 'admission_date', label: 'Admission Date' },
  ]);
}

module.exports = { enrollmentCsv, staffCsv, registerCsv, toCsv };
