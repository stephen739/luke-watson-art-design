// Sends transactional email through SMTP2GO or Resend, whichever API key is set.
// If both are set, SMTP2GO wins. Set EMAIL_FROM to an address on a domain verified with the provider.

const provider = () => (process.env.SMTP2GO_API_KEY ? 'smtp2go' : process.env.RESEND_API_KEY ? 'resend' : null);

function configured() {
  return Boolean(provider());
}

// Without a verified domain, Resend's shared address only delivers to the Resend account owner.
function fromAddress() {
  return process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'Luke Watson Art & Design <onboarding@resend.dev>';
}

async function viaSmtp2go({ to, subject, html, replyTo }) {
  const r = await fetch('https://api.smtp2go.com/v3/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Smtp2go-Api-Key': process.env.SMTP2GO_API_KEY },
    body: JSON.stringify({
      api_key: process.env.SMTP2GO_API_KEY,
      sender: fromAddress(),
      to: [to],
      subject,
      html_body: html,
      ...(replyTo ? { custom_headers: [{ header: 'Reply-To', value: replyTo }] } : {}),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || (data?.data?.failed ?? 0) > 0) {
    console.error('email: SMTP2GO rejected message', r.status, data?.data?.error || data?.data?.error_code || '');
    return { ok: false, status: r.status };
  }
  return { ok: true };
}

async function viaResend({ to, subject, html, replyTo }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress(), to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    console.error('email: Resend rejected message', r.status, detail?.message || '');
    return { ok: false, status: r.status };
  }
  return { ok: true };
}

async function sendEmail(message) {
  const p = provider();
  if (!p) return { ok: false, skipped: true };
  try {
    return p === 'smtp2go' ? await viaSmtp2go(message) : await viaResend(message);
  } catch (e) {
    console.error('email: send failed', e?.message);
    return { ok: false };
  }
}

module.exports = { configured, sendEmail };
