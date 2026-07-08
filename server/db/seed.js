'use strict';
// Demo data: a realistic Liberian school so every module has something to show.
// Safe to run once on a fresh database:  npm run seed
const { db, all, get, run, tx, migrate } = require('./connection');
const { uuid, hashSecret } = require('../utils/crypto');

migrate();

if (get('SELECT id FROM schools LIMIT 1')) {
  console.log('Database already has a school — seed skipped. Delete data/school.db to reseed.');
  process.exit(0);
}

// deterministic PRNG so the demo is reproducible
let seedVal = 42;
function rnd() { seedVal = (seedVal * 1103515245 + 12345) % 2147483648; return seedVal / 2147483648; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function between(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

const FIRST_M = ['Emmanuel', 'Moses', 'Joseph', 'Abraham', 'Samuel', 'Prince', 'James', 'Sekou', 'Varney', 'Momo', 'Alfred', 'Patrick', 'Isaac', 'Daniel', 'Thomas', 'Boakai', 'Amos', 'Zubah'];
const FIRST_F = ['Princess', 'Blessing', 'Comfort', 'Patience', 'Grace', 'Mercy', 'Hawa', 'Fatu', 'Korpo', 'Musu', 'Kebeh', 'Mamie', 'Esther', 'Rebecca', 'Martha', 'Naomi', 'Yatta', 'Miatta'];
const LAST = ['Kollie', 'Flomo', 'Johnson', 'Sackor', 'Gaye', 'Weah', 'Doe', 'Freeman', 'Toe', 'Nagbe', 'Fahnbulleh', 'Konneh', 'Sherman', 'Barclay', 'Dukuly', 'Togba', 'Mulbah', 'Tarr', 'Kpadeh', 'Menjor', 'Cooper', 'Roberts', 'Karnga', 'Sirleaf', 'Tubman', 'Gongloe'];
const COUNTIES = ['Montserrado', 'Montserrado', 'Montserrado', 'Bong', 'Nimba', 'Margibi', 'Grand Bassa', 'Lofa'];
const COMMUNITIES = ['Sinkor Old Road', 'Airfield', 'Congo Town', 'Paynesville Red Light', 'Gaye Town', 'Lakpazee', 'Fiamah', 'Jallah Town', 'Capitol Bypass', 'ELWA Junction'];

console.log('Seeding demo data for a Liberian school...');

tx(() => {
  // ------------------------------------------------ school + year + terms
  run(`INSERT INTO schools (uuid, name, emis_code, county, district, address, phone, email, motto,
         principal, school_type, levels, currency)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    uuid(), 'Sinkor United Methodist Academy', 'MOE-MONT-0412', 'Montserrado', 'Greater Monrovia',
    'Tubman Boulevard, Sinkor, Monrovia', '+231886450012', 'office@suma.edu.lr',
    'Knowledge, Service, Integrity', 'Rev. Dr. Sarah T. Kollie', 'faith-based', 'K-12', 'LRD');
  const schoolId = get('SELECT id FROM schools LIMIT 1').id;

  run(`INSERT INTO academic_years (uuid, school_id, name, start_date, end_date, is_current)
       VALUES (?,?,?,?,?,1)`, uuid(), schoolId, '2025/2026', '2025-09-01', '2026-07-10');
  const yearId = get('SELECT id FROM academic_years LIMIT 1').id;
  run(`INSERT INTO terms (uuid, academic_year_id, name, seq, start_date, end_date, is_current)
       VALUES (?,?,?,?,?,?,?)`, uuid(), yearId, 'First Semester', 1, '2025-09-01', '2026-01-30', 0);
  run(`INSERT INTO terms (uuid, academic_year_id, name, seq, start_date, end_date, is_current)
       VALUES (?,?,?,?,?,?,?)`, uuid(), yearId, 'Second Semester', 2, '2026-02-09', '2026-07-10', 1);
  const term1 = get(`SELECT id FROM terms WHERE seq = 1`).id;
  const term2 = get(`SELECT id FROM terms WHERE seq = 2`).id;

  // ------------------------------------------------ users
  function addUser(role, name, username, password, phone) {
    run(`INSERT INTO users (uuid, school_id, role, full_name, username, phone, password_hash)
         VALUES (?,?,?,?,?,?,?)`,
      uuid(), role === 'super_admin' || role === 'county_officer' ? null : schoolId,
      role, name, username, phone || null, hashSecret(password));
    return get('SELECT id FROM users WHERE username = ?', username).id;
  }
  addUser('super_admin', 'System Owner', 'superadmin', 'SuperAdmin#2026', null);
  const principalId = addUser('school_admin', 'Rev. Dr. Sarah T. Kollie', 'principal', 'Principal#2026', '+231886450012');
  const bursarId = addUser('accountant', 'Mr. Varney G. Sherman', 'bursar', 'Bursar#2026', '+231777204518');
  const countyId = addUser('county_officer', 'Hon. Miatta B. Freeman (CEO Montserrado)', 'ceo.montserrado', 'County#2026', '+231770338211');
  run('UPDATE users SET county = ? WHERE id = ?', 'Montserrado', countyId);

  const teacherDefs = [
    ['J. Emmanuel Flomo', 'eflomo', 'B Certificate', 'Mathematics'],
    ['Martha K. Sackor', 'msackor', 'A Certificate', 'English'],
    ['Moses T. Gaye', 'mgaye', 'BSc Biology', 'General Science'],
    ['Korpo Y. Dukuly', 'kdukuly', 'C Certificate', 'Social Studies'],
    ['Abraham S. Togba', 'atogba', 'AA Education', 'Liberian History & Civics'],
    ['Fatu M. Konneh', 'fkonneh', 'B Certificate', 'French & RME'],
  ];
  const teacherIds = [];
  for (const [name, uname, qual, subj] of teacherDefs) {
    const id = addUser('teacher', name, uname, 'Teacher#2026', `+23177${between(1000000, 9999999)}`);
    teacherIds.push({ id, name, qual, subj });
  }

  // ------------------------------------------------ staff records
  function addStaff(userId, no, position, qual, payrollType, salary, phone) {
    run(`INSERT INTO staff (uuid, school_id, user_id, staff_no, position, qualification,
           hire_date, payroll_type, gov_payroll_no, base_salary_cents, phone, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active')`,
      uuid(), schoolId, userId, no, position, qual,
      `20${between(15, 23)}-09-01`, payrollType,
      payrollType === 'government' ? `GOL-${between(100000, 999999)}` : null,
      salary, phone);
    return get('SELECT id FROM staff WHERE staff_no = ?', no).id;
  }
  addStaff(principalId, 'ST-001', 'Principal', 'MEd Administration', 'government', 0, '+231886450012');
  addStaff(bursarId, 'ST-002', 'Bursar', 'BBA Accounting', 'school', 3500000, '+231777204518'); // LRD 35,000/mo
  const staffIds = [];
  teacherIds.forEach((t, i) => {
    const payroll = i < 3 ? 'government' : 'school';
    staffIds.push(addStaff(t.id, `ST-0${i + 10}`, 'Teacher', t.qual, payroll, payroll === 'school' ? 2800000 : 0, `+23188${between(1000000, 9999999)}`));
  });

  // ------------------------------------------------ classes & subjects
  const classDefs = [
    ['KG-1', 'K1'], ['KG-2', 'K2'],
    ['Grade 1', '1'], ['Grade 2', '2'], ['Grade 3', '3'], ['Grade 4', '4'],
    ['Grade 5', '5'], ['Grade 6', '6'], ['Grade 7-A', '7'], ['Grade 8-A', '8'],
    ['Grade 9-A', '9'],
  ];
  const classIds = {};
  for (const [name, level] of classDefs) {
    run(`INSERT INTO classes (uuid, school_id, name, level, teacher_id, capacity) VALUES (?,?,?,?,?,45)`,
      uuid(), schoolId, name, level, pick(teacherIds).id);
    classIds[name] = get('SELECT id FROM classes WHERE name = ? AND school_id = ?', name, schoolId).id;
  }

  const subjectDefs = [
    ['English Language', 'ENG'], ['Mathematics', 'MTH'], ['General Science', 'SCI'],
    ['Social Studies', 'SOC'], ['Liberian History', 'HIS'], ['Civics', 'CIV'],
    ['Religious & Moral Education', 'RME'], ['Physical Education', 'PE'],
    ['French', 'FRE'], ['Computer Studies', 'ICT'],
  ];
  const subjectIds = {};
  for (const [name, code] of subjectDefs) {
    run(`INSERT INTO subjects (uuid, school_id, name, code) VALUES (?,?,?,?)`, uuid(), schoolId, name, code);
    subjectIds[name] = get('SELECT id FROM subjects WHERE name = ? AND school_id = ?', name, schoolId).id;
  }

  // teacher-subject-class assignments for grades 5-9 (core subjects)
  const core = ['English Language', 'Mathematics', 'General Science', 'Social Studies', 'Liberian History', 'Civics'];
  const teacherFor = {
    'English Language': teacherIds[1].id, Mathematics: teacherIds[0].id,
    'General Science': teacherIds[2].id, 'Social Studies': teacherIds[3].id,
    'Liberian History': teacherIds[4].id, Civics: teacherIds[4].id,
    French: teacherIds[5].id, 'Religious & Moral Education': teacherIds[5].id,
  };
  for (const cname of ['Grade 5', 'Grade 6', 'Grade 7-A', 'Grade 8-A', 'Grade 9-A']) {
    for (const s of core) {
      run(`INSERT INTO class_subjects (uuid, class_id, subject_id, teacher_id) VALUES (?,?,?,?)`,
        uuid(), classIds[cname], subjectIds[s], teacherFor[s]);
    }
  }

  // timetable for Grade 7-A (Mon-Fri, 4 periods)
  const periods = [['08:00', '08:50'], ['08:50', '09:40'], ['10:00', '10:50'], ['10:50', '11:40']];
  const g7subs = core;
  for (let day = 1; day <= 5; day++) {
    periods.forEach(([start, end], i) => {
      const s = g7subs[(day + i) % g7subs.length];
      run(`INSERT INTO timetable_slots (uuid, class_id, subject_id, teacher_id, weekday, start_time, end_time, room)
           VALUES (?,?,?,?,?,?,?,?)`,
        uuid(), classIds['Grade 7-A'], subjectIds[s], teacherFor[s], day, start, end, 'Room 7');
    });
  }

  // ------------------------------------------------ students + guardians
  const year = 2025;
  let seq = 1;
  const studentIds = [];
  for (const [cname, level] of classDefs) {
    const count = between(10, 14);
    const baseAge = level === 'K1' ? 5 : level === 'K2' ? 6 : 6 + Number(level);
    for (let i = 0; i < count; i++) {
      const gender = rnd() < 0.52 ? 'F' : 'M';
      const first = gender === 'F' ? pick(FIRST_F) : pick(FIRST_M);
      const last = pick(LAST);
      const age = baseAge + between(0, 3);   // over-age enrollment is common
      const dob = `${year - age}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;
      const no = `MOE-MONT-0412-${year}-${String(seq++).padStart(4, '0')}`;
      const ovc = rnd() < 0.08 ? 1 : 0;
      run(`INSERT INTO students (uuid, school_id, student_no, first_name, last_name, gender, dob,
             address, county, class_id, admission_date, status, ovc_flag, ovc_notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
        uuid(), schoolId, no, first, last, gender, dob,
        pick(COMMUNITIES) + ', Monrovia', pick(COUNTIES), classIds[cname], '2025-09-01',
        ovc, ovc ? 'Lives with aunt; father deceased. Supported by PTA welfare fund.' : null);
      const sid = get('SELECT id FROM students WHERE student_no = ?', no).id;
      studentIds.push({ id: sid, class: cname, classId: classIds[cname], level, first, last });

      // guardian with parent portal login (phone unique per guardian)
      const gFirst = rnd() < 0.5 ? pick(FIRST_F) : pick(FIRST_M);
      const phone = `+2317762${String(10000 + seq).slice(-5)}`;
      run(`INSERT INTO users (uuid, school_id, role, full_name, phone, pin_hash)
           VALUES (?,?,?,?,?,?)`,
        uuid(), schoolId, 'parent', `${gFirst} ${last}`, phone, hashSecret('1234'));
      const puid = get('SELECT id FROM users WHERE phone = ?', phone).id;
      run(`INSERT INTO guardians (uuid, school_id, full_name, relation, phone, address, occupation, user_id)
           VALUES (?,?,?,?,?,?,?,?)`,
        uuid(), schoolId, `${gFirst} ${last}`, rnd() < 0.5 ? 'mother' : 'father', phone,
        pick(COMMUNITIES) + ', Monrovia', pick(['petty trader', 'teacher', 'driver', 'farmer', 'civil servant', 'mechanic', 'nurse', 'security guard']), puid);
      const gid = get('SELECT id FROM guardians WHERE phone = ?', phone).id;
      run(`INSERT INTO student_guardians (student_id, guardian_id, is_primary) VALUES (?,?,1)`, sid, gid);
    }
  }
  console.log(`  ${studentIds.length} students enrolled across ${classDefs.length} classes`);

  // one pregnancy re-entry case (grade 9) for the welfare tracking demo
  const g9girl = studentIds.find(s => s.class === 'Grade 9-A');
  run(`UPDATE students SET pregnancy_flag = 1, reentry_date = '2026-02-09' WHERE id = ?`, g9girl.id);
  run(`INSERT INTO student_transfers (uuid, student_id, kind, date, reason) VALUES (?,?,?,?,?)`,
    uuid(), g9girl.id, 'reentry', '2026-02-09', 'Re-entry after maternity under MoE girls education policy');

  // ------------------------------------------------ attendance (last 15 school days)
  const days = [];
  const d = new Date('2026-07-07');
  while (days.length < 15) {
    if (d.getDay() >= 1 && d.getDay() <= 5) days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  for (const st of studentIds) {
    for (const date of days) {
      const r = rnd();
      const status = r < 0.88 ? 'present' : r < 0.95 ? 'absent' : 'late';
      run(`INSERT INTO attendance (uuid, student_id, class_id, term_id, date, status, marked_by)
           VALUES (?,?,?,?,?,?,?)`,
        uuid(), st.id, st.classId, term2, date, status, principalId);
    }
  }

  // staff attendance today
  for (const stId of staffIds) {
    run(`INSERT INTO staff_attendance (uuid, staff_id, date, status, marked_by) VALUES (?,?,?,?,?)`,
      uuid(), stId, '2026-07-07', rnd() < 0.9 ? 'present' : 'late', principalId);
  }

  // ------------------------------------------------ assessments + scores (Grade 7-A, both semesters)
  for (const [termId, label] of [[term1, 'S1'], [term2, 'S2']]) {
    for (const s of core) {
      const defs = [
        ['quiz', `${label} Quiz 1`, 20], ['test', `${label} Class Test`, 50],
        ['assignment', `${label} Assignment`, 30], ['exam', `${label} Semester Exam`, 100],
      ];
      for (const [kind, title, max] of defs) {
        run(`INSERT INTO assessments (uuid, school_id, class_id, subject_id, term_id, kind, title, date, max_score, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          uuid(), schoolId, classIds['Grade 7-A'], subjectIds[s], termId, kind, `${s} ${title}`,
          termId === term1 ? '2026-01-15' : '2026-06-20', max, teacherFor[s]);
        const aid = get('SELECT id FROM assessments ORDER BY id DESC LIMIT 1').id;
        for (const st of studentIds.filter(x => x.class === 'Grade 7-A')) {
          const ability = 0.5 + ((st.id * 37) % 45) / 100;   // stable per-student ability
          const score = Math.min(max, Math.max(0, Math.round(max * (ability + (rnd() - 0.5) * 0.25))));
          run(`INSERT INTO scores (uuid, assessment_id, student_id, score, entered_by) VALUES (?,?,?,?,?)`,
            uuid(), aid, st.id, score, teacherFor[s]);
        }
      }
    }
  }
  console.log('  Assessments and scores entered for Grade 7-A');

  // ------------------------------------------------ fees, invoices, payments
  const feeDefs = [
    ['Tuition', '*', 1500000], ['Registration', '*', 250000],
    ['PTA Dues', '*', 100000], ['Lab & Computer Fee', '7', 300000],
    ['Lab & Computer Fee', '8', 300000], ['Lab & Computer Fee', '9', 300000],
  ];
  for (const termId of [term1, term2]) {
    for (const [name, level, cents] of feeDefs) {
      run(`INSERT INTO fee_structures (uuid, school_id, term_id, class_level, name, amount_cents, due_date)
           VALUES (?,?,?,?,?,?,?)`,
        uuid(), schoolId, termId, level, name, cents, termId === term1 ? '2025-10-15' : '2026-03-15');
    }
  }
  // scholarship for OVC students: 50% tuition support
  for (const st of studentIds) {
    const s = get('SELECT ovc_flag FROM students WHERE id = ?', st.id);
    if (s.ovc_flag) {
      run(`INSERT INTO scholarships (uuid, school_id, student_id, name, kind, value, notes)
           VALUES (?,?,?,?,?,?,?)`,
        uuid(), schoolId, st.id, 'PTA Welfare Fund', 'percent', 50, 'OVC support — approved by PTA executive');
    }
  }
  // invoices for semester 2 + partial payments
  let invSeq = 1, rctSeq = 1;
  for (const st of studentIds) {
    const level = st.level;
    const items = feeDefs.filter(f => f[1] === '*' || f[1] === level).map(f => ({ name: f[0], cents: f[2] }));
    const total = items.reduce((s, i) => s + i.cents, 0);
    const schol = get('SELECT value FROM scholarships WHERE student_id = ? AND deleted = 0', st.id);
    const discount = schol ? Math.round(total * schol.value / 100) : 0;
    run(`INSERT INTO invoices (uuid, school_id, student_id, term_id, invoice_no, items_json, total_cents,
           discount_cents, discount_reason, due_date, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      uuid(), schoolId, st.id, term2, `INV-2026-${String(invSeq++).padStart(5, '0')}`,
      JSON.stringify(items), total, discount, schol ? 'PTA Welfare Fund' : null,
      '2026-03-15', 'open', bursarId);
    const invId = get('SELECT id FROM invoices ORDER BY id DESC LIMIT 1').id;
    const due = total - discount;
    const payRoll = rnd();
    const payAmount = payRoll < 0.45 ? due : payRoll < 0.8 ? Math.round(due * pick([0.25, 0.5, 0.75])) : 0;
    if (payAmount > 0) {
      const method = pick(['cash', 'cash', 'momo_mtn', 'momo_orange', 'bank']);
      run(`INSERT INTO payments (uuid, school_id, invoice_id, student_id, receipt_no, amount_cents,
             method, reference, payer_name, date, received_by, reconciled)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        uuid(), schoolId, invId, st.id, `RCT-2026-${String(rctSeq++).padStart(5, '0')}`, payAmount,
        method, method.startsWith('momo') ? `TXN${between(10000000, 99999999)}` : null,
        null, `2026-0${between(2, 6)}-${String(between(1, 28)).padStart(2, '0')}`, bursarId,
        method === 'cash' ? 1 : 0);
      run(`UPDATE invoices SET status = ? WHERE id = ?`, payAmount >= due ? 'paid' : 'partial', invId);
    }
  }
  console.log('  Fee structures, invoices and payments recorded');

  // expenses & budget & donation
  const expenseDefs = [
    ['2026-02-10', 'salaries', 'February school-funded staff payroll', 11200000, 'Staff payroll'],
    ['2026-02-18', 'supplies', 'Chalk, registers and exercise books', 450000, 'Central Supermarket'],
    ['2026-03-05', 'maintenance', 'Roof repair — Grade 3 classroom', 1200000, 'K. Nagbe Construction'],
    ['2026-03-22', 'utilities', 'Generator fuel (March)', 800000, 'TOTAL Filling Station'],
    ['2026-04-14', 'transport', 'Bus tyre replacement x2', 950000, 'Monrovia Motors'],
  ];
  for (const [date, cat, desc, cents, paidTo] of expenseDefs) {
    run(`INSERT INTO expenses (uuid, school_id, date, category, description, amount_cents, paid_to, method, entered_by, approved_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      uuid(), schoolId, date, cat, desc, cents, paidTo, 'cash', bursarId, principalId);
  }
  for (const [cat, cents] of [['salaries', 60000000], ['supplies', 5000000], ['maintenance', 8000000], ['utilities', 6000000], ['transport', 4000000]]) {
    run(`INSERT INTO budgets (uuid, school_id, academic_year_id, category, amount_cents) VALUES (?,?,?,?,?)`,
      uuid(), schoolId, yearId, cat, cents);
  }
  run(`INSERT INTO donations (uuid, school_id, date, donor, kind, description, amount_cents, restricted_to)
       VALUES (?,?,?,?,?,?,?,?)`,
    uuid(), schoolId, '2026-01-20', 'UMC Global Ministries', 'grant', 'Textbook grant 2026', 15000000, 'Textbooks');

  // payroll for the school-funded staff
  for (const period of ['2026-05', '2026-06']) {
    for (const st of all(`SELECT * FROM staff WHERE payroll_type = 'school' AND deleted = 0`)) {
      run(`INSERT INTO payslips (uuid, staff_id, period, gross_cents, allowances_json, deductions_json, net_cents, status, paid_date, prepared_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        uuid(), st.id, period, st.base_salary_cents,
        JSON.stringify([{ name: 'Transport allowance', cents: 200000 }]),
        JSON.stringify([{ name: 'NASSCORP (4%)', cents: Math.round(st.base_salary_cents * 0.04) }]),
        st.base_salary_cents + 200000 - Math.round(st.base_salary_cents * 0.04),
        period === '2026-05' ? 'paid' : 'approved', period === '2026-05' ? '2026-05-28' : null, bursarId);
    }
  }

  // ------------------------------------------------ transport
  run(`INSERT INTO vehicles (uuid, school_id, plate_no, model, capacity, driver_staff_id) VALUES (?,?,?,?,?,?)`,
    uuid(), schoolId, 'A-54321', 'Toyota Coaster 2014', 30, staffIds[0]);
  const vehicleId = get('SELECT id FROM vehicles LIMIT 1').id;
  run(`INSERT INTO bus_routes (uuid, school_id, name, stops_json, vehicle_id, fee_cents) VALUES (?,?,?,?,?,?)`,
    uuid(), schoolId, 'Route 1 — Red Light to Sinkor',
    JSON.stringify([{ name: 'Red Light Market', time: '06:45' }, { name: 'ELWA Junction', time: '07:05' }, { name: 'Congo Town', time: '07:20' }, { name: 'School', time: '07:40' }]),
    vehicleId, 500000);
  const routeId = get('SELECT id FROM bus_routes LIMIT 1').id;
  for (const st of studentIds.slice(0, 12)) {
    run(`INSERT INTO route_assignments (uuid, route_id, student_id, stop) VALUES (?,?,?,?)`,
      uuid(), routeId, st.id, pick(['Red Light Market', 'ELWA Junction', 'Congo Town']));
  }
  run(`INSERT INTO vehicle_maintenance (uuid, vehicle_id, date, description, cost_cents, odometer) VALUES (?,?,?,?,?,?)`,
    uuid(), vehicleId, '2026-04-14', 'Two rear tyres replaced', 950000, 148230);

  // ------------------------------------------------ library & assets
  const bookDefs = [
    ['New General Mathematics for JHS 1', 'A. Godman', 'Mathematics', 15],
    ['English for Liberia — Grade 7', 'MoE Liberia', 'English', 20],
    ['Liberian History for Schools', 'C. Abayomi Cassell', 'History', 8],
    ['Integrated Science JHS', 'K. Ampiah', 'Science', 12],
    ['Civics for Liberian Schools', 'MoE Liberia', 'Civics', 10],
    ['Things Fall Apart', 'Chinua Achebe', 'Literature', 6],
  ];
  for (const [title, author, cat, copies] of bookDefs) {
    run(`INSERT INTO books (uuid, school_id, title, author, category, copies, available, shelf)
         VALUES (?,?,?,?,?,?,?,?)`, uuid(), schoolId, title, author, cat, copies, copies, cat.slice(0, 3).toUpperCase());
  }
  // a couple of open loans, one overdue
  const book1 = get(`SELECT id FROM books WHERE title LIKE 'Things Fall%'`).id;
  run(`UPDATE books SET available = available - 2 WHERE id = ?`, book1);
  run(`INSERT INTO book_loans (uuid, book_id, student_id, loan_date, due_date, issued_by) VALUES (?,?,?,?,?,?)`,
    uuid(), book1, studentIds[studentIds.length - 3].id, '2026-06-20', '2026-07-04', principalId);
  run(`INSERT INTO book_loans (uuid, book_id, student_id, loan_date, due_date, issued_by) VALUES (?,?,?,?,?,?)`,
    uuid(), book1, studentIds[studentIds.length - 5].id, '2026-06-28', '2026-07-12', principalId);

  const assetDefs = [
    ['CMP-001', 'HP Laptop (office)', 'computer', 2, 'Principal office', 0, 0],
    ['FRN-001', 'Student desks', 'furniture', 180, 'Classrooms', 20, 1],
    ['EQP-001', 'Generator 7.5kVA', 'equipment', 1, 'Generator shed', 0, 0],
    ['SUP-001', 'Boxes of chalk', 'supplies', 8, 'Store room', 10, 1],
  ];
  for (const [tag, name, cat, qty, loc, reorder, consumable] of assetDefs) {
    run(`INSERT INTO assets (uuid, school_id, tag_no, name, category, quantity, location, reorder_level, is_consumable)
         VALUES (?,?,?,?,?,?,?,?,?)`, uuid(), schoolId, tag, name, cat, qty, loc, reorder, consumable);
  }

  // ------------------------------------------------ calendar, announcements, national exams
  const events = [
    ['Independence Day Holiday', 'holiday', '2026-07-26'],
    ['Second Semester Exams', 'exam', '2026-06-15', '2026-06-26'],
    ['PTA General Meeting', 'meeting', '2026-07-11'],
    ['Graduation & Closing Program', 'event', '2026-07-10'],
  ];
  for (const [title, kind, start, end] of events) {
    run(`INSERT INTO calendar_events (uuid, school_id, title, kind, start_date, end_date) VALUES (?,?,?,?,?,?)`,
      uuid(), schoolId, title, kind, start, end || null);
  }
  run(`INSERT INTO lost_instruction_days (uuid, school_id, date, days_lost, reason, notes) VALUES (?,?,?,?,?,?)`,
    uuid(), schoolId, '2026-05-04', 2, 'weather', 'Heavy rains flooded the access road');
  run(`INSERT INTO announcements (uuid, school_id, title, body, audience, publish_date, created_by) VALUES (?,?,?,?,?,?,?)`,
    uuid(), schoolId, 'PTA Meeting — Saturday July 11',
    'All parents are invited to the PTA general meeting on Saturday July 11 at 10:00 AM in the school hall. Second semester report cards will be discussed.',
    'parents', '2026-07-01', principalId);
  // WASSCE registration for grade 9 (BECE-equivalent LJHSCE)
  for (const st of studentIds.filter(x => x.class === 'Grade 9-A').slice(0, 8)) {
    run(`INSERT INTO national_exams (uuid, student_id, exam, year, index_no, registered, fee_paid)
         VALUES (?,?,?,?,?,1,?)`,
      uuid(), st.id, 'LJHSCE', '2026', `LIB26${String(between(100000, 999999))}`, rnd() < 0.7 ? 1 : 0);
  }
});

// report cards for Grade 7-A semester 1 (generated + published), outside the big tx
const { computeTermResults } = require('../services/grading');
const schoolId = get('SELECT id FROM schools LIMIT 1').id;
const term1 = get(`SELECT id FROM terms WHERE seq = 1`).id;
const g7 = get(`SELECT id FROM classes WHERE name = 'Grade 7-A'`).id;
const { students: results } = computeTermResults(g7, term1, schoolId);
tx(() => {
  for (const [sid, r] of Object.entries(results)) {
    run(`INSERT INTO report_cards (uuid, student_id, term_id, class_id, data_json, average, rank,
           class_size, days_present, days_absent, remarks, published, published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`,
      uuid(), Number(sid), term1, g7, JSON.stringify(r.subjects), r.average, r.rank || null,
      r.class_size || null, 78, between(0, 6),
      r.average >= 85 ? 'Excellent work. Keep it up!' : r.average >= 70 ? 'Good performance. Aim higher next semester.' : 'Needs to improve. Extra classes recommended.');
  }
});

const counts = {
  students: get('SELECT COUNT(*) n FROM students').n,
  guardians: get('SELECT COUNT(*) n FROM guardians').n,
  attendance: get('SELECT COUNT(*) n FROM attendance').n,
  scores: get('SELECT COUNT(*) n FROM scores').n,
  invoices: get('SELECT COUNT(*) n FROM invoices').n,
  payments: get('SELECT COUNT(*) n FROM payments').n,
  report_cards: get('SELECT COUNT(*) n FROM report_cards').n,
};
console.log('Seed complete:', counts);
console.log(`
Demo logins (see docs/user-manuals for details):
  Principal / School Admin : principal / Principal#2026
  Bursar / Accountant      : bursar / Bursar#2026
  Teacher (Maths)          : eflomo / Teacher#2026
  County Education Officer : ceo.montserrado / County#2026
  Super Admin              : superadmin / SuperAdmin#2026
  Parent portal            : any guardian phone (see Students > guardian) + PIN 1234
`);
