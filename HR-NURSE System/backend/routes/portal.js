/**
 * Self-service portal — every route is scoped to the logged-in person's own
 * employee_id. Employees and applicants (new hires) can only ever see their own data.
 */
const express = require('express');
const db = require('../db');
const { authRequired, portalOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, portalOnly);

// A safe, employee-facing subset of the profile (no internal notes).
const PROFILE_COLS = 'id, emp_no, first_name, last_name, sex, birthdate, department, position, date_hired, status, blood_type, phone, email, allergies, chronic_conditions';

// Overview for the logged-in user
router.get('/me', async (req, res) => {
  const eid = req.user.employee_id;
  const profile = await db.get(`SELECT ${PROFILE_COLS} FROM employees WHERE id = ?`, [eid]);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const ape = (await db.query(
    `SELECT exam_date, exam_type, height_cm, weight_kg, bmi, bp, pulse, temperature, vision, hearing,
            findings, fitness_status, next_due, examiner
     FROM ape_records WHERE employee_id = ? ORDER BY exam_date DESC`, [eid])).rows;

  const visits = (await db.query(
    `SELECT visit_date, complaint, assessment, treatment, disposition, follow_up_date
     FROM clinic_visits WHERE employee_id = ? ORDER BY visit_date DESC LIMIT 50`, [eid])).rows;

  const unread = (await db.get(
    'SELECT COUNT(*) AS n FROM message_recipients WHERE employee_id = ? AND read_at IS NULL', [eid])).n;

  res.json({ role: req.user.role, profile, ape, visits, unread });
});

// New-hire applicant: their clearance checklist progress (read-only)
router.get('/clearance', async (req, res) => {
  const eid = req.user.employee_id;
  const c = await db.get('SELECT * FROM newhire_clearances WHERE employee_id = ? ORDER BY requested_date DESC LIMIT 1', [eid]);
  if (!c) return res.json(null);
  const items = (await db.query(
    'SELECT requirement, category, required, status, result_date, result_value FROM newhire_items WHERE clearance_id = ? ORDER BY id', [c.id])).rows;
  res.json({
    status: c.status, position_applied: c.position_applied, requested_date: c.requested_date,
    target_start_date: c.target_start_date, remarks: c.remarks, items,
  });
});

// Messages addressed to this person
router.get('/messages', async (req, res) => {
  const eid = req.user.employee_id;
  const { rows } = await db.query(
    `SELECT m.id, m.subject, m.body, m.category, m.type, m.created_at,
            r.read_at, r.acknowledged_at, u.name AS sender_name
     FROM message_recipients r
     JOIN messages m ON m.id = r.message_id
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE r.employee_id = ? ORDER BY m.created_at DESC LIMIT 100`, [eid]);
  res.json(rows);
});

// Mark a message read
router.post('/messages/:id/read', async (req, res) => {
  await db.run(
    'UPDATE message_recipients SET read_at = COALESCE(read_at, ?) WHERE message_id = ? AND employee_id = ?',
    [new Date().toISOString(), req.params.id, req.user.employee_id]);
  res.json({ ok: true });
});

// Acknowledge a message / follow-up (self-service)
router.post('/messages/:id/ack', async (req, res) => {
  const now = new Date().toISOString();
  const r = await db.run(
    'UPDATE message_recipients SET acknowledged_at = ?, read_at = COALESCE(read_at, ?) WHERE message_id = ? AND employee_id = ?',
    [now, now, req.params.id, req.user.employee_id]);
  if (!r.changes) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true });
});

// Let the user keep their own contact details current
router.put('/contact', async (req, res) => {
  const b = req.body || {};
  const allowed = ['phone', 'email', 'address', 'emergency_contact', 'emergency_phone'];
  const cols = allowed.filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  const params = cols.map((f) => b[f]);
  params.push(req.user.employee_id);
  await db.run(`UPDATE employees SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

module.exports = router;
