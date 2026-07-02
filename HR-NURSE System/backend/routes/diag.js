/**
 * Diagnostics intake — any logged-in user (staff or portal) can report a
 * client-side error, which lands in the admin Troubleshooting panel.
 */
const express = require('express');
const { authRequired } = require('../middleware/auth');
const { logError } = require('../lib/logger');

const router = express.Router();

router.post('/log', authRequired, async (req, res) => {
  const b = req.body || {};
  await logError({
    level: b.level === 'warn' ? 'warn' : 'error',
    source: 'client',
    message: b.message || 'Client error',
    detail: b.detail || '',
    route: b.route || '',
    userId: req.user.id,
  });
  res.json({ ok: true });
});

module.exports = router;
