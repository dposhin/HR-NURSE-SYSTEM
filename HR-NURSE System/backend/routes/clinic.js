const express = require('express');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

// ---------- Clinic visits ----------
router.get('/visits', async (req, res) => {
  const { employee_id, from, to } = req.query;
  const where = [];
  const params = [];
  if (employee_id) { where.push('v.employee_id = ?'); params.push(employee_id); }
  if (from) { where.push('v.visit_date >= ?'); params.push(from); }
  if (to) { where.push('v.visit_date <= ?'); params.push(to); }
  const { rows } = await db.query(
    `SELECT v.*, e.first_name, e.last_name, e.emp_no, e.department
     FROM clinic_visits v JOIN employees e ON e.id = v.employee_id` +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY v.visit_date DESC LIMIT 500',
    params
  );
  res.json(rows);
});

router.get('/visits/:id', async (req, res) => {
  const v = await db.get('SELECT * FROM clinic_visits WHERE id = ?', [req.params.id]);
  if (!v) return res.status(404).json({ error: 'Visit not found' });
  const meds = (await db.query(
    `SELECT d.*, m.name, m.unit FROM med_dispense d JOIN medications m ON m.id = d.medication_id WHERE d.visit_id = ?`,
    [req.params.id]
  )).rows;
  res.json({ ...v, medications: meds });
});

router.post('/visits', async (req, res) => {
  const b = req.body || {};
  if (!b.employee_id) return res.status(400).json({ error: 'employee_id required' });
  const cols = ['employee_id', 'visit_date', 'complaint', 'bp', 'temperature', 'pulse', 'assessment', 'treatment', 'disposition', 'follow_up_date', 'attended_by']
    .filter((f) => b[f] !== undefined && b[f] !== '');
  const params = cols.map((f) => b[f]);
  params.push(req.user.id);
  const r = await db.run(
    `INSERT INTO clinic_visits (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
    params
  );
  // Optional inline medication dispensing
  if (Array.isArray(b.dispense)) {
    for (const d of b.dispense) {
      if (!d.medication_id || !d.quantity) continue;
      await db.run('INSERT INTO med_dispense (visit_id, medication_id, employee_id, quantity, dispensed_by) VALUES (?, ?, ?, ?, ?)',
        [r.lastId, d.medication_id, b.employee_id, d.quantity, req.user.id]);
      await db.run('UPDATE medications SET stock = stock - ? WHERE id = ?', [d.quantity, d.medication_id]);
    }
  }
  res.status(201).json(await db.get('SELECT * FROM clinic_visits WHERE id = ?', [r.lastId]));
});

router.put('/visits/:id', async (req, res) => {
  const b = req.body || {};
  const cols = ['complaint', 'bp', 'temperature', 'pulse', 'assessment', 'treatment', 'disposition', 'follow_up_date', 'attended_by']
    .filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  const params = cols.map((f) => b[f]);
  params.push(req.params.id);
  await db.run(`UPDATE clinic_visits SET ${cols.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, params);
  res.json(await db.get('SELECT * FROM clinic_visits WHERE id = ?', [req.params.id]));
});

router.delete('/visits/:id', async (req, res) => {
  await db.run('DELETE FROM clinic_visits WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Follow-ups due (visits with a follow_up_date on/before horizon)
router.get('/followups', async (req, res) => {
  const horizon = new Date(Date.now() + (parseInt(req.query.days || '7', 10)) * 86400000).toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT v.id, v.follow_up_date, v.complaint, v.employee_id, e.first_name, e.last_name, e.emp_no, e.phone, e.email
     FROM clinic_visits v JOIN employees e ON e.id = v.employee_id
     WHERE v.follow_up_date IS NOT NULL AND v.follow_up_date <> '' AND v.follow_up_date <= ?
     ORDER BY v.follow_up_date`,
    [horizon]
  );
  res.json(rows);
});

// ---------- Medications inventory ----------
router.get('/medications', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM medications WHERE active = 1 ORDER BY name');
  res.json(rows);
});

router.post('/medications', async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const r = await db.run(
    'INSERT INTO medications (name, form, unit, stock, reorder_level, expiry) VALUES (?, ?, ?, ?, ?, ?)',
    [b.name, b.form || null, b.unit || null, b.stock || 0, b.reorder_level || 0, b.expiry || null]
  );
  res.status(201).json(await db.get('SELECT * FROM medications WHERE id = ?', [r.lastId]));
});

router.put('/medications/:id', async (req, res) => {
  const b = req.body || {};
  const cols = ['name', 'form', 'unit', 'stock', 'reorder_level', 'expiry'].filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  const params = cols.map((f) => b[f]);
  params.push(req.params.id);
  await db.run(`UPDATE medications SET ${cols.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, params);
  res.json(await db.get('SELECT * FROM medications WHERE id = ?', [req.params.id]));
});

router.post('/medications/:id/restock', async (req, res) => {
  const qty = parseInt((req.body || {}).quantity || '0', 10);
  await db.run('UPDATE medications SET stock = stock + ? WHERE id = ?', [qty, req.params.id]);
  res.json(await db.get('SELECT * FROM medications WHERE id = ?', [req.params.id]));
});

router.delete('/medications/:id', async (req, res) => {
  await db.run('UPDATE medications SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
