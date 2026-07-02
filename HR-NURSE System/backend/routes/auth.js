const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign, authRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = await db.get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = sign(user);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({
    token,
    user: {
      id: user.id, name: user.name, username: user.username, role: user.role,
      employee_id: user.employee_id || null, must_change_pw: !!user.must_change_pw,
    },
  });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', authRequired, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(current || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await db.run('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?', [bcrypt.hashSync(next, 10), req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
