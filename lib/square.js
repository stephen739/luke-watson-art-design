const crypto = require('crypto');

function configured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function apiBase() {
  return process.env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

// Charges a card nonce (from the Web Payments SDK) for the given amount. Amount must already be
// the server-computed total in cents — never a value the client sent.
async function createPayment({ nonce, amountCents, buyerEmail, note }) {
  const r = await fetch(`${apiBase()}/v2/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': '2025-01-23',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      source_id: nonce,
      idempotency_key: crypto.randomUUID(),
      amount_money: { amount: amountCents, currency: 'USD' },
      location_id: process.env.SQUARE_LOCATION_ID,
      buyer_email_address: buyerEmail,
      note: note.slice(0, 500),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.errors?.[0]?.detail || 'The card was declined.';
    return { ok: false, status: r.status, message: detail };
  }
  return { ok: true, payment: data.payment };
}

module.exports = { configured, createPayment };
