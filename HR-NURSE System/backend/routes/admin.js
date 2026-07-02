/**
 * Administrator control panel API. Admin is the master controller:
 * manages ALL user accounts/credentials and can read system/server status.
 */
const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, adminOnly);

const ENV_PATH = path.join(__dirname, '..', '.env');

// Parse backend/.env into a plain object (best-effort)
function readEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  } catch { /* no .env */ }
  return out;
}

// Update or append a single KEY=value in backend/.env
function writeEnvKey(key, value) {
  let text = '';
  try { text = fs.readFileSync(ENV_PATH, 'utf8'); } catch { /* create new */ }
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else text = text.replace(/\s*$/, '') + `\n${key}=${value}\n`;
  fs.writeFileSync(ENV_PATH, text);
}

// Is a TCP port free on this host?
function portAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

const pkg = (() => { try { return require('../package.json'); } catch { return { version: '1.0.0' }; } })();

// ---------------- Users & credentials ----------------
router.get('/users', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.username, u.role, u.active, u.must_change_pw, u.employee_id,
            e.first_name, e.last_name, e.emp_no
     FROM users u LEFT JOIN employees e ON e.id = u.employee_id
     ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'nurse' THEN 1 ELSE 2 END, u.username`
  );
  res.json(rows);
});

// Create a STAFF account (admin or nurse). Portal accounts are made from an employee profile.
router.post('/users', async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.username) return res.status(400).json({ error: 'Name and username required' });
  const role = b.role === 'admin' ? 'admin' : 'nurse';
  const username = String(b.username).toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (await db.get('SELECT id FROM users WHERE username = ?', [username])) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const password = b.password && b.password.length >= 6 ? b.password : Math.random().toString(36).slice(2, 10);
  await db.run(
    'INSERT INTO users (name, username, password_hash, role, must_change_pw, active) VALUES (?, ?, ?, ?, 1, 1)',
    [b.name, username, bcrypt.hashSync(password, 10), role]
  );
  res.status(201).json({ username, password, role, note: 'User must change password at first login.' });
});

router.put('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const target = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const b = req.body || {};
  const updates = {};
  if (b.name) updates.name = b.name;
  if (b.active !== undefined) {
    // Don't allow disabling yourself or the last active admin
    if (Number(b.active) === 0 && id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account' });
    updates.active = b.active ? 1 : 0;
  }
  if (b.role && ['admin', 'nurse'].includes(b.role) && !target.employee_id) {
    if (target.role === 'admin' && b.role !== 'admin') {
      const admins = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1")).n;
      if (admins <= 1) return res.status(400).json({ error: 'At least one admin must remain' });
    }
    updates.role = b.role;
  }
  const cols = Object.keys(updates);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  await db.run(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => updates[c]), id]);
  res.json({ ok: true });
});

router.post('/users/:id/reset', async (req, res) => {
  const u = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const password = (req.body && req.body.password && req.body.password.length >= 6) ? req.body.password : Math.random().toString(36).slice(2, 10);
  await db.run('UPDATE users SET password_hash = ?, must_change_pw = 1, active = 1 WHERE id = ?', [bcrypt.hashSync(password, 10), req.params.id]);
  res.json({ password, note: 'New temporary password. User must change it at next login.' });
});

router.delete('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  const target = await db.get('SELECT role FROM users WHERE id = ?', [id]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') {
    const admins = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role='admin'")).n;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  }
  await db.run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
});

// ---------------- System / server status (troubleshooting) ----------------
router.get('/status', async (req, res) => {
  const checks = [];
  let dbOk = true;
  let counts = {};
  try {
    counts.employees = (await db.get('SELECT COUNT(*) AS n FROM employees')).n;
    counts.users = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
    counts.ape = (await db.get('SELECT COUNT(*) AS n FROM ape_records')).n;
    counts.visits = (await db.get('SELECT COUNT(*) AS n FROM clinic_visits')).n;
    counts.messages = (await db.get('SELECT COUNT(*) AS n FROM messages')).n;
  } catch (e) { dbOk = false; checks.push({ name: 'Database query', ok: false, detail: e.message }); }

  checks.push({ name: 'API server', ok: true, detail: 'responding' });
  checks.push({ name: `Database (${db.engine})`, ok: dbOk, detail: dbOk ? 'connected' : 'error' });
  const adminCount = dbOk ? (await db.get("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1")).n : 0;
  checks.push({ name: 'Active admin accounts', ok: adminCount >= 1, detail: String(adminCount) });

  const mem = process.memoryUsage();
  res.json({
    app: { name: 'HR Nurse System', version: pkg.version, env: process.env.NODE_ENV || 'development' },
    server: {
      node: process.version,
      platform: `${os.type()} ${os.release()} (${process.arch})`,
      hostname: os.hostname(),
      uptime_seconds: Math.round(process.uptime()),
      load_avg: os.loadavg().map((n) => Math.round(n * 100) / 100),
      mem_used_mb: Math.round(mem.rss / 1048576),
      mem_total_mb: Math.round(os.totalmem() / 1048576),
      mem_free_mb: Math.round(os.freemem() / 1048576),
      cpus: os.cpus().length,
    },
    database: { engine: db.engine, ok: dbOk, counts },
    checks,
    healthy: dbOk && adminCount >= 1,
    ts: new Date().toISOString(),
  });
});

// ---------------- Server configuration (port) ----------------
router.get('/config', async (req, res) => {
  const env = readEnv();
  res.json({
    running_port: parseInt(process.env.PORT || '3000', 10),
    configured_port: parseInt(env.PORT || process.env.PORT || '3000', 10),
    node_env: env.NODE_ENV || process.env.NODE_ENV || 'development',
    db_engine: db.engine,
    env_path: ENV_PATH,
    restart_needed: parseInt(env.PORT || '3000', 10) !== parseInt(process.env.PORT || '3000', 10),
  });
});

router.get('/check-port', async (req, res) => {
  const port = parseInt(req.query.port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'Port must be 1–65535' });
  const running = parseInt(process.env.PORT || '3000', 10);
  // The port we are currently listening on counts as "in use by this app"
  const available = port === running ? false : await portAvailable(port);
  res.json({ port, available, note: port === running ? 'This is the port the app is currently using.' : (available ? 'Free' : 'In use by another program') });
});

router.put('/config', async (req, res) => {
  const port = parseInt((req.body || {}).port, 10);
  if (!port || port < 1 || port > 65535) return res.status(400).json({ error: 'Port must be 1–65535' });
  const running = parseInt(process.env.PORT || '3000', 10);
  if (port !== running) {
    const free = await portAvailable(port);
    if (!free) return res.status(409).json({ error: `Port ${port} is already in use by another program` });
  }
  try {
    writeEnvKey('PORT', String(port));
  } catch (e) {
    return res.status(500).json({ error: 'Could not write .env: ' + e.message });
  }
  res.json({ ok: true, port, restart_needed: port !== running, note: 'Saved. Restart the app to apply: systemctl restart hr-nurse (server) or stop & npm start (workstation).' });
});

// ---------------- Troubleshooting: error log ----------------
router.get('/logs', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const level = req.query.level;
  const where = level ? ' WHERE l.level = ?' : '';
  const params = level ? [level] : [];
  const { rows } = await db.query(
    `SELECT l.*, u.username FROM error_log l LEFT JOIN users u ON u.id = l.user_id${where}
     ORDER BY l.id DESC LIMIT ${limit}`, params);
  const summary = (await db.query('SELECT level, COUNT(*) AS n FROM error_log GROUP BY level')).rows;
  res.json({ rows, summary });
});

router.delete('/logs', async (req, res) => {
  await db.run('DELETE FROM error_log', []);
  res.json({ ok: true });
});

// Mark an error resolved / add a resolution note
router.put('/logs/:id', async (req, res) => {
  const b = req.body || {};
  const cols = [];
  const params = [];
  if (b.resolved !== undefined) { cols.push('resolved = ?'); params.push(b.resolved ? 1 : 0); }
  if (b.resolution_note !== undefined) { cols.push('resolution_note = ?'); params.push(b.resolution_note); }
  if (!cols.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  await db.run(`UPDATE error_log SET ${cols.join(', ')} WHERE id = ?`, params);
  res.json({ ok: true });
});

// ---------------- Data export / import (all linked records) ----------------
const EXPORT_TABLES = [
  'employees', 'ape_records', 'newhire_clearances', 'newhire_items',
  'clinic_visits', 'medications', 'med_dispense', 'messages', 'message_recipients',
  'requirement_templates', 'lookups', 'settings', 'sms_log', 'attachments',
];

// Full JSON backup of every table (restorable)
router.get('/export', async (req, res) => {
  const dump = { meta: { app: 'HR Nurse System', version: pkg.version, engine: db.engine, exported_at: new Date().toISOString() }, tables: {} };
  for (const t of EXPORT_TABLES) {
    try { dump.tables[t] = (await db.query(`SELECT * FROM ${t}`)).rows; } catch { dump.tables[t] = []; }
  }
  res.setHeader('Content-Disposition', `attachment; filename="hrnurse-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
});

