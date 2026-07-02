/**
 * Document / record attachments (staff only).
 *
 * Files are stored on the local server filesystem under UPLOAD_DIR, organised as
 *   <UPLOAD_DIR>/<entity_type>/<entity_id>/<unique-filename>
 * so the whole tree can later be relocated to a mounted NAS / iSCSI volume simply
 * by pointing UPLOAD_DIR at the new mount (e.g. UPLOAD_DIR=/mnt/nas/hrnurse).
 *
 * Uploads are sent as base64 (or a data: URL) in JSON — no external deps required.
 * The DB stores only metadata + a relative path; the bytes live on disk.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authRequired, staffOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired, staffOnly);

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const ALLOWED_ENTITIES = ['ape', 'newhire', 'newhire_item', 'employee', 'clinic_visit'];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file

function safeName(name) {
  return String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
}

// List attachments for an entity
router.get('/', async (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });
  const { rows } = await db.query(
    `SELECT a.id, a.entity_type, a.entity_id, a.category, a.filename, a.mime, a.size, a.created_at, u.username AS uploaded_by
     FROM attachments a LEFT JOIN users u ON u.id = a.uploaded_by
     WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC`, [entity_type, entity_id]);
  res.json(rows);
});

// Upload one file (base64 / data URL)
router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!ALLOWED_ENTITIES.includes(b.entity_type)) return res.status(400).json({ error: 'Invalid entity_type' });
  if (!b.entity_id) return res.status(400).json({ error: 'entity_id required' });
  if (!b.data) return res.status(400).json({ error: 'No file data' });

  // Accept "data:<mime>;base64,XXXX" or raw base64
  let mime = b.mime || 'application/octet-stream';
  let base64 = b.data;
  const m = /^data:([^;]+);base64,(.*)$/s.exec(b.data);
  if (m) { mime = m[1]; base64 = m[2]; }
  let buf;
  try { buf = Buffer.from(base64, 'base64'); } catch { return res.status(400).json({ error: 'Bad file encoding' }); }
  if (!buf.length) return res.status(400).json({ error: 'Empty file' });
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: `File too large (max ${Math.round(MAX_BYTES / 1048576)} MB)` });

  const dir = path.join(UPLOAD_DIR, b.entity_type, String(parseInt(b.entity_id, 10)));
  fs.mkdirSync(dir, { recursive: true });
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName(b.filename)}`;
  const abs = path.join(dir, unique);
  fs.writeFileSync(abs, buf);
  const rel = path.relative(UPLOAD_DIR, abs);

  const r = await db.run(
    'INSERT INTO attachments (entity_type, entity_id, category, filename, mime, size, path, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [b.entity_type, parseInt(b.entity_id, 10), b.category || null, safeName(b.filename), mime, buf.length, rel, req.user.id]);
  res.status(201).json(await db.get('SELECT id, entity_type, entity_id, category, filename, mime, size, created_at FROM attachments WHERE id = ?', [r.lastId]));
});

// Download / view a file
router.get('/:id/download', async (req, res) => {
  const a = await db.get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const abs = path.join(UPLOAD_DIR, a.path);
  if (!abs.startsWith(path.resolve(UPLOAD_DIR))) return res.status(400).json({ error: 'Bad path' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  const disp = req.query.dl ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename="${a.filename}"`);
  fs.createReadStream(abs).pipe(res);
});

router.delete('/:id', async (req, res) => {
  const a = await db.get('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, a.path)); } catch { /* already gone */ }
  await db.run('DELETE FROM attachments WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
