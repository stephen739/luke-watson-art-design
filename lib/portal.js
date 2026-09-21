const crypto = require('crypto');

const REPO = process.env.GITHUB_REPO || 'stephen739/luke-watson-art-design';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const SESSION_DAYS = 7;

const configured = () => Boolean(process.env.ADMIN_PASSWORD && process.env.GITHUB_TOKEN);

// Sessions are signed with a key derived from both secrets, so changing either one signs everyone out.
const signingKey = () =>
  crypto.createHash('sha256').update(`lw-portal|${process.env.ADMIN_PASSWORD}|${process.env.GITHUB_TOKEN}`).digest();

function makeSession() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  const mac = crypto.createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return false;
  const [body, mac] = token.split('.');
  if (!body || !mac) return false;
  const expected = crypto.createHmac('sha256', signingKey()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const sessionCookie = (value, maxAge) =>
  `lw_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

const isAuthed = (req) => configured() && verifySession(readCookie(req, 'lw_session'));

function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(process.env.ADMIN_PASSWORD)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Returns true when the request was rejected (response already sent).
function reject(req, res, { method, auth = true }) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ error: 'Method not allowed' });
    return true;
  }
  if (!configured()) {
    res.status(503).json({ error: 'The portal is not set up yet. ADMIN_PASSWORD and GITHUB_TOKEN must be added in Vercel.' });
    return true;
  }
  if (method === 'POST') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      res.status(403).json({ error: 'Cross-site request blocked' });
      return true;
    }
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      res.status(415).json({ error: 'Expected JSON' });
      return true;
    }
  }
  if (auth && !isAuthed(req)) {
    res.status(401).json({ error: 'Please sign in again.' });
    return true;
  }
  return false;
}

async function github(method, apiPath, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lw-portal',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

const ghError = (status) =>
  status === 401 || status === 403 || status === 404
    ? 'The portal cannot reach the website files. Its GitHub access may have expired.'
    : status === 409 || status === 422
      ? 'Someone else saved changes first. Reload the page and try again.'
      : 'Saving failed. Please try again in a moment.';

module.exports = { BRANCH, makeSession, sessionCookie, isAuthed, passwordMatches, reject, github, ghError, SESSION_DAYS };
