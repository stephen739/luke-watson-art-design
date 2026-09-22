const crypto = require('crypto');

const OPTIONS = ['canvas', 'print', 'digital'];
const SHIPPING_CENTS = 1000; // flat $10 shipping surcharge, once per order
const MAX_QTY = 10;
const MAX_LINES = 20;
const DOWNLOAD_TTL_MS = 30 * 60 * 1000; // 30 minutes to start a download after paying

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function centsFromPriceString(s) {
  const n = Math.round(Number(String(s).replace(/[^0-9.]/g, '')) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findArtwork(artworks, artworkId) {
  return artworks.find((a) => a.id === artworkId) || null;
}

// Re-derives every line's price from the live artwork list — the client's cart only ever
// supplies artworkId/option/qty; amounts it sends along for display are never trusted here.
function priceLine(artworks, { artworkId, option, qty }) {
  const artwork = findArtwork(artworks, artworkId);
  if (!artwork) throw new HttpError(404, 'One of the items in your cart could not be found.');
  if (!OPTIONS.includes(option)) throw new HttpError(400, 'Invalid purchase option.');
  if (option === 'canvas' && artwork.sold) throw new HttpError(409, `Sorry — the original "${artwork.title}" just sold.`);

  const priceField = { canvas: 'canvasPrice', print: 'printPrice', digital: 'digitalPrice' }[option];
  const unitCents = centsFromPriceString(artwork[priceField]);
  if (!unitCents) throw new HttpError(500, `"${artwork.title}" is not priced correctly yet.`);

  const isPhysical = option === 'canvas' || option === 'print';
  const q = option === 'print' ? Math.min(MAX_QTY, Math.max(1, Math.round(Number(qty) || 1))) : 1;
  const optionLabel = { canvas: 'Original Canvas', print: 'Print', digital: 'Digital Download' }[option];

  return { artwork, artworkId: artwork.id, title: artwork.title, option, optionLabel, qty: q, unitCents, lineCents: unitCents * q, isPhysical };
}

// Prices a whole cart in one pass. `fulfillment` only matters when at least one physical item
// is present; digital-only carts skip shipping entirely.
function priceCart(artworks, { items, fulfillment }) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Your cart is empty.');
  if (items.length > MAX_LINES) throw new HttpError(400, 'Too many items in one order.');

  const lines = items.map((item) => priceLine(artworks, item));
  const hasPhysical = lines.some((l) => l.isPhysical);

  let shippingCents = 0;
  let cleanFulfillment = null;
  if (hasPhysical) {
    if (fulfillment !== 'pickup' && fulfillment !== 'shipping') {
      throw new HttpError(400, 'Choose local pickup or shipping.');
    }
    cleanFulfillment = fulfillment;
    if (fulfillment === 'shipping') shippingCents = SHIPPING_CENTS;
  }

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineCents, 0);
  const totalCents = subtotalCents + shippingCents;
  return { lines, hasPhysical, fulfillment: cleanFulfillment, subtotalCents, shippingCents, totalCents };
}

function cleanShort(v, max) {
  const s = String(v ?? '').trim();
  return s.slice(0, max);
}

function validateShipping(shipping) {
  const s = shipping || {};
  const out = {
    name: cleanShort(s.name, 120),
    line1: cleanShort(s.line1, 200),
    line2: cleanShort(s.line2, 200),
    city: cleanShort(s.city, 100),
    state: cleanShort(s.state, 60),
    zip: cleanShort(s.zip, 20),
    phone: cleanShort(s.phone, 40),
  };
  if (!out.name || !out.line1 || !out.city || !out.state || !out.zip || !out.phone) {
    throw new HttpError(400, 'Please fill in the full shipping address and phone number.');
  }
  return out;
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200;
}

// Signs a short-lived download grant so a paid file can't just be guessed/shared as a public URL.
function signingKey() {
  return crypto.createHash('sha256').update(`lw-download|${process.env.SQUARE_ACCESS_TOKEN}`).digest();
}

function makeDownloadToken(artworkId) {
  const body = Buffer.from(JSON.stringify({ artworkId, exp: Date.now() + DOWNLOAD_TTL_MS })).toString('base64url');
  const mac = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyDownloadToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

module.exports = {
  HttpError,
  OPTIONS,
  MAX_QTY,
  SHIPPING_CENTS,
  priceCart,
  validateShipping,
  isEmail,
  makeDownloadToken,
  verifyDownloadToken,
};
