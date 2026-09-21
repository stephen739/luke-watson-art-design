const { reject, sessionCookie } = require('../lib/portal');

module.exports = async (req, res) => {
  if (reject(req, res, { method: 'POST', auth: false })) return;
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.status(200).json({ ok: true });
};
