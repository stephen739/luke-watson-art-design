const { esc } = require('./schema');

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

const INK = '#16150F';
const SOFT = '#514E42';
const LINE = '#E4E2DA';
const PAPER = '#F4F4F2';

function shell({ siteUrl, heading, intro, body }) {
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

function fulfillmentBlock({ fulfillment, shipping, forBuyer }) {
  if (!fulfillment) return '';
  if (fulfillment === 'shipping') {
    const addr = [shipping.name, shipping.line1, shipping.line2, `${shipping.city}, ${shipping.state} ${shipping.zip}`, shipping.phone]
      .filter(Boolean)
      .map(esc)
      .join('<br>');
    return section(`<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;">${forBuyer ? 'Shipping to' : 'Ship to'}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;">${addr}</p>`);
  }
  return section(`<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};font-weight:bold;">Local pickup</p>
    <p style="margin:0;font-size:14px;line-height:1.6;">Lubbock, TX — ${forBuyer ? 'Luke will be in touch with pickup details.' : 'follow up with the buyer to arrange pickup details.'}</p>`);
}

function downloadsBlock({ downloads, forBuyer }) {
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
    ${forBuyer ? `<p style="margin:10px 0 0;font-size:12px;color:${SOFT};">Download links work for 7 days. Need a new one? Just reply to this email.</p>` : ''}`);
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

module.exports = { buyerEmail, lukeEmail };
