const crypto = require('crypto');

const SQUARE_VERSION = '2025-01-23';

function configured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function apiBase() {
  return process.env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

// One thin wrapper over Square's REST API. Never throws on an HTTP error — callers get
// { ok, status, data, message } so a Square hiccup can't take down a save or a sale.
async function request(method, path, body) {
  let r;
  try {
    r = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, data: {}, message: 'Square could not be reached.' };
  }
  const data = await r.json().catch(() => ({}));
  const message = r.ok ? '' : data?.errors?.[0]?.detail || data?.errors?.[0]?.code || `Square returned ${r.status}.`;
  return { ok: r.ok, status: r.status, data, message };
}

// Charges a card nonce (from the Web Payments SDK) for the given amount. Amount must already be
// the server-computed total in cents — never a value the client sent. When `orderId` is given the
// payment settles that Square order (whose total must equal amountCents).
async function createPayment({ nonce, amountCents, buyerEmail, note, orderId, referenceId }) {
  const r = await request('POST', '/v2/payments', {
    source_id: nonce,
    idempotency_key: crypto.randomUUID(),
    amount_money: { amount: amountCents, currency: 'USD' },
    location_id: process.env.SQUARE_LOCATION_ID,
    buyer_email_address: buyerEmail,
    note: note.slice(0, 500),
    ...(orderId ? { order_id: orderId } : {}),
    ...(referenceId ? { reference_id: referenceId } : {}),
  });
  if (!r.ok) {
    const detail = r.data?.errors?.[0]?.detail || 'The card was declined.';
    return { ok: false, status: r.status, message: detail };
  }
  return { ok: true, payment: r.data.payment };
}

module.exports = { configured, request, createPayment, apiBase, SQUARE_VERSION };
