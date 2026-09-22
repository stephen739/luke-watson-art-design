const REPO = process.env.GITHUB_REPO || 'stephen739/luke-watson-art-design';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

async function github(method, apiPath, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'lw-site',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

const ghError = (status) =>
  status === 401 || status === 403 || status === 404
    ? 'Could not reach the website files. GitHub access may have expired.'
    : status === 409 || status === 422
      ? 'Someone else saved changes first.'
      : 'Saving failed. Please try again in a moment.';

// Reads content.json fresh from GitHub (not the bundled copy) and returns the parsed object plus
// its blob sha, needed to write back an update (e.g. marking a one-of-one canvas sold).
async function readLiveContent() {
  const { status, data } = await github('GET', `contents/content.json?ref=${BRANCH}`);
  if (status !== 200) return { ok: false, status };
  return { ok: true, content: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')), sha: data.sha };
}

async function writeLiveContent(content, sha, message) {
  return github('PUT', 'contents/content.json', {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2) + '\n').toString('base64'),
    sha,
    branch: BRANCH,
  });
}

module.exports = { BRANCH, github, ghError, readLiveContent, writeLiveContent };
