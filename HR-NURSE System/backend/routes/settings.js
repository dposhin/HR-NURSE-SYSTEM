/**
 * System settings — branding & theme. Public keys are readable without auth so the
 * login page can theme itself; writing requires an admin.
 */
const express = require('express');
const db = require('../db');
const { authRequired, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Keys safe to expose publicly (used to theme the login screen + app shell)
const PUBLIC_KEYS = ['system_name', 'tagline', 'logo_emoji', 'logo_image', 'color_primary', 'color_accent', 'color_sidebar',
  'note_ape', 'note_newhire', 'note_clinic'];

const DEFAULTS = {
  system_name: 'HR Nurse System',
  tagline: 'Employee Occupational Health Management',
  logo_emoji: '＋',
  logo_image: '', // data-URL of an uploaded logo; overrides logo_emoji when set
  color_primary: '#1a7f6b',
  color_accent: '#2563eb',
  color_sidebar: '#0f2b27',
  // Editable helper notes shown on the forms (admin can change these)
  note_ape: 'BMI is auto-computed from height & weight. For annual exams, next-due defaults to +1 year.',
  note_newhire: 'The standard requirement checklist (Neuro, Chest X-ray, Drug test, CBC, etc.) is added automatically. Configure it via "Manage Requirements".',
  note_clinic: 'Record the encounter and any medicine dispensed. Set a follow-up date to trigger a reminder.',
};

async function readAll() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// Public branding (no auth)
router.get('/public', async (req, res) => {
  const all = await readAll();
  const out = {};
  for (const k of PUBLIC_KEYS) out[k] = all[k];
  res.json(out);
});

// Full settings (admin)
router.get('/', authRequired, adminOnly, async (req, res) => {
  res.json(await readAll());
});

// Update settings (admin). Body is a flat { key: value } object.
router.put('/', authRequired, adminOnly, async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to update' });
  for (const k of keys) {
    const v = body[k] == null ? '' : String(body[k]);
    // upsert that works on both SQLite and Postgres
    const existing = await db.get('SELECT key FROM settings WHERE key = ?', [k]);
    if (existing) await db.run('UPDATE settings SET value = ? WHERE key = ?', [v, k]);
    else await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }
  res.json(await readAll());
});

// Reset branding to defaults (admin)
router.post('/reset', authRequired, adminOnly, async (req, res) => {
  for (const k of Object.keys(DEFAULTS)) await db.run('DELETE FROM settings WHERE key = ?', [k]);
  res.json(await readAll());
});

module.exports = { router, readAll, DEFAULTS };
