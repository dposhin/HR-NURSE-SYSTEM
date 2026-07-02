const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const STAFF_ROLES = ['admin', 'nurse'];
const PORTAL_ROLES = ['employee', 'applicant'];

function sign(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name, employee_id: user.employee_id || null },
    SECRET,
    { expiresIn: '12h' }
  );
}

function authRequired(req, res, next) {
  const token =
    (req.cookies && req.cookies.token) ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

// HR Nurse / admin: full management access
function staffOnly(req, res, next) {
  if (req.user && STAFF_ROLES.includes(req.user.role)) return next();
  return res.status(403).json({ error: 'Staff access required' });
}

// Employee / applicant: portal (own data only)
function portalOnly(req, res, next) {
  if (req.user && PORTAL_ROLES.includes(req.user.role) && req.user.employee_id) return next();
  return res.status(403).json({ error: 'Portal access required' });
}

module.exports = { sign, authRequired, adminOnly, staffOnly, portalOnly, STAFF_ROLES, PORTAL_ROLES, SECRET };
