// End-to-end sync jobs that read/write both Square and the website's content.json on GitHub.
const { readLiveContent, writeLiveContent } = require('./github');
const { pushToSquare, pullPlan } = require('./squareCatalog');
const { applyChanges } = require('./squareSync');
const { validateContent } = require('./schema');

function describe(changes) {
  return changes.map((c) => (c.type === 'sold' ? `${c.id}: ${c.sold ? 'marked sold' : 'back on sale'}` : `${c.id} ${c.key}: $${(c.from / 100).toFixed(2)} → $${(c.cents / 100).toFixed(2)}`));
}

// Commits Square-originated changes to content.json (retrying once on a concurrent edit).
// `compute(content)` returns the changes to apply against the freshest copy.
async function commitChanges(compute, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const live = await readLiveContent();
    if (!live.ok) return { ok: false, message: `Could not read the website content (GitHub ${live.status || 'unreachable'}).` };
    const changes = await compute(live.content);
    if (!changes.ok) return changes;
    if (!changes.list.length) return { ok: true, changed: [] };
    const { content, applied } = applyChanges(live.content, changes.list);
    if (!applied) return { ok: true, changed: [] };
    const clean = validateContent(content);
    const res = await writeLiveContent(clean, live.sha, message);
    if (res.status === 200) return { ok: true, changed: describe(changes.list) };
    if (res.status !== 409 && res.status !== 422) return { ok: false, message: `GitHub refused the update (${res.status}).` };
  }
  return { ok: false, message: 'The website was being edited at the same moment; Square changes will be picked up on the next sync.' };
}

// Square → website. Used by the webhook.
function pullFromSquare() {
  return commitChanges(async (content) => {
    const p = await pullPlan(content);
    return p.ok ? { ok: true, list: p.changes } : p;
  }, 'Square: sync prices and availability from Square');
}

// Deliberate full sync from the portal. `prefer` picks the winner where both sides have a different price.
async function manualSync({ prefer, apply }) {
  const live = await readLiveContent();
  if (!live.ok) return { ok: false, message: `Could not read the website content (GitHub ${live.status || 'unreachable'}).` };
  const r = await pushToSquare(live.content, { mode: 'manual', prefer, dryRun: !apply });
  if (!r.ok) return r;
  let pulled = [];
  if (apply && r.pullChanges.length) {
    const c = await commitChanges(async () => ({ ok: true, list: r.pullChanges }), 'Square: adopt prices from Square');
    if (!c.ok) return { ...c, partial: true };
    pulled = c.changed;
  }
  return { ...r, pulled };
}

module.exports = { pullFromSquare, manualSync, commitChanges };
