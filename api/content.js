const { BRANCH, reject, github, ghError } = require('../lib/portal');
const { readLiveContent } = require('../lib/github');
const { validateContent } = require('../lib/schema');

// A portal page that was opened before a feature shipped doesn't know about its data (new lists, new
// per-item fields) and would send them back missing, silently erasing them. Anything the page did not
// send at all is therefore carried over from the live copy. Sending an empty value on purpose
// (an empty list, an empty string) still counts as a deliberate change and is respected.
const LIST_KEYS = ['photos', 'featured'];

async function carryOverMissing(incoming) {
  if (!incoming || typeof incoming !== 'object') return incoming;
  const lacksList = LIST_KEYS.some((k) => incoming[k] === undefined);
  const lacksFullImage = Array.isArray(incoming.artworks) && incoming.artworks.some((a) => a && typeof a === 'object' && a.fullImage === undefined);
  if (!lacksList && !lacksFullImage) return incoming;
  const live = await readLiveContent();
  if (!live.ok) throw Object.assign(new Error(ghError(live.status)), { status: 502 });
  const merged = { ...incoming };
  for (const k of LIST_KEYS) if (merged[k] === undefined) merged[k] = live.content[k] ?? [];
  if (lacksFullImage) {
    const liveById = new Map((live.content.artworks || []).map((a) => [a.id, a]));
    merged.artworks = incoming.artworks.map((a) => (a && typeof a === 'object' && a.fullImage === undefined && liveById.get(a.id)?.fullImage ? { ...a, fullImage: liveById.get(a.id).fullImage } : a));
  }
  return merged;
}

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
    clean = validateContent(await carryOverMissing(req.body?.content));
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
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
