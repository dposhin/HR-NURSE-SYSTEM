const express = require('express');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

// ---- Requirement templates (configurable checklist, incl. Neuro exam) ----
router.get('/templates', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM requirement_templates WHERE active = 1 ORDER BY sort_order, name');
  res.json(rows);
});

router.post('/templates', async (req, res) => {
  const { name, category, required, sort_order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = await db.run(
    'INSERT INTO requirement_templates (name, category, required, sort_order) VALUES (?, ?, ?, ?)',
    [name, category || null, required === false ? 0 : 1, sort_order || 0]
  );
  res.status(201).json(await db.get('SELECT * FROM requirement_templates WHERE id = ?', [r.lastId]));
});

router.delete('/templates/:id', async (req, res) => {
  await db.run('UPDATE requirement_templates SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ---- Clearances ----
function rollupStatus(items) {
  if (!items.length) return 'pending';
  const req = items.filter((i) => i.required);
  if (req.some((i) => i.status === 'failed')) return 'failed';
  if (req.length && req.every((i) => i.status === 'passed' || i.status === 'waived')) return 'cleared';
  if (items.some((i) => i.status !== 'pending')) return 'in_progress';
  return 'pending';
}

router.get('/', async (req, res) => {
  const { status } = req.query;
  const where = status ? ' WHERE c.status = ?' : '';
  const { rows } = await db.query(
    `SELECT c.*, e.first_name, e.last_name, e.emp_no, e.department
     FROM newhire_clearances c JOIN employees e ON e.id = c.employee_id${where}
     ORDER BY c.requested_date DESC`,
    status ? [status] : []
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const c = await db.get('SELECT * FROM newhire_clearances WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Clearance not found' });
  const emp = await db.get('SELECT id, emp_no, first_name, last_name, department, position FROM employees WHERE id = ?', [c.employee_id]);
  const items = (await db.query('SELECT * FROM newhire_items WHERE clearance_id = ? ORDER BY id', [c.id])).rows;
  res.json({ ...c, employee: emp, items });
});

// Create a clearance; auto-populate items from active templates (or provided list)
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.employee_id) return res.status(400).json({ error: 'employee_id required' });
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.run(
    'INSERT INTO newhire_clearances (employee_id, position_applied, requested_date, target_start_date, remarks, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [b.employee_id, b.position_applied || null, b.requested_date || today, b.target_start_date || null, b.remarks || null, 'pending', req.user.id]
  );
  const clearanceId = r.lastId;
  let templates;
  if (Array.isArray(b.items) && b.items.length) {
    templates = b.items.map((i) => ({ name: i.requirement || i.name, category: i.category, required: i.required }));
  } else {
    templates = (await db.query('SELECT * FROM requirement_templates WHERE active = 1 ORDER BY sort_order, name')).rows;
  }
  for (const t of templates) {
    await db.run(
      'INSERT INTO newhire_items (clearance_id, requirement, category, required, status) VALUES (?, ?, ?, ?, ?)',
      [clearanceId, t.name, t.category || null, t.required === false ? 0 : 1, 'pending']
    );
  }
  res.status(201).json(await db.get('SELECT * FROM newhire_clearances WHERE id = ?', [clearanceId]));
});

// Update a single checklist item, then recompute clearance status
router.put('/:id/items/:itemId', async (req, res) => {
  const b = req.body || {};
  const cols = ['status', 'result_date', 'result_value', 'remarks'].filter((f) => b[f] !== undefined);
  if (cols.length) {
    const params = cols.map((f) => b[f]);
    params.push(req.params.itemId, req.params.id);
    await db.run(`UPDATE newhire_items SET ${cols.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND clearance_id = ?`, params);
  }
  const items = (await db.query('SELECT * FROM newhire_items WHERE clearance_id = ?', [req.params.id])).rows
    .map((i) => ({ ...i, required: !!i.required }));
  const status = rollupStatus(items);
  await db.run('UPDATE newhire_clearances SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ status, items });
});

router.put('/:id', async (req, res) => {
  const b = req.body || {};
  const cols = ['position_applied', 'target_start_date', 'status', 'remarks'].filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  const params = cols.map((f) => b[f]);
  params.push(req.params.id);
  await db.run(`UPDATE newhire_clearances SET ${cols.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, params);
  res.json(await db.get('SELECT * FROM newhire_clearances WHERE id = ?', [req.params.id]));
});

// Convert a cleared applicant into a regular employee.
// Sets employee status = active (+ date_hired) and upgrades any 'applicant'
// portal login to 'employee'. This is where a completed new-hire "transfers".
router.post('/:id/hire', async (req, res) => {
  const c = await db.get('SELECT * FROM newhire_clearances WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Clearance not found' });
  if (c.status !== 'cleared') return res.status(400).json({ error: 'Clearance is not marked cleared yet' });
  const hireDate = (req.body && req.body.date_hired) || new Date().toISOString().slice(0, 10);
  await db.run("UPDATE employees SET status = 'active', date_hired = COALESCE(NULLIF(date_hired,''), ?) WHERE id = ?", [hireDate, c.employee_id]);
  // Upgrade portal role applicant -> employee, if such an account exists
  await db.run("UPDATE users SET role = 'employee' WHERE employee_id = ? AND role = 'applicant'", [c.employee_id]);
  await db.run("UPDATE newhire_clearances SET status = 'hired' WHERE id = ?", [req.params.id]);
  res.json({ ok: true, employee_id: c.employee_id, date_hired: hireDate });
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM newhire_clearances WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
