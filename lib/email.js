function configured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
}

// Resend's shared onboarding domain works with no setup; swap in a verified domain later
// by setting RESEND_FROM_EMAIL once one is configured in the Resend dashboard.
function fromAddress() {
  return process.env.RESEND_FROM_EMAIL || 'Luke Watson Art & Design <onboarding@resend.dev>';
}

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, skipped: true };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress(), to, subject, html }),
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

module.exports = { configured, sendEmail };
