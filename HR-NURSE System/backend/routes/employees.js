const express = require('express');
const db = require('../db');
const bcrypt = require('bcryptjs');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

const FIELDS = [
  'emp_no', 'first_name', 'last_name', 'sex', 'birthdate', 'department', 'position',
  'date_hired', 'status', 'blood_type', 'phone', 'email', 'address',
  'emergency_contact', 'emergency_phone', 'allergies', 'chronic_conditions', 'notes',
];

// List with optional search / department / status filters
router.get('/', async (req, res) => {
  const { q, department, status } = req.query;
  const where = [];
  const params = [];
  if (q) {
    where.push('(first_name LIKE ? OR last_name LIKE ? OR emp_no LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (department) { where.push('department = ?'); params.push(department); }
  if (status) { where.push('status = ?'); params.push(status); }
  const sql =
    'SELECT * FROM employees' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY last_name, first_name';
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

router.get('/departments', async (req, res) => {
  const { rows } = await db.query(
    "SELECT department, COUNT(*) AS count FROM employees WHERE department IS NOT NULL AND department <> '' GROUP BY department ORDER BY department"
  );
  res.json(rows);
});

// Full profile incl. related health history
router.get('/:id', async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const ape = (await db.query('SELECT * FROM ape_records WHERE employee_id = ? ORDER BY exam_date DESC', [req.params.id])).rows;
  const visits = (await db.query('SELECT * FROM clinic_visits WHERE employee_id = ? ORDER BY visit_date DESC', [req.params.id])).rows;
  const clearances = (await db.query('SELECT * FROM newhire_clearances WHERE employee_id = ? ORDER BY requested_date DESC', [req.params.id])).rows;
  res.json({ ...emp, ape, visits, clearances });
});

// Employee ID (emp_no) must be digits only, when provided
function invalidEmpNo(v) {
  return v !== undefined && v !== null && String(v).trim() !== '' && !/^\d+$/.test(String(v).trim());
}

// Bulk import from parsed rows: [{ emp_no, first_name, last_name, ... }]
router.post('/import', async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: 'No rows provided' });
  const result = { inserted: 0, skipped: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const line = i + 2; // account for header row in the sheet
    if (!r.first_name || !r.last_name) { result.skipped++; result.errors.push(`Row ${line}: missing first/last name`); continue; }
    if (invalidEmpNo(r.emp_no)) { result.skipped++; result.errors.push(`Row ${line}: employee ID "${r.emp_no}" must be numbers only`); continue; }
    if (r.emp_no && await db.get('SELECT id FROM employees WHERE emp_no = ?', [String(r.emp_no).trim()])) {
      result.skipped++; result.errors.push(`Row ${line}: employee ID ${r.emp_no} already exists`); continue;
    }
    const cols = FIELDS.filter((f) => r[f] !== undefined && r[f] !== '');
    try {
      await db.run(`INSERT INTO employees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((f) => r[f]));
      result.inserted++;
    } catch (e) { result.skipped++; result.errors.push(`Row ${line}: ${e.message}`); }
  }
  res.json(result);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.first_name || !b.last_name) return res.status(400).json({ error: 'First and last name required' });
  if (invalidEmpNo(b.emp_no)) return res.status(400).json({ error: 'Employee ID must be numbers only' });
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  const placeholders = cols.map(() => '?').join(', ');
  const params = cols.map((f) => b[f]);
  const result = await db.run(
    `INSERT INTO employees (${cols.join(', ')}) VALUES (${placeholders})`,
    params
  );
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [result.lastId]);
  res.status(201).json(emp);
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  if (invalidEmpNo(b.emp_no)) return res.status(400).json({ error: 'Employee ID must be numbers only' });
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  const set = cols.map((f) => `${f} = ?`).join(', ');
  const params = cols.map((f) => b[f]);
  params.push(req.params.id);
  await db.run(`UPDATE employees SET ${set} WHERE id = ?`, params);
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  res.json(emp);
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ---- Portal account management (nurse creates logins for employees/applicants) ----
function randPass() {
  return Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);
}

router.get('/:id/account', async (req, res) => {
  const a = await db.get('SELECT id, username, role, active, must_change_pw FROM users WHERE employee_id = ?', [req.params.id]);
  res.json(a || null);
});

router.post('/:id/account', async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const existing = await db.get('SELECT id FROM users WHERE employee_id = ?', [req.params.id]);
  if (existing) return res.status(409).json({ error: 'This person already has an account' });

  const b = req.body || {};
  const role = b.role === 'applicant' ? 'applicant' : 'employee';
  let username = (b.username || emp.emp_no || (emp.first_name[0] + emp.last_name)).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (await db.get('SELECT id FROM users WHERE username = ?', [username])) username += Math.floor(Math.random() * 900 + 100);
  const password = b.password && b.password.length >= 6 ? b.password : randPass();
  await db.run(
    'INSERT INTO users (name, username, password_hash, role, employee_id, must_change_pw, active) VALUES (?, ?, ?, ?, ?, 1, 1)',
    [`${emp.first_name} ${emp.last_name}`, username, bcrypt.hashSync(password, 10), role, emp.id]
  );
  res.status(201).json({ username, password, role, note: 'Share these credentials; the user must change the password at first login.' });
});

router.post('/:id/account/reset', async (req, res) => {
  const acct = await db.get('SELECT id FROM users WHERE employee_id = ?', [req.params.id]);
  if (!acct) return res.status(404).json({ error: 'No account for this employee' });
  const password = (req.body && req.body.password && req.body.password.length >= 6) ? req.body.password : randPass();
  await db.run('UPDATE users SET password_hash = ?, must_change_pw = 1, active = 1 WHERE id = ?', [bcrypt.hashSync(password, 10), acct.id]);
  res.json({ password, note: 'New temporary password. User must change it at next login.' });
});

router.put('/:id/account', async (req, res) => {
  const acct = await db.get('SELECT id FROM users WHERE employee_id = ?', [req.params.id]);
  if (!acct) return res.status(404).json({ error: 'No account for this employee' });
  const updates = {};
  if (req.body.active !== undefined) updates.active = req.body.active ? 1 : 0;
  if (req.body.role && ['employee', 'applicant'].includes(req.body.role)) updates.role = req.body.role;
  const cols = Object.keys(updates);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  await db.run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => updates[c]), acct.id]);
  res.json({ ok: true });
});

module.exports = router;
