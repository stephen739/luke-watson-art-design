// One public contact address for the whole site (footer, contact form, order alerts, reply-to).
// It lives in content.json so Luke can change it in the portal; env vars are only a fallback.
const { DEFAULT_CONTACT_EMAIL } = require('./schema');

function contactEmail(content) {
  const fromContent = content?.text?.contact_email;
  return fromContent || process.env.CONTACT_FORM_EMAIL || process.env.NOTIFY_EMAIL || DEFAULT_CONTACT_EMAIL;
}

module.exports = { contactEmail };
