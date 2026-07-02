require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '25mb' })); // headroom for logo, bulk import, and document/scan uploads
app.use(cookieParser());

// Throttle auth endpoints
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/ape', require('./routes/ape'));
app.use('/api/newhire', require('./routes/newhire'));
app.use('/api/clinic', require('./routes/clinic'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/portal', require('./routes/portal'));
app.use('/api/settings', require('./routes/settings').router);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/diag', require('./routes/diag'));
app.use('/api/lookups', require('./routes/lookups'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/files', require('./routes/files'));

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

const { logError } = require('./lib/logger');

app.use((err, req, res, next) => {
  console.error(err);
  logError({
    source: 'server', level: 'error',
    message: err.message || 'Unhandled error',
    detail: err.stack, route: `${req.method} ${req.originalUrl}`,
    userId: req.user && req.user.id,
  });
  res.status(500).json({ error: 'Server error' });
});

// Capture crashes so they show up in the Troubleshooting panel
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  logError({ level: 'critical', source: 'server', message: 'Unhandled promise rejection', detail: String(reason && reason.stack || reason) });
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logError({ level: 'critical', source: 'server', message: err.message, detail: err.stack });
});

// Serve HTTPS when a certificate + key are configured (SSL_CERT / SSL_KEY), else HTTP.
let server;
const SSL_CERT = process.env.SSL_CERT;
const SSL_KEY = process.env.SSL_KEY;
if (SSL_CERT && SSL_KEY && fs.existsSync(SSL_CERT) && fs.existsSync(SSL_KEY)) {
  try {
    const https = require('https');
    server = https.createServer(
      { cert: fs.readFileSync(SSL_CERT), key: fs.readFileSync(SSL_KEY) },
      app
    ).listen(PORT, () => console.log(`HR Nurse System running on https://localhost:${PORT} (TLS enabled)`));
  } catch (e) {
    console.error('TLS setup failed, falling back to HTTP:', e.message);
    logError({ level: 'critical', source: 'server', message: 'TLS setup failed', detail: e.stack });
    server = app.listen(PORT, () => console.log(`HR Nurse System running on http://localhost:${PORT}`));
  }
} else {
  server = app.listen(PORT, () => console.log(`HR Nurse System running on http://localhost:${PORT}`));
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✘ Port ${PORT} is already in use by another program.`);
    console.error('  Fix: choose a different port, then restart. Options:');
    console.error(`    • Edit backend/.env  ->  PORT=8080  (any free port)`);
    console.error('    • Or set it inline:  PORT=8080 npm start');
    console.error('    • Or in the app:     Control Panel > System > Server Configuration');
    console.error(`  To see what is using port ${PORT}:  (Linux) sudo lsof -i :${PORT}   (Windows) netstat -ano | findstr :${PORT}\n`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  logError({ level: 'critical', source: 'server', message: `Listen error: ${err.code || err.message}`, detail: err.stack });
  process.exit(1);
});
