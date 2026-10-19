const { esc } = require('./schema');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const INK = '#16150F';
const SOFT = '#514E42';
const LINE = '#E4E2DA';
const PAPER = '#F4F4F2';

function shell({ siteUrl, heading, intro, body, contactEmail }) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid ${LINE};font-family:Helvetica,Arial,sans-serif;color:${INK};">
        <tr><td style="padding:28px 28px 8px;">
          <img src="${esc(siteUrl)}/images/logo-full.png" alt="Luke Watson Art &amp; Design" width="220" style="display:block;border:0;height:auto;max-width:220px;">
        </td></tr>
        <tr><td style="padding:12px 28px 4px;">
          <h1 style="margin:0;font-size:24px;line-height:1.2;">${heading}</h1>
          ${intro ? `<p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:${SOFT};">${intro}</p>` : ''}
        </td></tr>
        ${body}
        <tr><td style="padding:20px 28px 28px;border-top:1px solid ${LINE};font-size:12px;color:${SOFT};">
          Luke Watson Art &amp; Design · Lubbock, TX<br>
          ${contactEmail ? `<a href="mailto:${esc(contactEmail)}" style="color:${SOFT};">${esc(contactEmail)}</a><br>` : ''}
          <a href="${esc(siteUrl)}" style="color:${SOFT};">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function section(html) {
  return `<tr><td style="padding:14px 28px;">${html}</td></tr>`;
}

function itemsTable({ lines, subtotalCents, shippingCents, taxCents, taxRatePercent, totalCents }) {
  const rows = lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;">
          <strong>${esc(l.title)}</strong><br>
          <span style="color:${SOFT};font-size:13px;">${esc(l.optionLabel)}${l.option === 'print' ? ` × ${l.qty}` : ''}</span>
        </td>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:right;vertical-align:top;">${money(l.lineCents)}</td>
      </tr>`
    )
    .join('');
  const extra = (label, value, bold) =>
    `<tr><td style="padding:6px 0;font-size:14px;${bold ? 'font-weight:bold;' : `color:${SOFT};`}">${label}</td><td style="padding:6px 0;font-size:14px;text-align:right;${bold ? 'font-weight:bold;' : `color:${SOFT};`}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
    ${extra('Subtotal', money(subtotalCents))}
    ${shippingCents ? extra('Shipping', money(shippingCents)) : ''}
    ${taxCents ? extra(`Sales tax (${taxRatePercent}%)`, money(taxCents)) : ''}
    ${extra('Total', money(totalCents), true)}
  </table>`;
}

const METHOD_LABEL = { email: 'Email', text: 'Text message', phone: 'Phone call' };

// Shown to buyers wherever digital downloads appear (emails, post-purchase popup, cart) so print colors aren't a surprise.
const CMYK_NOTE = (email) =>
  `Digital download files use the CMYK color profile instead of RGB. They will look different on your phone or computer screen than they will once printed — this is intentional, to keep your prints accurate and consistent in quality. If you have any questions or concerns, don’t hesitate to reach out${email ? ` at ${email}` : ''}.`;

function fulfillmentBlock({ fulfillment, shipping, pickup, forBuyer, delivery, contactEmail }) {
  if (!fulfillment) return '';
  if (fulfillment === 'shipping') {
    const addr = [shipping.name, shipping.line1, shipping.line2, `${shipping.city}, ${shipping.state} ${shipping.zip}`, shipping.phone]
      .filter(Boolean)
      .map(esc)
      .join('<br>');
    const when = !delivery
      ? ''
      : forBuyer
        ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;"><strong>Estimated delivery: by ${esc(delivery.deliverByLabel)}</strong><br>That’s ${esc(delivery.businessDays)} business days from your order date (${esc(delivery.orderLabel)}). If your order hasn’t arrived by then, please email Luke at <a href="mailto:${esc(contactEmail || '')}" style="color:${INK};">${esc(contactEmail || '')}</a>.</p>`
        : `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;"><strong>Promised delivery: by ${esc(delivery.deliverByLabel)}</strong><br>${esc(delivery.businessDays)} business days from the order date (${esc(delivery.orderLabel)}). The buyer was told to email you if it hasn’t arrived by then.</p>`;
    return section(`<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;">${forBuyer ? 'Shipping to' : 'Ship to'}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;">${addr}</p>${when}`);
  }
  const label = (pickup && METHOD_LABEL[pickup.contactMethod]) || '';
  const how = pickup
    ? forBuyer
      ? `Luke will coordinate pickup details with you directly. Preferred contact: <strong>${esc(label)}</strong> (${esc(pickup.phone)}).`
      : `<strong>Preferred contact: ${esc(label)}</strong><br>Phone: <a href="tel:${esc(pickup.phone)}" style="color:${INK};">${esc(pickup.phone)}</a><br>Coordinate pickup details directly with the buyer.`
    : 'Luke will coordinate pickup details directly.';
  return section(`<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;">Local pickup — Lubbock, TX</p>
    <p style="margin:0;font-size:14px;line-height:1.6;">${how}</p>`);
}

