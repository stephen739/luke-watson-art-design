const { BRANCH, reject, github, ghError } = require('../lib/portal');

const MAX_BYTES = 3 * 1024 * 1024;

function detectType(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

module.exports = async (req, res) => {
  if (reject(req, res, { method: 'POST' })) return;
  const { name, data } = req.body || {};
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) return res.status(400).json({ error: 'No image received.' });
  const buf = Buffer.from(data, 'base64');
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'That image is too large.' });
  const ext = detectType(buf);
  if (!ext) return res.status(400).json({ error: 'Please upload a JPG, PNG or WebP image.' });

  const slug = String(name || 'artwork').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'artwork';
  const filePath = `images/art/${Date.now().toString(36)}-${slug}.${ext}`;

  // [skip ci] avoids a redeploy per upload; the following "publish" commit deploys everything.
  const { status } = await github('PUT', `contents/${filePath}`, {
    message: 'Portal: upload artwork image [skip ci]',
    content: buf.toString('base64'),
    branch: BRANCH,
  });
  if (status !== 201) return res.status(502).json({ error: ghError(status) });
  res.status(200).json({ path: filePath });
};