// Per-module CSV export
router.get('/export/:table.csv', async (req, res) => {
  const t = req.params.table;
  if (!EXPORT_TABLES.includes(t)) return res.status(400).json({ error: 'Unknown table' });
  const { rows } = await db.query(`SELECT * FROM ${t}`);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${t}.csv"`);
  res.send(csv);
});

// Restore from a JSON backup produced by /export.
// mode "merge" (default) inserts rows; "replace" wipes each table first.
router.post('/import', async (req, res) => {
  const body = req.body || {};
  const tables = body.tables;
  if (!tables || typeof tables !== 'object') return res.status(400).json({ error: 'Invalid backup file (no tables)' });
  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  const summary = {};
  // Insert in dependency-safe order (parents first)
  const order = EXPORT_TABLES.filter((t) => tables[t]);
  try {
    if (mode === 'replace') {
      for (const t of [...order].reverse()) { try { await db.run(`DELETE FROM ${t}`); } catch { /* ignore */ } }
    }
    for (const t of order) {
      let n = 0;
      for (const row of tables[t]) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        try {
          await db.run(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
          n++;
        } catch { /* skip conflicting row */ }
      }
      summary[t] = n;
    }
    res.json({ ok: true, mode, imported: summary });
  } catch (e) {
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

module.exports = router;
