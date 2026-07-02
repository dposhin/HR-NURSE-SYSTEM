/**
 * SMS delivery service with a pluggable provider.
 *
 * Provider is chosen by the SMS_PROVIDER env var:
 *   - "semaphore" : Semaphore (PH) — https://semaphore.co  (SMS_API_KEY, SMS_SENDER)
 *   - "twilio"    : Twilio         — SMS_API_KEY = "ACCOUNTSID:AUTHTOKEN", SMS_SENDER = from number
 *   - "generic"   : POST to SMS_API_URL with JSON { to, message, from } and Bearer SMS_API_KEY
 *   - anything else / unset : "simulate" — nothing is sent, the attempt is just recorded.
 *
 * Every send returns { status: 'sent'|'failed'|'simulated', detail } and is logged to sms_log.
 * Uses global fetch (Node 18+). No external dependencies.
 */

function config() {
  return {
    provider: (process.env.SMS_PROVIDER || '').toLowerCase(),
    apiKey: process.env.SMS_API_KEY || '',
    sender: process.env.SMS_SENDER || '',
    apiUrl: process.env.SMS_API_URL || '',
  };
}

function isConfigured() {
  const c = config();
  return !!(c.provider && c.apiKey && ['semaphore', 'twilio', 'generic'].includes(c.provider));
}

async function sendOne(to, message) {
  const c = config();
  if (!to) return { status: 'failed', detail: 'No phone number' };
  if (!isConfigured()) return { status: 'simulated', detail: `No SMS provider configured — would send to ${to}` };

  try {
    if (c.provider === 'semaphore') {
      const body = new URLSearchParams({ apikey: c.apiKey, number: to, message });
      if (c.sender) body.set('sendername', c.sender);
      const r = await fetch('https://api.semaphore.co/api/v4/messages', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const text = await r.text();
      return r.ok ? { status: 'sent', detail: text.slice(0, 300) } : { status: 'failed', detail: `HTTP ${r.status}: ${text.slice(0, 300)}` };
    }
    if (c.provider === 'twilio') {
      const [sid, token] = c.apiKey.split(':');
      const body = new URLSearchParams({ To: to, From: c.sender, Body: message });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
        body,
      });
      const text = await r.text();
      return r.ok ? { status: 'sent', detail: 'queued' } : { status: 'failed', detail: `HTTP ${r.status}: ${text.slice(0, 300)}` };
    }
    if (c.provider === 'generic') {
      if (!c.apiUrl) return { status: 'failed', detail: 'SMS_API_URL not set for generic provider' };
      const r = await fetch(c.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
        body: JSON.stringify({ to, message, from: c.sender }),
      });
      const text = await r.text();
      return r.ok ? { status: 'sent', detail: text.slice(0, 300) } : { status: 'failed', detail: `HTTP ${r.status}: ${text.slice(0, 300)}` };
    }
  } catch (e) {
    return { status: 'failed', detail: e.message };
  }
  return { status: 'simulated', detail: 'Unknown provider' };
}

module.exports = { sendOne, isConfigured, config };
