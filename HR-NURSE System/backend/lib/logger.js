/**
 * Persists errors to the error_log table for the admin Troubleshooting panel.
 * Logging must never throw — a failure here is swallowed after printing to stderr.
 */
const db = require('../db');

async function logError({ level = 'error', source = 'server', message = '', detail = '', route = '', userId = null } = {}) {
  try {
    await db.run(
      'INSERT INTO error_log (level, source, message, detail, route, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [
        level,
        source,
        String(message || '').slice(0, 500),
        detail ? String(detail).slice(0, 4000) : null,
        route ? String(route).slice(0, 200) : null,
        userId || null,
      ]
    );
  } catch (e) {
    console.error('[logger] could not persist error:', e.message);
  }
}

module.exports = { logError };
