const express = require('express');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

// List sent messages with recipient counts
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.*, u.name AS sender_name,
            (SELECT COUNT(*) FROM message_recipients r WHERE r.message_id = m.id) AS recipient_count,
            (SELECT COUNT(*) FROM message_recipients r WHERE r.message_id = m.id AND r.acknowledged_at IS NOT NULL) AS ack_count
     FROM messages m LEFT JOIN users u ON u.id = m.sender_id
     ORDER BY m.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const m = await db.get('SELECT * FROM messages WHERE id = ?', [req.params.id]);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  const recipients = (await db.query(
    `SELECT r.*, e.first_name, e.last_name, e.emp_no, e.department, e.email, e.phone
     FROM message_recipients r JOIN employees e ON e.id = r.employee_id
     WHERE r.message_id = ? ORDER BY e.last_name`,
    [req.params.id]
  )).rows;
  res.json({ ...m, recipients });
});

/**
 * Send a message.
 * body: {
 *   type: 'broadcast' | 'individual',
 *   category: 'follow_up' | 'announcement' | 'reminder',
 *   subject, body,
 *   employee_ids: [..]        // for individual
 *   department: 'X'           // optional broadcast filter; omit = everyone active
 * }
 */
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.body) return res.status(400).json({ error: 'Message body required' });
  const type = b.type === 'individual' ? 'individual' : 'broadcast';

  let recipientIds = [];
  if (type === 'individual') {
    recipientIds = (b.employee_ids || []).map(Number).filter(Boolean);
    if (!recipientIds.length) return res.status(400).json({ error: 'Select at least one recipient' });
  } else {
    const where = ["status = 'active'"];
    const params = [];
    if (b.department) { where.push('department = ?'); params.push(b.department); }
    const { rows } = await db.query(`SELECT id FROM employees WHERE ${where.join(' AND ')}`, params);
    recipientIds = rows.map((r) => r.id);
  }
  if (!recipientIds.length) return res.status(400).json({ error: 'No matching recipients' });

  const r = await db.run(
    'INSERT INTO messages (sender_id, type, category, subject, body) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, type, b.category || 'announcement', b.subject || null, b.body]
  );
  for (const eid of recipientIds) {
    await db.run('INSERT INTO message_recipients (message_id, employee_id) VALUES (?, ?)', [r.lastId, eid]);
  }
  res.status(201).json({ id: r.lastId, recipients: recipientIds.length });
});

// Mark a recipient acknowledged (e.g. employee confirmed follow-up)
router.post('/:id/recipients/:empId/ack', async (req, res) => {
  const now = new Date().toISOString();
  await db.run(
    'UPDATE message_recipients SET acknowledged_at = ?, read_at = COALESCE(read_at, ?) WHERE message_id = ? AND employee_id = ?',
    [now, now, req.params.id, req.params.empId]
  );
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await db.run('DELETE FROM messages WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
