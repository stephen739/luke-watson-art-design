const { BRANCH, reject, github, ghError } = require('../lib/portal');
const { validateContent } = require('../lib/schema');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    if (reject(req, res, { method: 'GET' })) return;
    const { status, data } = await github('GET', `contents/content.json?ref=${BRANCH}`);
    if (status !== 200) return res.status(502).json({ error: ghError(status) });
    const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    return res.status(200).json({ content, sha: data.sha });
  }

  if (reject(req, res, { method: 'POST' })) return;
  let clean;
  try {
    clean = validateContent(req.body?.content);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const sha = req.body?.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) return res.status(400).json({ error: 'Missing version. Reload the page.' });

  const { status, data } = await github('PUT', 'contents/content.json', {
    message: 'Portal: update site content',
    content: Buffer.from(JSON.stringify(clean, null, 2) + '\n').toString('base64'),
    sha,
    branch: BRANCH,
  });
  if (status !== 200) return res.status(status === 409 || status === 422 ? 409 : 502).json({ error: ghError(status) });
  res.status(200).json({ ok: true, sha: data.content.sha, content: clean });
};
