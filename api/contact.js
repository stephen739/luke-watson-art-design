const { sendEmail, configured: emailConfigured } = require('../lib/email');
const { inquiryEmail } = require('../lib/orderEmail');
const { isEmail } = require('../lib/checkout');

const REASONS = ['General Contact', 'Order Information', 'Book Luke or Collaborate'];
const SOURCES = ['Social Media', 'Art Show', 'Online', 'Word of Mouth'];

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked' });
  if (!String(req.headers['content-type'] || '').includes('application/json')) return res.status(415).json({ error: 'Expected JSON' });

  const body = req.body || {};

  // Honeypot: real visitors never see or fill this field. Pretend success so bots move on.
  if (clean(body.website, 200)) return res.status(200).json({ success: true });

  const to = process.env.CONTACT_FORM_EMAIL || process.env.NOTIFY_EMAIL;
  if (!emailConfigured() || !to) {
    console.error('contact: email is not configured (SMTP2GO_API_KEY/RESEND_API_KEY and CONTACT_FORM_EMAIL)');
    return res.status(503).json({ error: 'The contact form is not available right now. Please message Luke on Instagram instead.' });
  }

  const data = {
    name: clean(body.name, 120),
    phone: clean(body.phone, 40),
    email: clean(body.email, 200),
    reason: clean(body.reason, 60),
    source: clean(body.source, 60),
    message: String(body.message ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 3000),
  };
  if (!data.name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!isEmail(data.email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!REASONS.includes(data.reason)) return res.status(400).json({ error: 'Please choose how Luke can help you.' });
  if (!SOURCES.includes(data.source)) return res.status(400).json({ error: 'Please tell us how you heard about Luke.' });

  const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const mail = inquiryEmail({ ...data, siteUrl });
  const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, replyTo: data.email });
  if (!sent.ok) return res.status(502).json({ error: 'Sorry, your message could not be sent. Please try again or message Luke on Instagram.' });

  return res.status(200).json({ success: true });
};
