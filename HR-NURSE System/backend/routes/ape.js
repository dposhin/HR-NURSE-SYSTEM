const express = require('express');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

const FIELDS = [
  'employee_id', 'exam_date', 'exam_type', 'height_cm', 'weight_kg', 'bmi', 'bp',
  'pulse', 'resp_rate', 'temperature', 'vision', 'hearing', 'cbc', 'urinalysis',
  'fecalysis', 'chest_xray', 'ecg', 'drug_test', 'blood_chem', 'findings',
  'fitness_status', 'next_due', 'examiner', 'remarks',
];

function computeBmi(b) {
  if (b.bmi) return b.bmi;
  const h = parseFloat(b.height_cm), w = parseFloat(b.weight_kg);
  if (h > 0 && w > 0) return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
  return null;
}

// List APE records with employee names; filter by status / due window
router.get('/', async (req, res) => {
  const { status, due_before, employee_id } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('a.fitness_status = ?'); params.push(status); }
  if (employee_id) { where.push('a.employee_id = ?'); params.push(employee_id); }
  if (due_before) { where.push('a.next_due <= ?'); params.push(due_before); }
  const sql =
    `SELECT a.*, e.first_name, e.last_name, e.emp_no, e.department
     FROM ape_records a JOIN employees e ON e.id = a.employee_id` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY a.exam_date DESC';
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

// Employees overdue or due-soon for annual exam (latest record per employee)
router.get('/due', async (req, res) => {
  const horizonDays = parseInt(req.query.days || '60', 10);
  const horizon = new Date(Date.now() + horizonDays * 86400000).toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT e.id, e.emp_no, e.first_name, e.last_name, e.department,
            MAX(a.exam_date) AS last_exam,
            (SELECT next_due FROM ape_records x WHERE x.employee_id = e.id ORDER BY exam_date DESC LIMIT 1) AS next_due
     FROM employees e LEFT JOIN ape_records a ON a.employee_id = e.id
     WHERE e.status = 'active'
     GROUP BY e.id, e.emp_no, e.first_name, e.last_name, e.department`,
    []
  );
  const today = new Date().toISOString().slice(0, 10);
  const flagged = rows
    .map((r) => ({
      ...r,
      state: !r.next_due ? 'no_record' : r.next_due < today ? 'overdue' : r.next_due <= horizon ? 'due_soon' : 'ok',
    }))
    .filter((r) => r.state !== 'ok')
    .sort((a, b) => (a.next_due || '') > (b.next_due || '') ? 1 : -1);
  res.json(flagged);
});

router.get('/:id', async (req, res) => {
  const rec = await db.get('SELECT * FROM ape_records WHERE id = ?', [req.params.id]);
  if (!rec) return res.status(404).json({ error: 'Record not found' });
  res.json(rec);
});

router.post('/', async (req, res) => {
  const b = { ...req.body };
  if (!b.employee_id || !b.exam_date) return res.status(400).json({ error: 'employee_id and exam_date required' });
  b.bmi = computeBmi(b);
  // Default next_due to one year after exam if annual and not provided
  if (!b.next_due && (b.exam_type || 'annual') === 'annual') {
    const d = new Date(b.exam_date); d.setFullYear(d.getFullYear() + 1);
    b.next_due = d.toISOString().slice(0, 10);
  }
  const cols = FIELDS.filter((f) => b[f] !== undefined && b[f] !== '');
  const params = cols.map((f) => b[f]);
  params.push(req.user.id);
  const result = await db.run(
    `INSERT INTO ape_records (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
    params
  );
  const rec = await db.get('SELECT * FROM ape_records WHERE id = ?', [result.lastId]);
  res.status(201).json(rec);
});

router.put('/:id', async (req, res) => {
  const b = { ...req.body };
  if (b.height_cm || b.weight_kg) b.bmi = computeBmi(b);
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  const params = cols.map((f) => b[f]);
  params.push(req.params.id);
  await db.run(`UPDATE ape_records SET ${cols.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, params);
  res.json(await db.get('SELECT * FROM ape_records WHERE id = ?', [req.params.id]));
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM ape_records WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
