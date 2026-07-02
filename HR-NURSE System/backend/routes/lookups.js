/**
 * Managed dropdown lists (departments, positions).
 * Readable by staff (to populate forms); writable by admin only.
 */
const express = require('express');
const db = require('../db');
const { authRequired, staffOnly, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

// GET /api/lookups            -> { department: [...], position: [...] }
// GET /api/lookups?type=department -> [ ... ]
router.get('/', async (req, res) => {
  if (req.query.type) {
    const { rows } = await db.query('SELECT * FROM lookups WHERE type = ? ORDER BY sort_order, value', [req.query.type]);
    return res.json(rows);
  }
  const { rows } = await db.query('SELECT * FROM lookups ORDER BY type, sort_order, value');
  const out = { department: [], position: [] };
  for (const r of rows) { (out[r.type] = out[r.type] || []).push(r); }
  res.json(out);
});

router.post('/', authRequired, adminOnly, async (req, res) => {
  const { type, value } = req.body || {};
  if (!type || !value) return res.status(400).json({ error: 'type and value required' });
  if (!['department', 'position'].includes(type)) return res.status(400).json({ error: 'type must be department or position' });
  const exists = await db.get('SELECT id FROM lookups WHERE type = ? AND value = ?', [type, value.trim()]);
  if (exists) return res.status(409).json({ error: 'Already in the list' });
  const max = (await db.get('SELECT MAX(sort_order) AS m FROM lookups WHERE type = ?', [type])).m || 0;
  const r = await db.run('INSERT INTO lookups (type, value, sort_order) VALUES (?, ?, ?)', [type, value.trim(), max + 1]);
  res.status(201).json(await db.get('SELECT * FROM lookups WHERE id = ?', [r.lastId]));
});

router.delete('/:id', authRequired, adminOnly, async (req, res) => {
  await db.run('DELETE FROM lookups WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
