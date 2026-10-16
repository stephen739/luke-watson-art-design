function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
}

// Until a domain is verified in Resend, the shared onboarding address only delivers to the
// Resend account owner's own email. Set RESEND_FROM_EMAIL once a domain is verified.
function fromAddress() {
  return process.env.RESEND_FROM_EMAIL || 'Luke Watson Art & Design <onboarding@resend.dev>';
}

async function sendEmail({ to, subject, html, replyTo }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, skipped: true };
  try {
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
  } catch (e) {
    console.error('email: send failed', e?.message);
    return { ok: false };
  }
}

module.exports = { configured, sendEmail };
