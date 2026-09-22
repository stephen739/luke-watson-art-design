const square = require('../lib/square');
const { sendEmail, configured: emailConfigured } = require('../lib/email');
const { readLiveContent, writeLiveContent } = require('../lib/github');
const { HttpError, priceCart, validateShipping, isEmail, makeDownloadToken } = require('../lib/checkout');

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function orderEmailHtml({ lines, subtotalCents, shippingCents, totalCents, fulfillment, shipping, buyerName, buyerEmail, forBuyer, downloads }) {
  const rows = lines
    .map((l) => `<tr><td>${l.title} — ${l.optionLabel}${l.option === 'print' ? ` × ${l.qty}` : ''}</td><td style="text-align:right">${money(l.lineCents)}</td></tr>`)
    .join('');
  const fulfillmentHtml = fulfillment
    ? fulfillment === 'shipping'
      ? `<p><strong>Shipping</strong> (+$10)<br>${shipping.name}<br>${shipping.line1}${shipping.line2 ? '<br>' + shipping.line2 : ''}<br>${shipping.city}, ${shipping.state} ${shipping.zip}<br>${shipping.phone}</p>`
      : `<p><strong>Local pickup</strong> — Lubbock, TX. ${forBuyer ? "Luke will follow up with pickup details." : 'Follow up with the buyer for pickup details.'}</p>`
    : '';
  const downloadsHtml =
    forBuyer && downloads?.length
      ? `<p><strong>Your digital download${downloads.length > 1 ? 's' : ''}:</strong><br>${downloads
          .map((d) => (d.url ? `<a href="${d.url}">${d.title}</a> (link expires in 30 minutes)` : `${d.title} — Luke will email this file to you directly.`))
          .join('<br>')}</p>`
      : '';
  return `
    <div style="font-family:sans-serif;color:#16150F;max-width:480px;">
      <h2 style="font-family:sans-serif;">${forBuyer ? 'Thanks for your order!' : 'New order on lukewatsonart'}</h2>
      <p>${forBuyer ? '' : `<strong>${buyerName}</strong> — ${buyerEmail}<br>`}</p>
      <table style="width:100%;border-collapse:collapse;">${rows}
        <tr><td style="padding-top:8px;">Subtotal</td><td style="text-align:right;padding-top:8px;">${money(subtotalCents)}</td></tr>
        ${shippingCents ? `<tr><td>Shipping</td><td style="text-align:right;">${money(shippingCents)}</td></tr>` : ''}
        <tr><td style="font-weight:bold;padding-top:6px;">Total</td><td style="text-align:right;font-weight:bold;padding-top:6px;">${money(totalCents)}</td></tr>
      </table>
      ${fulfillmentHtml}
      ${downloadsHtml}
    </div>`;
}

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

  const live = await readLiveContent();
  if (!live.ok) return res.status(502).json({ error: 'Could not load current pricing. Please try again.' });

  let priced;
  try {
    priced = priceCart(live.content.artworks, { items: body.items, fulfillment: body.fulfillment });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    return res.status(500).json({ error: 'Something went wrong pricing your order.' });
  }

  let shipping = null;
  if (priced.fulfillment === 'shipping') {
    try {
      shipping = validateShipping(body.shipping);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }

  const note = priced.lines.map((l) => `${l.title} (${l.optionLabel}${l.option === 'print' ? ` x${l.qty}` : ''})`).join(', ');
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

  const downloads = priced.lines
    .filter((l) => l.option === 'digital')
    .map((l) => ({
      artworkId: l.artworkId,
      title: l.title,
      url: l.artwork.digitalFile ? `/api/download?token=${encodeURIComponent(makeDownloadToken(l.artworkId))}` : null,
    }));

  if (emailConfigured()) {
    const shared = { lines: priced.lines, subtotalCents: priced.subtotalCents, shippingCents: priced.shippingCents, totalCents: priced.totalCents, fulfillment: priced.fulfillment, shipping, buyerName, buyerEmail, downloads };
    await Promise.all([
      sendEmail({ to: process.env.NOTIFY_EMAIL, subject: `New order — ${money(priced.totalCents)}`, html: orderEmailHtml({ ...shared, forBuyer: false }) }),
      sendEmail({ to: buyerEmail, subject: 'Your Luke Watson Art & Design order', html: orderEmailHtml({ ...shared, forBuyer: true }) }),
    ]);
  }

  res.status(200).json({ success: true, totalCents: priced.totalCents, downloads });
};
