/**
 * SMS sending & blasting (staff only). Resolves recipients, sends via the configured
 * provider (or simulates), and records every attempt in sms_log.
 */
const express = require('express');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');
const sms = require('../lib/sms');

const router = express.Router();
router.use(authRequired, staffOnly);

// Provider status (does NOT reveal the key)
router.get('/status', (req, res) => {
  const c = sms.config();
  res.json({ configured: sms.isConfigured(), provider: c.provider || '(none)', sender: c.sender || '', mode: sms.isConfigured() ? 'live' : 'simulate' });
});

// Recent send history
router.get('/log', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, e.first_name, e.last_name FROM sms_log s LEFT JOIN employees e ON e.id = s.employee_id
     ORDER BY s.id DESC LIMIT 200`);
  res.json(rows);
});

/**
 * Send / blast.
 * body: {
 *   message: "...",                     // required
 *   employee_ids: [1,2],                // individual by employee
 *   department: "Production",           // OR blast to a department
 *   all: true,                          // OR blast to all active employees with a phone
 *   numbers: ["0917..."]                // OR raw numbers (no employee link)
 * }
 */
router.post('/send', async (req, res) => {
  const b = req.body || {};
  const message = (b.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });

  // Resolve recipients -> [{ employee_id, phone }]
  let targets = [];
  if (Array.isArray(b.numbers) && b.numbers.length) {
    targets = b.numbers.map((n) => ({ employee_id: null, phone: String(n).trim() })).filter((t) => t.phone);
  } else {
    const where = ["status = 'active'", "phone IS NOT NULL", "phone <> ''"];
    const params = [];
    if (Array.isArray(b.employee_ids) && b.employee_ids.length) {
      where.push(`id IN (${b.employee_ids.map(() => '?').join(',')})`);
      params.push(...b.employee_ids.map(Number));
    } else if (b.department) {
      where.push('department = ?'); params.push(b.department);
    } else if (!b.all) {
      return res.status(400).json({ error: 'Choose recipients: employee_ids, department, all, or numbers' });
    }
    const { rows } = await db.query(`SELECT id, phone FROM employees WHERE ${where.join(' AND ')}`, params);
    targets = rows.map((r) => ({ employee_id: r.id, phone: r.phone }));
  }
  if (!targets.length) return res.status(400).json({ error: 'No recipients with a phone number matched' });

  const results = { total: targets.length, sent: 0, failed: 0, simulated: 0 };
  for (const t of targets) {
    const r = await sms.sendOne(t.phone, message);
    results[r.status] = (results[r.status] || 0) + 1;
    await db.run(
      'INSERT INTO sms_log (employee_id, phone, message, status, provider, detail, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [t.employee_id, t.phone, message, r.status, sms.config().provider || 'simulate', r.detail || null, req.user.id]
    );
  }
  res.json({ ok: true, mode: sms.isConfigured() ? 'live' : 'simulate', results });
});

module.exports = router;
