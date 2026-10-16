const { reject, passwordMatches, makeSession, sessionCookie, SESSION_DAYS } = require('../lib/portal');

// Best-effort brute-force guard. Serverless instances don't share memory, so this slows a
// determined attacker rather than stopping one — a long password is the real protection.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

function prune(now) {
  if (attempts.size < 500) return;
  for (const [ip, e] of attempts) if (now - e.first > WINDOW_MS && now > (e.lockedUntil || 0)) attempts.delete(ip);
}

module.exports = async (req, res) => {
  if (reject(req, res, { method: 'POST', auth: false })) return;

  const ip = ipOf(req);
  const now = Date.now();
  prune(now);
  let entry = attempts.get(ip);
  if (entry && now > (entry.lockedUntil || 0) && now - entry.first > WINDOW_MS) { attempts.delete(ip); entry = undefined; }
  if (entry && entry.lockedUntil > now) {
    const mins = Math.ceil((entry.lockedUntil - now) / 60000);
    res.setHeader('Retry-After', String(mins * 60));
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }

  if (!passwordMatches(req.body?.password)) {
    entry = entry || { count: 0, first: now };
    entry.count += 1;
    if (entry.count >= MAX_FAILS) entry.lockedUntil = now + WINDOW_MS;
    attempts.set(ip, entry);
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: 'That password is not right.' });
  }

  attempts.delete(ip);
  res.setHeader('Set-Cookie', sessionCookie(makeSession(), SESSION_DAYS * 86400));
  res.status(200).json({ ok: true });
};
