/**
 * Seeds an admin user, default new-hire requirement templates (incl. Neuro exam),
 * a starter medication list, and a few sample employees/records for demo.
 * Run with:  npm run seed
 * Set SEED_DEMO=0 to skip sample employees (keep only admin + templates + meds).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const NURSE_USER = process.env.NURSE_USER || 'nurse';
const NURSE_PASS = process.env.NURSE_PASS || 'nurse123';
const DEMO = process.env.SEED_DEMO !== '0';

// Records the credentials we actually created, printed at the end.
const CREATED = [];

const SETTINGS = {
  system_name: 'HR Nurse System',
  tagline: 'Employee Occupational Health Management',
  logo_emoji: '＋',
  color_primary: '#1a7f6b',
  color_accent: '#2563eb',
  color_sidebar: '#0f2b27',
};

const TEMPLATES = [
  ['Medical History & Physical Exam', 'physical', 1, 1],
  ['Neurological Examination (Neuro)', 'neuro', 1, 2],
  ['Chest X-ray', 'imaging', 1, 3],
  ['Complete Blood Count (CBC)', 'laboratory', 1, 4],
  ['Urinalysis', 'laboratory', 1, 5],
  ['Fecalysis', 'laboratory', 1, 6],
  ['Drug Test (10-panel)', 'laboratory', 1, 7],
  ['Hepatitis B Screening', 'laboratory', 1, 8],
  ['Visual Acuity / Ishihara', 'vision', 1, 9],
  ['Audiometry (Hearing)', 'hearing', 0, 10],
  ['ECG (12-lead)', 'cardio', 0, 11],
  ['Psychological / Mental Status Exam', 'neuro', 0, 12],
];

const MEDS = [
  ['Paracetamol 500mg', 'tablet', 'tab', 200, 50, '2027-12-31'],
  ['Mefenamic Acid 500mg', 'capsule', 'cap', 100, 30, '2027-06-30'],
  ['Loperamide 2mg', 'capsule', 'cap', 80, 20, '2027-09-30'],
  ['Antacid', 'tablet', 'tab', 120, 40, '2027-03-31'],
  ['Cetirizine 10mg', 'tablet', 'tab', 90, 30, '2027-08-31'],
  ['Oral Rehydration Salts', 'sachet', 'sachet', 60, 20, '2026-12-31'],
  ['Povidone-Iodine', 'solution', 'bottle', 15, 5, '2027-01-31'],
  ['Sterile Gauze', 'supply', 'pack', 50, 15, null],
];

// Employee IDs are numeric (numbers only).
const EMPLOYEES = [
  ['1001', 'Maria', 'Santos', 'F', '1990-03-12', 'Production', 'Line Operator', '2021-02-01', 'O+', '09171234567', 'maria.santos@example.com'],
  ['1002', 'Juan', 'Dela Cruz', 'M', '1985-07-22', 'Warehouse', 'Forklift Operator', '2019-06-15', 'A+', '09181234567', 'juan.delacruz@example.com'],
  ['1003', 'Ana', 'Reyes', 'F', '1993-11-05', 'Admin', 'HR Assistant', '2022-09-01', 'B+', '09191234567', 'ana.reyes@example.com'],
  ['1004', 'Pedro', 'Lim', 'M', '1978-01-30', 'Maintenance', 'Electrician', '2015-04-10', 'AB+', '09201234567', 'pedro.lim@example.com'],
  ['1005', 'Grace', 'Tan', 'F', '1996-05-18', 'Quality', 'QA Inspector', '2023-03-20', 'O-', '09211234567', 'grace.tan@example.com'],
];

const DEPARTMENTS = ['Production', 'Warehouse', 'Admin', 'Maintenance', 'Quality', 'Finance', 'HR', 'IT'];
const POSITIONS = ['Line Operator', 'Forklift Operator', 'HR Assistant', 'Electrician', 'QA Inspector', 'Supervisor', 'Manager', 'Staff'];

async function ensureSettings() {
  for (const [k, v] of Object.entries(SETTINGS)) {
    const ex = await db.get('SELECT key FROM settings WHERE key = ?', [k]);
    if (!ex) await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }
  console.log('[seed] Default branding/theme settings ensured.');
}

async function ensureStaff(name, username, pass, role) {
  const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) { console.log(`[seed] ${role} "${username}" already exists.`); return; }
  await db.run('INSERT INTO users (name, username, password_hash, role, active) VALUES (?, ?, ?, ?, 1)',
    [name, username, bcrypt.hashSync(pass, 10), role]);
  CREATED.push([role, username, pass]);
  console.log(`[seed] ${role} created -> ${username} / ${pass}`);
}

// Create a portal login linked to an existing employee record
async function ensurePortalAccount(employeeId, username, pass, role) {
  const linked = await db.get('SELECT id FROM users WHERE employee_id = ?', [employeeId]);
  if (linked) return;
  if (await db.get('SELECT id FROM users WHERE username = ?', [username])) return;
  const emp = await db.get('SELECT first_name, last_name FROM employees WHERE id = ?', [employeeId]);
  if (!emp) return;
  await db.run('INSERT INTO users (name, username, password_hash, role, employee_id, active) VALUES (?, ?, ?, ?, ?, 1)',
    [`${emp.first_name} ${emp.last_name}`, username, bcrypt.hashSync(pass, 10), role, employeeId]);
  CREATED.push([role, username, pass]);
  console.log(`[seed] ${role} portal login -> ${username} / ${pass}  (employee #${employeeId})`);
}

async function ensureTemplates() {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM requirement_templates');
  if (rows[0].n > 0) { console.log('[seed] Requirement templates already present.'); return; }
  for (const t of TEMPLATES) {
    await db.run('INSERT INTO requirement_templates (name, category, required, sort_order) VALUES (?, ?, ?, ?)', t);
  }
  console.log(`[seed] ${TEMPLATES.length} requirement templates added.`);
}

async function ensureMeds() {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM medications');
  if (rows[0].n > 0) { console.log('[seed] Medications already present.'); return; }
  for (const m of MEDS) {
    await db.run('INSERT INTO medications (name, form, unit, stock, reorder_level, expiry) VALUES (?, ?, ?, ?, ?, ?)', m);
  }
  console.log(`[seed] ${MEDS.length} medications added.`);
}

async function ensureLookups() {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM lookups');
  if (rows[0].n > 0) { console.log('[seed] Lookups already present.'); return; }
  let i = 0;
  for (const d of DEPARTMENTS) await db.run('INSERT INTO lookups (type, value, sort_order) VALUES (?, ?, ?)', ['department', d, i++]);
  i = 0;
  for (const p of POSITIONS) await db.run('INSERT INTO lookups (type, value, sort_order) VALUES (?, ?, ?)', ['position', p, i++]);
  console.log(`[seed] ${DEPARTMENTS.length} departments and ${POSITIONS.length} positions added.`);
}

async function ensureDemo() {
  if (!DEMO) return;
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM employees');
  if (rows[0].n > 0) { console.log('[seed] Employees already present, skipping demo data.'); return; }
  for (const e of EMPLOYEES) {
    await db.run(
      `INSERT INTO employees (emp_no, first_name, last_name, sex, birthdate, department, position, date_hired, blood_type, phone, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, e);
  }
  // A couple of APE records (one due soon, one overdue)
  const today = new Date();
  const ago = (d) => new Date(today.getTime() - d * 86400000).toISOString().slice(0, 10);
  const plus = (d) => new Date(today.getTime() + d * 86400000).toISOString().slice(0, 10);
  await db.run(
    `INSERT INTO ape_records (employee_id, exam_date, exam_type, height_cm, weight_kg, bmi, bp, pulse, fitness_status, next_due, examiner)
     VALUES (1, ?, 'annual', 158, 55, 22, '118/76', 72, 'fit', ?, 'Dr. Cruz')`, [ago(320), plus(45)]);
  await db.run(
    `INSERT INTO ape_records (employee_id, exam_date, exam_type, height_cm, weight_kg, bmi, bp, pulse, fitness_status, next_due, examiner)
     VALUES (2, ?, 'annual', 170, 88, 30.4, '140/92', 84, 'fit_with_restriction', ?, 'Dr. Cruz')`, [ago(400), ago(35)]);
  await db.run(
    `INSERT INTO clinic_visits (employee_id, visit_date, complaint, bp, temperature, pulse, assessment, treatment, disposition, follow_up_date, attended_by, created_by)
     VALUES (3, ?, 'Headache', '120/80', 36.8, 76, 'Tension headache', 'Paracetamol 500mg given', 'back_to_work', ?, 'Nurse on duty', 1)`,
    [ago(2) + ' 09:30:00', plus(3)]);

  // A sample new-hire clearance for employee #5 (Grace), with the standard checklist
  await db.run(
    'INSERT INTO newhire_clearances (employee_id, position_applied, requested_date, target_start_date, status, created_by) VALUES (5, ?, ?, ?, ?, 1)',
    ['QA Inspector', ago(5), plus(20), 'in_progress']);
  const clr = await db.get('SELECT id FROM newhire_clearances WHERE employee_id = 5 ORDER BY id DESC LIMIT 1');
  const tpls = (await db.query('SELECT name, category, required FROM requirement_templates WHERE active = 1 ORDER BY sort_order, name')).rows;
  for (let i = 0; i < tpls.length; i++) {
    const status = i < 2 ? 'passed' : 'pending'; // first couple already done
    await db.run('INSERT INTO newhire_items (clearance_id, requirement, category, required, status) VALUES (?, ?, ?, ?, ?)',
      [clr.id, tpls[i].name, tpls[i].category, tpls[i].required, status]);
  }
  console.log('[seed] Demo employees, APE records, clinic visit, and a new-hire clearance added.');

  // Default portal logins so each role can be tried immediately
  await ensurePortalAccount(1, 'employee', 'employee123', 'employee');   // Maria Santos
  await ensurePortalAccount(5, 'newhire', 'newhire123', 'applicant');    // Grace Tan (applicant)
}

function printCredentials() {
  console.log('\n========================================================');
  console.log(' DEFAULT LOGIN CREDENTIALS');
  console.log('========================================================');
  // Always show the master accounts (even if they already existed)
  const table = [
    ['admin (master controller)', ADMIN_USER, ADMIN_PASS],
    ['nurse (HR Nurse)', NURSE_USER, NURSE_PASS],
  ];
  if (DEMO) {
    table.push(['employee (portal)', 'employee', 'employee123']);
    table.push(['applicant / new-hire (portal)', 'newhire', 'newhire123']);
  }
  for (const [role, u, p] of table) {
    console.log(`  ${role.padEnd(30)} ${String(u).padEnd(12)} ${p}`);
  }
  console.log('--------------------------------------------------------');
  console.log('  CHANGE THESE PASSWORDS AFTER FIRST LOGIN.');
  console.log('  Admin can manage all credentials in Control Panel > Users.');
  console.log('========================================================\n');
}

(async () => {
  try {
    await ensureSettings();
    await ensureStaff('Administrator', ADMIN_USER, ADMIN_PASS, 'admin');
    await ensureStaff('HR Nurse', NURSE_USER, NURSE_PASS, 'nurse');
    await ensureTemplates();
    await ensureMeds();
    await ensureLookups();
    await ensureDemo();
    printCredentials();
    console.log('[seed] Done.');
    process.exit(0);
  } catch (e) {
    console.error('[seed] Failed:', e.message);
    process.exit(1);
  }
})();
