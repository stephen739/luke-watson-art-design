const square = require('../lib/square');
const { sendEmail, configured: emailConfigured } = require('../lib/email');
const { contactEmail } = require('../lib/recipient');
const { readLiveContent, writeLiveContent } = require('../lib/github');
const { HttpError, priceCart, validateShipping, validatePickup, isEmail, makeDownloadToken, EMAIL_DOWNLOAD_TTL_MS } = require('../lib/checkout');
const { buyerEmail: buildBuyerEmail, lukeEmail: buildLukeEmail } = require('../lib/orderEmail');


module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!square.configured()) {
    return res.status(503).json({ error: 'Checkout is not set up yet. Square credentials must be added in Vercel.' });
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    return res.status(415).json({ error: 'Expected JSON' });
  }

  const body = req.body || {};
  const buyerName = String(body.buyerName ?? '').trim().slice(0, 120);
  const buyerEmail = String(body.buyerEmail ?? '').trim();
  if (!buyerName) return res.status(400).json({ error: 'Please enter your name.' });
  if (!isEmail(buyerEmail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (typeof body.nonce !== 'string' || !body.nonce) return res.status(400).json({ error: 'Missing card details.' });

  if (!process.env.GITHUB_TOKEN) {
    console.error('checkout: GITHUB_TOKEN is not set');
    return res.status(503).json({ error: 'Checkout is missing its GITHUB_TOKEN setting in Vercel.' });
  }
  const live = await readLiveContent();
  if (!live.ok) {
    console.error('checkout: could not read content.json from GitHub, status', live.status);
    return res.status(502).json({ error: `Could not load current pricing (GitHub ${live.status || 'unreachable'}). Please try again.` });
  }

  let priced;
  try {
    priced = priceCart(live.content.artworks, { items: body.items, fulfillment: body.fulfillment, shippingState: body.shipping?.state, taxRatePercent: live.content.text.sales_tax_rate });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: 'Something went wrong pricing your order.' });
  }

  let shipping = null;
  let pickup = null;
  try {
    if (priced.fulfillment === 'shipping') shipping = validateShipping(body.shipping);
    if (priced.fulfillment === 'pickup') pickup = validatePickup(body.pickup);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const note = priced.lines.map((l) => `${l.title} (${l.optionLabel}${l.option === 'print' ? ` x${l.qty}` : ''})`).join(', ') + (priced.taxCents ? ` | tax ${(priced.taxCents / 100).toFixed(2)}` : '');
  const payment = await square.createPayment({ nonce: body.nonce, amountCents: priced.totalCents, buyerEmail, note });
  if (!payment.ok) return res.status(402).json({ error: payment.message || 'The card was declined.' });

  // Mark any one-of-one canvases sold. Best-effort with one retry against a fresh copy — if this
  // still fails, the payment already succeeded, so we log rather than tell the buyer it failed.
  const soldIds = priced.lines.filter((l) => l.option === 'canvas').map((l) => l.artworkId);
  if (soldIds.length) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = attempt === 0 ? live : await readLiveContent();
      if (!fresh.ok) break;
      const updated = { ...fresh.content, artworks: fresh.content.artworks.map((a) => (soldIds.includes(a.id) ? { ...a, sold: true } : a)) };
      const result = await writeLiveContent(updated, fresh.sha, `Checkout: mark ${soldIds.join(', ')} sold [skip ci]`);
      if (result.status === 200) break;
    }
  }

  const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const downloads = priced.lines
    .filter((l) => l.option === 'digital')
    .map((l) => {
      const hasFile = Boolean(l.artwork.digitalFile);
      return {
        artworkId: l.artworkId,
        title: l.title,
        url: hasFile ? `/api/download?token=${encodeURIComponent(makeDownloadToken(l.artworkId))}` : null,
        emailUrl: hasFile ? `${siteUrl}/api/download?token=${encodeURIComponent(makeDownloadToken(l.artworkId, EMAIL_DOWNLOAD_TTL_MS))}` : null,
      };
    });

  if (emailConfigured()) {
    const luke = contactEmail(live.content);
    const order = { siteUrl, contactEmail: luke, lines: priced.lines, subtotalCents: priced.subtotalCents, shippingCents: priced.shippingCents, taxCents: priced.taxCents, taxRatePercent: priced.taxRatePercent, totalCents: priced.totalCents, fulfillment: priced.fulfillment, shipping, pickup, buyerName, buyerEmail: buyerEmail, downloads };
    const toBuyer = buildBuyerEmail(order);
    const toLuke = buildLukeEmail(order);
    await Promise.all([
      sendEmail({ to: luke, subject: toLuke.subject, html: toLuke.html, replyTo: buyerEmail }),
      sendEmail({ to: buyerEmail, subject: toBuyer.subject, html: toBuyer.html, replyTo: luke }),
    ]);
  } else {
    console.error('checkout: order completed but email is not configured (SMTP2GO_API_KEY / RESEND_API_KEY)');
  }

  res.status(200).json({ success: true, totalCents: priced.totalCents, downloads: downloads.map(({ artworkId, title, url }) => ({ artworkId, title, url })) });
};
