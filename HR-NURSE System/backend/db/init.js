/**
 * Creates all tables. Idempotent: safe to run repeatedly.
 * Run with:  npm run init-db
 */
require('dotenv').config();
const db = require('./index');

const PG = db.engine === 'postgres';
const PK = PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const NOW = PG ? 'TIMESTAMPTZ DEFAULT now()' : "TEXT DEFAULT (datetime('now'))";
// Use INTEGER (0/1) flags on BOTH engines so the same 1/0 params work everywhere
// (Postgres won't implicitly cast an int parameter into a BOOLEAN column).
const BOOL = 'INTEGER';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id ${PK},
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'nurse',
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    must_change_pw ${BOOL} NOT NULL DEFAULT 0,
    active ${BOOL} NOT NULL DEFAULT 1,
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS employees (
    id ${PK},
    emp_no TEXT UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    sex TEXT,
    birthdate TEXT,
    department TEXT,
    position TEXT,
    date_hired TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    blood_type TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    emergency_contact TEXT,
    emergency_phone TEXT,
    allergies TEXT,
    chronic_conditions TEXT,
    notes TEXT,
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS ape_records (
    id ${PK},
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    exam_date TEXT NOT NULL,
    exam_type TEXT NOT NULL DEFAULT 'annual',
    height_cm REAL,
    weight_kg REAL,
    bmi REAL,
    bp TEXT,
    pulse INTEGER,
    resp_rate INTEGER,
    temperature REAL,
    vision TEXT,
    hearing TEXT,
    cbc TEXT,
    urinalysis TEXT,
    fecalysis TEXT,
    chest_xray TEXT,
    ecg TEXT,
    drug_test TEXT,
    blood_chem TEXT,
    findings TEXT,
    fitness_status TEXT NOT NULL DEFAULT 'pending',
    next_due TEXT,
    examiner TEXT,
    remarks TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS requirement_templates (
    id ${PK},
    name TEXT NOT NULL,
    category TEXT,
    required ${BOOL} NOT NULL DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    active ${BOOL} NOT NULL DEFAULT 1
  )`,

  `CREATE TABLE IF NOT EXISTS newhire_clearances (
    id ${PK},
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    position_applied TEXT,
    requested_date TEXT NOT NULL,
    target_start_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    remarks TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS newhire_items (
    id ${PK},
    clearance_id INTEGER NOT NULL REFERENCES newhire_clearances(id) ON DELETE CASCADE,
    requirement TEXT NOT NULL,
    category TEXT,
    required ${BOOL} NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    result_date TEXT,
    result_value TEXT,
    remarks TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS clinic_visits (
    id ${PK},
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    visit_date ${NOW},
    complaint TEXT,
    bp TEXT,
    temperature REAL,
    pulse INTEGER,
    assessment TEXT,
    treatment TEXT,
    disposition TEXT,
    follow_up_date TEXT,
    attended_by TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS medications (
    id ${PK},
    name TEXT NOT NULL,
    form TEXT,
    unit TEXT,
    stock INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    expiry TEXT,
    active ${BOOL} NOT NULL DEFAULT 1,
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS med_dispense (
    id ${PK},
    visit_id INTEGER REFERENCES clinic_visits(id) ON DELETE SET NULL,
    medication_id INTEGER NOT NULL REFERENCES medications(id),
    employee_id INTEGER REFERENCES employees(id),
    quantity INTEGER NOT NULL,
    dispensed_by INTEGER REFERENCES users(id),
    dispensed_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS messages (
    id ${PK},
    sender_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL DEFAULT 'individual',
    category TEXT DEFAULT 'announcement',
    subject TEXT,
    body TEXT NOT NULL,
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS message_recipients (
    id ${PK},
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    read_at TEXT,
    acknowledged_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS error_log (
    id ${PK},
    level TEXT NOT NULL DEFAULT 'error',
    source TEXT NOT NULL DEFAULT 'server',
    message TEXT,
    detail TEXT,
    route TEXT,
    user_id INTEGER,
    resolved ${BOOL} NOT NULL DEFAULT 0,
    resolution_note TEXT,
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS lookups (
    id ${PK},
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS sms_log (
    id ${PK},
    employee_id INTEGER,
    phone TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'simulated',
    provider TEXT,
    detail TEXT,
    sent_by INTEGER,
    created_at ${NOW}
  )`,

  `CREATE TABLE IF NOT EXISTS attachments (
    id ${PK},
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    category TEXT,
    filename TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    path TEXT NOT NULL,
    uploaded_by INTEGER,
    created_at ${NOW}
  )`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_ape_emp ON ape_records(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ape_due ON ape_records(next_due)`,
  `CREATE INDEX IF NOT EXISTS idx_clear_emp ON newhire_clearances(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_items_clear ON newhire_items(clearance_id)`,
  `CREATE INDEX IF NOT EXISTS idx_visit_emp ON clinic_visits(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recip_msg ON message_recipients(message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recip_emp ON message_recipients(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_emp ON users(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_errlog_time ON error_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_lookups_type ON lookups(type)`,
  `CREATE INDEX IF NOT EXISTS idx_smslog_emp ON sms_log(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attach_entity ON attachments(entity_type, entity_id)`,
];

// Migrations for databases created before these columns existed.
// ADD COLUMN that already exists throws; we ignore that specific case.
const MIGRATIONS = [
  `ALTER TABLE users ADD COLUMN employee_id INTEGER`,
  `ALTER TABLE users ADD COLUMN must_change_pw ${BOOL} NOT NULL DEFAULT 0`,
  `ALTER TABLE error_log ADD COLUMN resolved ${BOOL} NOT NULL DEFAULT 0`,
  `ALTER TABLE error_log ADD COLUMN resolution_note TEXT`,
];

(async () => {
  try {
    for (const sql of TABLES) await db.exec(sql);
    for (const sql of INDEXES) await db.exec(sql);
    for (const sql of MIGRATIONS) {
      try { await db.exec(sql); }
      catch (e) { if (!/duplicate column|already exists/i.test(e.message)) throw e; }
    }
    console.log(`[init-db] Schema ready (engine: ${db.engine}).`);
    process.exit(0);
  } catch (e) {
    console.error('[init-db] Failed:', e.message);
    process.exit(1);
  }
})();
