-- Ma Weade School Suite — SQLite schema
-- Conventions:
--   * every syncable table has: uuid (client-generated ok), updated_at, deleted (soft delete)
--   * money is stored in cents (integer) with a currency code, default LRD
--   * dates are ISO-8601 text (YYYY-MM-DD), timestamps ISO-8601 UTC

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- tenancy
CREATE TABLE IF NOT EXISTS schools (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  emis_code     TEXT,                       -- Ministry of Education EMIS school code
  county        TEXT,                       -- e.g. Montserrado, Bong, Nimba
  district      TEXT,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  motto         TEXT,
  principal     TEXT,
  logo_path     TEXT,
  school_type   TEXT DEFAULT 'public',      -- public | private | community | faith-based
  levels        TEXT DEFAULT 'K-12',
  currency      TEXT DEFAULT 'LRD',
  settings_json TEXT DEFAULT '{}',          -- grading system, notification prefs, language...
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS academic_years (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  name       TEXT NOT NULL,                 -- "2025/2026"
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS terms (
  id               INTEGER PRIMARY KEY,
  uuid             TEXT NOT NULL UNIQUE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  name             TEXT NOT NULL,           -- "First Semester" / "Period 1" ...
  seq              INTEGER NOT NULL DEFAULT 1,
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  is_current       INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted          INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- people & auth
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  school_id     INTEGER REFERENCES schools(id),   -- NULL for super_admin / county_officer
  role          TEXT NOT NULL CHECK (role IN
                 ('super_admin','county_officer','school_admin','teacher',
                  'accountant','parent','student')),
  full_name     TEXT NOT NULL,
  username      TEXT UNIQUE,                -- staff login
  phone         TEXT,                       -- parent login identifier (unique per school)
  email         TEXT,
  password_hash TEXT,                       -- scrypt, for staff
  pin_hash      TEXT,                       -- scrypt, 4-6 digit PIN for parents/students
  county        TEXT,                       -- scope for county_officer
  active        INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  last_login    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id, role);

-- ---------------------------------------------------------------- academics: structure
CREATE TABLE IF NOT EXISTS classes (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  name       TEXT NOT NULL,                 -- "Grade 7-A"
  level      TEXT NOT NULL,                 -- K1,K2,1..12
  section    TEXT,                          -- A/B/...
  teacher_id INTEGER REFERENCES users(id),  -- class sponsor / homeroom
  capacity   INTEGER DEFAULT 45,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subjects (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  name       TEXT NOT NULL,                 -- aligned with Liberian national curriculum
  code       TEXT,
  level_group TEXT DEFAULT 'all',           -- elementary | junior_high | senior_high | all
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- teacher-subject-class assignment
CREATE TABLE IF NOT EXISTS class_subjects (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES users(id),
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- 1=Mon
  start_time TEXT NOT NULL,                 -- "08:00"
  end_time   TEXT NOT NULL,
  room       TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson_plans (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  class_id   INTEGER REFERENCES classes(id),
  subject_id INTEGER REFERENCES subjects(id),
  term_id    INTEGER REFERENCES terms(id),
  title      TEXT NOT NULL,
  week       INTEGER,
  body       TEXT,                          -- plan text
  file_path  TEXT,                          -- optional uploaded document
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'event', -- holiday | exam | event | meeting | closure
  start_date TEXT NOT NULL,
  end_date   TEXT,
  notes      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- strikes, weather, emergencies — Ministry reporting on lost instructional time
CREATE TABLE IF NOT EXISTS lost_instruction_days (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  date       TEXT NOT NULL,
  days_lost  REAL NOT NULL DEFAULT 1,
  reason     TEXT NOT NULL,                 -- strike | weather | emergency | other
  notes      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- students
CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY,
  uuid            TEXT NOT NULL UNIQUE,
  school_id       INTEGER NOT NULL REFERENCES schools(id),
  student_no      TEXT NOT NULL,            -- unique printable ID (QR/barcode source)
  first_name      TEXT NOT NULL,
  middle_name     TEXT,
  last_name       TEXT NOT NULL,
  gender          TEXT CHECK (gender IN ('M','F')),
  dob             TEXT,
  photo_path      TEXT,
  address         TEXT,
  county          TEXT,
  nationality     TEXT DEFAULT 'Liberian',
  class_id        INTEGER REFERENCES classes(id),
  admission_date  TEXT,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | transferred | withdrawn | graduated | deceased
  status_reason   TEXT,
  status_date     TEXT,
  -- welfare flags (visible only to admin + assigned counselor roles)
  ovc_flag        INTEGER NOT NULL DEFAULT 0,      -- orphaned / vulnerable child
  ovc_notes       TEXT,
  pregnancy_flag  INTEGER NOT NULL DEFAULT 0,
  reentry_date    TEXT,                             -- re-entry after pregnancy
  disability      TEXT,
  medical_notes   TEXT,
  blood_group     TEXT,
  immunizations   TEXT,                             -- JSON [{name,date}]
  user_id         INTEGER REFERENCES users(id),     -- optional student portal login
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(school_id, student_no)
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id, status);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(last_name, first_name);

CREATE TABLE IF NOT EXISTS guardians (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  full_name  TEXT NOT NULL,
  relation   TEXT,                          -- mother | father | aunt | guardian ...
  phone      TEXT,                          -- primary identifier for portal + SMS
  phone2     TEXT,
  email      TEXT,
  address    TEXT,
  occupation TEXT,
  user_id    INTEGER REFERENCES users(id),  -- parent portal account
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_guardians_phone ON guardians(phone);

CREATE TABLE IF NOT EXISTS student_guardians (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  guardian_id INTEGER NOT NULL REFERENCES guardians(id),
  is_primary  INTEGER NOT NULL DEFAULT 0,
  is_emergency INTEGER NOT NULL DEFAULT 1,
  UNIQUE(student_id, guardian_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  class_id   INTEGER REFERENCES classes(id),
  term_id    INTEGER REFERENCES terms(id),
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note       TEXT,
  marked_by  INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date, class_id);

CREATE TABLE IF NOT EXISTS discipline_records (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  date        TEXT NOT NULL,
  category    TEXT,                         -- lateness | fighting | dress code | ...
  description TEXT NOT NULL,
  action      TEXT,                         -- counseling, suspension, parent conference...
  reported_by INTEGER REFERENCES users(id),
  visible_to_parent INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_transfers (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  kind        TEXT NOT NULL CHECK (kind IN ('transfer_in','transfer_out','withdrawal','reentry')),
  date        TEXT NOT NULL,
  other_school TEXT,
  reason      TEXT,
  approved_by INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- assessment & grading
CREATE TABLE IF NOT EXISTS assessments (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  class_id   INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  term_id    INTEGER NOT NULL REFERENCES terms(id),
  kind       TEXT NOT NULL DEFAULT 'quiz',  -- quiz | test | assignment | project | exam
  title      TEXT NOT NULL,
  date       TEXT,
  max_score  REAL NOT NULL DEFAULT 100,
  weight     REAL NOT NULL DEFAULT 1,       -- weight inside its kind bucket
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assessments ON assessments(class_id, subject_id, term_id);

CREATE TABLE IF NOT EXISTS scores (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id),
  student_id    INTEGER NOT NULL REFERENCES students(id),
  score         REAL,
  remark        TEXT,
  entered_by    INTEGER REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(assessment_id, student_id)
);

-- immutable snapshot taken when report cards are published
CREATE TABLE IF NOT EXISTS report_cards (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  term_id     INTEGER NOT NULL REFERENCES terms(id),
  class_id    INTEGER REFERENCES classes(id),
  data_json   TEXT NOT NULL,                -- per-subject CA/exam/total/grade + averages + rank
  average     REAL,
  rank        INTEGER,
  class_size  INTEGER,
  days_present INTEGER,
  days_absent INTEGER,
  remarks     TEXT,
  published   INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(student_id, term_id)
);

CREATE TABLE IF NOT EXISTS promotions (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  student_id    INTEGER NOT NULL REFERENCES students(id),
  from_year_id  INTEGER REFERENCES academic_years(id),
  from_class_id INTEGER REFERENCES classes(id),
  to_class_id   INTEGER REFERENCES classes(id),
  decision      TEXT NOT NULL CHECK (decision IN ('promoted','retained','graduated','conditional')),
  decided_by    INTEGER REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0
);

-- WAEC / national exams (NPSE gr6, BECE/LJHSCE gr9, WASSCE gr12)
CREATE TABLE IF NOT EXISTS national_exams (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  exam       TEXT NOT NULL,                 -- NPSE | BECE | WASSCE
  year       TEXT NOT NULL,
  index_no   TEXT,
  registered INTEGER NOT NULL DEFAULT 1,
  fee_paid   INTEGER NOT NULL DEFAULT 0,
  results_json TEXT,                        -- {subject: grade}
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_bank (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  subject_id INTEGER REFERENCES subjects(id),
  level      TEXT,
  question   TEXT NOT NULL,
  answer     TEXT,
  kind       TEXT DEFAULT 'objective',      -- objective | essay | practical
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- staff & HR
CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY,
  uuid           TEXT NOT NULL UNIQUE,
  school_id      INTEGER NOT NULL REFERENCES schools(id),
  user_id        INTEGER REFERENCES users(id),
  staff_no       TEXT,
  position       TEXT,                      -- teacher | principal | registrar | bursar | janitor...
  qualification  TEXT,                      -- C Certificate | B Certificate | A Certificate | AA | BSc | MSc
  certifications TEXT,                      -- JSON list
  hire_date      TEXT,
  payroll_type   TEXT NOT NULL DEFAULT 'school', -- government (read-only track) | school | volunteer
  gov_payroll_no TEXT,
  base_salary_cents INTEGER DEFAULT 0,
  salary_currency TEXT DEFAULT 'LRD',
  bank_or_momo   TEXT,                      -- payment destination
  phone          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  staff_id   INTEGER NOT NULL REFERENCES staff(id),
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('present','absent','late','leave')),
  note       TEXT,
  marked_by  INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(staff_id, date)
);

CREATE TABLE IF NOT EXISTS leaves (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  staff_id   INTEGER NOT NULL REFERENCES staff(id),
  kind       TEXT NOT NULL,                 -- sick | annual | maternity | emergency | study
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  reason     TEXT,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  decided_by INTEGER REFERENCES users(id),
  substitute_staff_id INTEGER REFERENCES staff(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payslips (
  id            INTEGER PRIMARY KEY,
  uuid          TEXT NOT NULL UNIQUE,
  staff_id      INTEGER NOT NULL REFERENCES staff(id),
  period        TEXT NOT NULL,              -- "2026-01"
  gross_cents   INTEGER NOT NULL,
  allowances_json TEXT DEFAULT '[]',        -- [{name, cents}]
  deductions_json TEXT DEFAULT '[]',
  net_cents     INTEGER NOT NULL,
  currency      TEXT DEFAULT 'LRD',
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | approved | paid
  paid_date     TEXT,
  prepared_by   INTEGER REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(staff_id, period)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  staff_id     INTEGER NOT NULL REFERENCES staff(id),
  term_id      INTEGER REFERENCES terms(id),
  scores_json  TEXT,                        -- {criterion: 1-5}
  overall      REAL,
  comments     TEXT,
  evaluator_id INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS professional_development (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  staff_id   INTEGER NOT NULL REFERENCES staff(id),
  title      TEXT NOT NULL,
  provider   TEXT,
  date       TEXT,
  hours      REAL,
  certificate TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- finance
CREATE TABLE IF NOT EXISTS fee_structures (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  term_id    INTEGER NOT NULL REFERENCES terms(id),
  class_level TEXT NOT NULL,                -- applies to all classes of this level; '*' = all
  name       TEXT NOT NULL,                 -- Tuition, Registration, PTA, Lab, Transport...
  amount_cents INTEGER NOT NULL,
  currency   TEXT DEFAULT 'LRD',
  due_date   TEXT,
  optional   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  school_id   INTEGER NOT NULL REFERENCES schools(id),
  student_id  INTEGER NOT NULL REFERENCES students(id),
  term_id     INTEGER NOT NULL REFERENCES terms(id),
  invoice_no  TEXT NOT NULL,
  items_json  TEXT NOT NULL,                -- [{name, cents}]
  total_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,                     -- scholarship name etc.
  currency    TEXT DEFAULT 'LRD',
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open | partial | paid | void
  created_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(school_id, invoice_no)
);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, term_id);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  invoice_id   INTEGER REFERENCES invoices(id),
  student_id   INTEGER NOT NULL REFERENCES students(id),
  receipt_no   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT DEFAULT 'LRD',
  method       TEXT NOT NULL CHECK (method IN ('cash','bank','momo_mtn','momo_orange','cheque','other')),
  reference    TEXT,                        -- bank slip no / momo transaction id
  momo_status  TEXT,                        -- pending | confirmed | failed (for API-initiated)
  payer_name   TEXT,
  date         TEXT NOT NULL,
  received_by  INTEGER REFERENCES users(id),
  reconciled   INTEGER NOT NULL DEFAULT 0,
  reconciled_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(school_id, receipt_no)
);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);

CREATE TABLE IF NOT EXISTS scholarships (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  student_id   INTEGER NOT NULL REFERENCES students(id),
  name         TEXT NOT NULL,               -- sponsor / program
  kind         TEXT NOT NULL DEFAULT 'percent', -- percent | fixed
  value        REAL NOT NULL,               -- 50 (=50%) or cents when fixed
  term_id      INTEGER REFERENCES terms(id),-- NULL = whole year
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  date         TEXT NOT NULL,
  category     TEXT NOT NULL,               -- salaries | supplies | maintenance | utilities | transport | other
  description  TEXT,
  amount_cents INTEGER NOT NULL,
  currency     TEXT DEFAULT 'LRD',
  paid_to      TEXT,
  method       TEXT DEFAULT 'cash',
  reference    TEXT,
  approved_by  INTEGER REFERENCES users(id),
  entered_by   INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  academic_year_id INTEGER REFERENCES academic_years(id),
  category     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT DEFAULT 'LRD',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS donations (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  date         TEXT NOT NULL,
  donor        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'cash', -- cash | grant | in-kind
  description  TEXT,
  amount_cents INTEGER DEFAULT 0,
  currency     TEXT DEFAULT 'LRD',
  restricted_to TEXT,                        -- earmark
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- communication
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  school_id   INTEGER NOT NULL REFERENCES schools(id),
  direction   TEXT NOT NULL DEFAULT 'out',  -- out | in
  channel     TEXT NOT NULL DEFAULT 'sms',  -- sms | app | email
  to_phone    TEXT,
  to_user_id  INTEGER REFERENCES users(id),
  from_user_id INTEGER REFERENCES users(id),
  student_id  INTEGER REFERENCES students(id),  -- context
  thread_id   TEXT,                             -- groups two-way conversations
  trigger     TEXT,                          -- absence | fee_due | exam | report_card | emergency | manual | meeting
  body        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | sent | delivered | failed | read
  sent_at     TEXT,
  error       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, direction);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  audience   TEXT NOT NULL DEFAULT 'all',   -- all | parents | staff | class:<id>
  publish_date TEXT NOT NULL,
  expires    TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meetings (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  teacher_id INTEGER REFERENCES users(id),
  guardian_id INTEGER REFERENCES guardians(id),
  student_id INTEGER REFERENCES students(id),
  date       TEXT NOT NULL,
  time       TEXT,
  purpose    TEXT,
  status     TEXT NOT NULL DEFAULT 'requested', -- requested | confirmed | done | cancelled
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- transport
CREATE TABLE IF NOT EXISTS vehicles (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  school_id   INTEGER NOT NULL REFERENCES schools(id),
  plate_no    TEXT NOT NULL,
  model       TEXT,
  capacity    INTEGER,
  driver_staff_id INTEGER REFERENCES staff(id),
  status      TEXT NOT NULL DEFAULT 'active',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bus_routes (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  name       TEXT NOT NULL,
  stops_json TEXT DEFAULT '[]',             -- [{name, time}]
  vehicle_id INTEGER REFERENCES vehicles(id),
  fee_cents  INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS route_assignments (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  route_id   INTEGER NOT NULL REFERENCES bus_routes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  stop       TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(route_id, student_id)
);

CREATE TABLE IF NOT EXISTS bus_attendance (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  route_id   INTEGER NOT NULL REFERENCES bus_routes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  date       TEXT NOT NULL,
  trip       TEXT NOT NULL DEFAULT 'morning', -- morning | afternoon
  boarded    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(route_id, student_id, date, trip)
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  vehicle_id   INTEGER NOT NULL REFERENCES vehicles(id),
  date         TEXT NOT NULL,
  description  TEXT NOT NULL,
  cost_cents   INTEGER DEFAULT 0,
  odometer     INTEGER,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- library & inventory
CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY,
  uuid       TEXT NOT NULL UNIQUE,
  school_id  INTEGER NOT NULL REFERENCES schools(id),
  title      TEXT NOT NULL,
  author     TEXT,
  isbn       TEXT,
  category   TEXT,
  copies     INTEGER NOT NULL DEFAULT 1,
  available  INTEGER NOT NULL DEFAULT 1,
  shelf      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS book_loans (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  book_id     INTEGER NOT NULL REFERENCES books(id),
  student_id  INTEGER REFERENCES students(id),
  staff_id    INTEGER REFERENCES staff(id),
  loan_date   TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  return_date TEXT,
  fine_cents  INTEGER NOT NULL DEFAULT 0,
  fine_paid   INTEGER NOT NULL DEFAULT 0,
  issued_by   INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assets (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  tag_no       TEXT,
  name         TEXT NOT NULL,
  category     TEXT,                        -- computer | furniture | equipment | vehicle | other
  quantity     INTEGER NOT NULL DEFAULT 1,
  location     TEXT,
  condition    TEXT DEFAULT 'good',         -- good | fair | poor | broken | disposed
  acquired     TEXT,
  value_cents  INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 0,          -- for consumable stock alerts
  is_consumable INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS procurements (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT NOT NULL UNIQUE,
  school_id    INTEGER NOT NULL REFERENCES schools(id),
  date         TEXT NOT NULL,
  item         TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  supplier     TEXT,
  cost_cents   INTEGER DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'requested', -- requested | approved | ordered | received
  requested_by INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- system
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER,
  user_name TEXT,
  role      TEXT,
  school_id INTEGER,
  action    TEXT NOT NULL,                  -- e.g. "POST /api/payments"
  entity    TEXT,
  entity_id TEXT,
  detail    TEXT,
  ip        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- idempotency keys for offline replay (client op de-duplication)
CREATE TABLE IF NOT EXISTS sync_ops (
  op_id      TEXT PRIMARY KEY,              -- client-generated UUID
  user_id    INTEGER,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  result_json TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  school_id INTEGER NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (school_id, key)
);
