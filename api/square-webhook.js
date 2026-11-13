// Square → website. Square calls this when the catalog or stock changes (e.g. Luke edits a price in the
// Square dashboard); we copy the new prices / sold status into content.json so the site and checkout agree.
// Register the URL for events "catalog.version.updated" and "inventory.count.updated" in Square's
// Developer Dashboard → Webhooks, and put that subscription's signature key in SQUARE_WEBHOOK_SIGNATURE_KEY.
const crypto = require('crypto');
const { pullFromSquare } = require('../lib/squareRun');

const EVENTS = new Set(['catalog.version.updated', 'inventory.count.updated']);

function notificationUrl() {
  return process.env.SQUARE_WEBHOOK_URL || `${(process.env.SITE_URL || 'https://lukewatsonart.com').replace(/\/$/, '')}/api/square-webhook`;
}

function validSignature(raw, header) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !header) return false;
  const expected = crypto.createHmac('sha256', key).update(notificationUrl() + raw).digest();
  const given = Buffer.from(String(header), 'base64');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// Needs the exact bytes Square signed, so Vercel's JSON body parsing is switched off for this route.
async function rawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body); // parser ran anyway; best effort
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY) return res.status(503).json({ error: 'Webhook signature key is not set.' });

  const raw = await rawBody(req);
  if (!validSignature(raw, req.headers['x-square-hmacsha256-signature'])) return res.status(401).json({ error: 'Bad signature' });

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  if (!EVENTS.has(event?.type)) return res.status(200).json({ ignored: event?.type || true });

  // A non-2xx makes Square retry later, which is what we want for a transient GitHub/Square failure.
  try {
    const r = await pullFromSquare();
    if (!r.ok) {
      console.error('square-webhook: sync failed:', r.message);
      return res.status(500).json({ error: r.message });
    }
    if (r.changed.length) console.log('square-webhook: applied', r.changed.join('; '));
    return res.status(200).json({ ok: true, changed: r.changed });
  } catch (e) {
    console.error('square-webhook: crashed:', e?.message);
    return res.status(500).json({ error: 'Sync failed' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports.validSignature = validSignature;
