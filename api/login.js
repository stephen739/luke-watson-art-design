const { reject, passwordMatches, makeSession, sessionCookie, SESSION_DAYS } = require('../lib/portal');

module.exports = async (req, res) => {
  if (reject(req, res, { method: 'POST', auth: false })) return;
  if (!passwordMatches(req.body?.password)) {
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: 'That password is not right.' });
  }
  res.setHeader('Set-Cookie', sessionCookie(makeSession(), SESSION_DAYS * 86400));
  res.status(200).json({ ok: true });
};
