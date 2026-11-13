// Portal-only: shows how the website's catalog lines up with Square, and runs a deliberate full sync.
//   GET  ?prefer=site|square  → preview only (changes nothing)
//   POST { prefer }           → apply
const { reject } = require('../lib/portal');
const square = require('../lib/square');
const { manualSync } = require('../lib/squareRun');

const ACTION_TEXT = {
  ok: 'In sync',
  link: 'Will be linked',
  push: 'Square will be updated',
  pull: 'Website will be updated',
  create: 'Will be added to Square',
  skip: 'Left alone',
};

function summarize(plan) {
  return {
    linked: plan.linked,
    warnings: plan.warnings,
    rows: plan.items.flatMap((it) =>
      it.variations.map((v) => ({ title: it.title, option: v.name, sitePrice: v.sitePrice, squarePrice: v.squarePrice, action: v.action, note: ACTION_TEXT[v.action] || v.action, adopted: it.adopted })),
    ),
  };
}

module.exports = async (req, res) => {
  if (reject(req, res, { method: req.method === 'POST' ? 'POST' : 'GET' })) return;
  if (!square.configured()) {
    return res.status(503).json({ error: 'Square is not connected yet (SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID missing in Vercel).' });
  }
  const webhook = Boolean(process.env.SQUARE_WEBHOOK_SIGNATURE_KEY);
  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const prefer = (req.method === 'POST' ? req.body?.prefer : req.query?.prefer) === 'square' ? 'square' : 'site';

  const r = await manualSync({ prefer, apply: req.method === 'POST' });
  if (!r.ok) return res.status(502).json({ error: r.message, partial: Boolean(r.partial) });
  res.status(200).json({ environment, webhook, applied: req.method === 'POST', stockUpdates: r.stockUpdates || 0, pulled: r.pulled || [], ...summarize(r.plan) });
};