function downloadsBlock({ downloads, forBuyer, contactEmail }) {
  if (!downloads?.length) return '';
  const items = downloads
    .map((d) => {
      if (forBuyer) {
        return d.emailUrl
          ? `<a href="${esc(d.emailUrl)}" style="display:inline-block;margin:4px 0;padding:10px 18px;background:${INK};color:#ffffff;text-decoration:none;border-radius:999px;font-size:13px;font-weight:bold;">Download ${esc(d.title)}</a>`
          : `<span style="font-size:14px;">${esc(d.title)} — Luke will email this file to you directly.</span>`;
      }
      return `<span style="font-size:14px;">${esc(d.title)} — ${d.emailUrl ? 'download link sent to buyer' : 'NO FILE ON RECORD: email the file to the buyer manually'}</span>`;
    })
    .join('<br>');
  return section(`<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;">Digital download${downloads.length > 1 ? 's' : ''}</p>
    ${items}
    ${forBuyer ? `<p style="margin:10px 0 0;font-size:12px;color:${SOFT};">Download links work for 7 days. Need a new one? Just reply to this email.</p>
    <p style="margin:12px 0 0;font-size:13px;line-height:1.55;padding:10px 12px;background:${PAPER};border-radius:8px;"><strong>About your file’s colors:</strong> ${esc(CMYK_NOTE(contactEmail))}</p>` : ''}`);
}

function buyerEmail(order) {
  const { siteUrl, buyerName } = order;
  const first = esc(String(buyerName).split(' ')[0] || 'there');
  return {
    subject: 'Your Luke Watson Art & Design order',
    html: shell({
      siteUrl,
      heading: `Thank you, ${first}!`,
      intro: 'Your order is confirmed. Here’s a summary for your records.',
      body: section(itemsTable(order)) + fulfillmentBlock({ ...order, forBuyer: true }) + downloadsBlock({ ...order, forBuyer: true }),
      contactEmail: order.contactEmail,
    }),
  };
}

function lukeEmail(order) {
  const { siteUrl, buyerName, buyerEmail: email, totalCents, lines } = order;
  const summary = lines.map((l) => `${l.title} (${l.optionLabel}${l.option === 'print' ? ` ×${l.qty}` : ''})`).join(', ');
  return {
    subject: `New order: ${money(totalCents)} — ${summary}`.slice(0, 200),
    html: shell({
      siteUrl,
      heading: `New order: ${money(totalCents)}`,
      intro: `<strong>${esc(buyerName)}</strong> · <a href="mailto:${esc(email)}" style="color:${INK};">${esc(email)}</a>`,
      body: section(itemsTable(order)) + fulfillmentBlock({ ...order, forBuyer: false }) + downloadsBlock({ ...order, forBuyer: false }),
    }),
  };
}

function inquiryEmail({ siteUrl, name, phone, email, reason, source, message }) {
  const row = (label, value) => `<tr><td style="padding:6px 12px 6px 0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;vertical-align:top;white-space:nowrap;">${label}</td><td style="padding:6px 0;font-size:14px;">${value}</td></tr>`;
  const details = `<table role="presentation" cellpadding="0" cellspacing="0">
    ${row('Name', esc(name))}
    ${row('Email', `<a href="mailto:${esc(email)}" style="color:${INK};">${esc(email)}</a>`)}
    ${phone ? row('Phone', `<a href="tel:${esc(phone)}" style="color:${INK};">${esc(phone)}</a>`) : ''}
    ${row('Topic', esc(reason))}
    ${row('Heard via', esc(source))}
  </table>`;
  const msg = message
    ? section(`<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;">Message</p>
        <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(message)}</p>`)
    : '';
  return {
    subject: `Website inquiry: ${reason} — ${name}`.slice(0, 200),
    html: shell({ siteUrl, heading: 'New website inquiry', intro: 'Reply to this email to respond directly to them.', body: section(details) + msg }),
  };
}

module.exports = { CMYK_NOTE, buyerEmail, lukeEmail, inquiryEmail };
