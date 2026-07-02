const express = require('express');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

// Dashboard summary counters
router.get('/dashboard', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const totalEmp = (await db.get("SELECT COUNT(*) AS n FROM employees WHERE status = 'active'")).n;
  const fit = (await db.get("SELECT COUNT(*) AS n FROM (SELECT employee_id, fitness_status FROM ape_records a WHERE a.exam_date = (SELECT MAX(exam_date) FROM ape_records b WHERE b.employee_id = a.employee_id)) t WHERE fitness_status = 'fit'")).n;
  const unfit = (await db.get("SELECT COUNT(*) AS n FROM (SELECT employee_id, fitness_status FROM ape_records a WHERE a.exam_date = (SELECT MAX(exam_date) FROM ape_records b WHERE b.employee_id = a.employee_id)) t WHERE fitness_status IN ('unfit','fit_with_restriction')")).n;
  const overdue = (await db.get(
    `SELECT COUNT(*) AS n FROM employees e WHERE e.status='active' AND (
       SELECT next_due FROM ape_records x WHERE x.employee_id = e.id ORDER BY exam_date DESC LIMIT 1
     ) < ?`, [today])).n;
  const noRecord = (await db.get(
    `SELECT COUNT(*) AS n FROM employees e WHERE e.status='active' AND NOT EXISTS (SELECT 1 FROM ape_records a WHERE a.employee_id = e.id)`)).n;
  const pendingClearance = (await db.get("SELECT COUNT(*) AS n FROM newhire_clearances WHERE status IN ('pending','in_progress')")).n;
  const visitsThisMonth = (await db.get(`SELECT COUNT(*) AS n FROM clinic_visits WHERE substr(visit_date,1,7) = ?`, [today.slice(0, 7)])).n;
  const lowStock = (await db.get('SELECT COUNT(*) AS n FROM medications WHERE active = 1 AND stock <= reorder_level')).n;
  const followups = (await db.get(`SELECT COUNT(*) AS n FROM clinic_visits WHERE follow_up_date IS NOT NULL AND follow_up_date <> '' AND follow_up_date <= ?`, [today])).n;
  res.json({ totalEmp, fit, unfit, overdue, noRecord, pendingClearance, visitsThisMonth, lowStock, followups });
});

// APE compliance by department
router.get('/ape-compliance', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT e.department,
            COUNT(*) AS total,
            SUM(CASE WHEN nd.next_due IS NOT NULL AND nd.next_due >= ? THEN 1 ELSE 0 END) AS compliant
     FROM employees e
     LEFT JOIN (SELECT employee_id, MAX(exam_date) ed,
                  (SELECT next_due FROM ape_records y WHERE y.employee_id = x.employee_id ORDER BY exam_date DESC LIMIT 1) next_due
                FROM ape_records x GROUP BY employee_id) nd ON nd.employee_id = e.id
     WHERE e.status = 'active'
     GROUP BY e.department ORDER BY e.department`,
    [today]
  );
  res.json(rows.map((r) => ({
    department: r.department || 'Unassigned',
    total: r.total,
    compliant: r.compliant || 0,
    rate: r.total ? Math.round(((r.compliant || 0) / r.total) * 100) : 0,
  })));
});

// Fitness status distribution (latest exam per employee)
router.get('/fitness-distribution', async (req, res) => {
  const { rows } = await db.query(
    `SELECT fitness_status AS status, COUNT(*) AS n FROM (
       SELECT a.employee_id, a.fitness_status FROM ape_records a
       WHERE a.exam_date = (SELECT MAX(exam_date) FROM ape_records b WHERE b.employee_id = a.employee_id)
     ) t GROUP BY fitness_status`
  );
  res.json(rows);
});

// Top complaints from clinic visits
router.get('/top-complaints', async (req, res) => {
  const { rows } = await db.query(
    `SELECT complaint, COUNT(*) AS n FROM clinic_visits
     WHERE complaint IS NOT NULL AND complaint <> ''
     GROUP BY complaint ORDER BY n DESC LIMIT 10`
  );
  res.json(rows);
});

// Clinic visit volume by month (last 12 months)
router.get('/visit-trend', async (req, res) => {
  const { rows } = await db.query(
    `SELECT substr(visit_date,1,7) AS month, COUNT(*) AS n
     FROM clinic_visits GROUP BY substr(visit_date,1,7) ORDER BY month DESC LIMIT 12`
  );
  res.json(rows.reverse());
});

module.exports = router;
