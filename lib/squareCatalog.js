// Talks to Square's Catalog and Inventory APIs to carry out what lib/squareSync.js plans.
// Every function reports problems as { ok:false, message } rather than throwing, so a Square outage
// can never break saving the website or taking an order.
const crypto = require('crypto');
const { request } = require('./square');
const { planSync, planPull, isLinked, variationsOf, SKU_PREFIX } = require('./squareSync');

async function listItems() {
  const items = [];
  let cursor;
  do {
    const r = await request('GET', `/v2/catalog/list?types=ITEM${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok) return { ok: false, message: r.message };
    items.push(...(r.data.objects || []).filter((o) => !o.is_deleted));
    cursor = r.data.cursor;
  } while (cursor);
  return { ok: true, items };
}

// Map of variation id → in-stock quantity. A variation with no count on record is simply absent.
async function retrieveCounts(variationIds) {
  const counts = new Map();
  if (!variationIds.length) return { ok: true, counts };
  for (let i = 0; i < variationIds.length; i += 100) {
    let cursor;
    do {
      const r = await request('POST', '/v2/inventory/counts/batch-retrieve', {
        catalog_object_ids: variationIds.slice(i, i + 100),
        location_ids: [process.env.SQUARE_LOCATION_ID],
        states: ['IN_STOCK'],
        ...(cursor ? { cursor } : {}),
      });
      if (!r.ok) return { ok: false, message: r.message };
      for (const c of r.data.counts || []) {
        if (c.state === 'IN_STOCK') counts.set(c.catalog_object_id, Number(c.quantity));
      }
      cursor = r.data.cursor;
    } while (cursor);
  }
  return { ok: true, counts };
}

async function setCounts(wanted) {
  const changes = [...wanted].map(([id, qty]) => ({
    type: 'PHYSICAL_COUNT',
    physical_count: {
      catalog_object_id: id,
      state: 'IN_STOCK',
      location_id: process.env.SQUARE_LOCATION_ID,
      quantity: String(qty),
      occurred_at: new Date().toISOString(),
    },
  }));
  if (!changes.length) return { ok: true };
  const r = await request('POST', '/v2/inventory/changes/batch-create', { idempotency_key: crypto.randomUUID(), changes, ignore_unchanged_counts: true });
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

const money = (cents) => ({ amount: cents, currency: 'USD' });

// Turns planned rows into Square catalog objects. `selected(id, key)` says whether a row should be written.
function buildObjects(plan, items, selected) {
  const objects = [];
  const temps = new Map(); // temp id → { siteId, key }
  const varById = new Map();
  for (const item of items) for (const v of variationsOf(item)) varById.set(v.id, v);
  let n = 0;
  const temp = (siteId, key) => {
    const id = `#v${n++}`;
    temps.set(id, { siteId, key });
    return id;
  };

  for (const it of plan.items) {
    const rows = it.variations.filter((r) => selected(it.id, r.key));
    if (!rows.length) continue;
    if (!it.squareItemId) {
      const itemTemp = `#i${n++}`;
      objects.push({
        type: 'ITEM',
        id: itemTemp,
        item_data: {
          name: it.title,
          variations: it.variations.map((r) => ({
            type: 'ITEM_VARIATION',
            id: temp(it.id, r.key),
            item_variation_data: { item_id: itemTemp, name: r.name, sku: r.sku, pricing_type: 'FIXED_PRICING', price_money: money(r.sitePrice), ...(r.track ? { track_inventory: true } : {}) },
          })),
        },
      });
      continue;
    }
    for (const r of rows) {
      if (r.action === 'create') {
        objects.push({
          type: 'ITEM_VARIATION',
          id: temp(it.id, r.key),
          item_variation_data: { item_id: it.squareItemId, name: r.name, sku: r.sku, pricing_type: 'FIXED_PRICING', price_money: money(r.sitePrice), ...(r.track ? { track_inventory: true } : {}) },
        });
        continue;
      }
      // Updates resend the whole existing variation (Square has no partial update) with only price/SKU changed.
      const existing = varById.get(r.squareId);
      if (!existing) continue;
      const needsPrice = r.action === 'push';
      const needsSku = !r.hasSku;
      if (!needsPrice && !needsSku) continue;
      const data = { ...existing.item_variation_data, sku: r.sku };
      if (needsPrice) data.price_money = money(r.sitePrice);
      if (r.track) data.track_inventory = true;
      objects.push({
        type: 'ITEM_VARIATION',
        id: existing.id,
        version: existing.version,
        ...(existing.present_at_all_locations !== undefined ? { present_at_all_locations: existing.present_at_all_locations } : {}),
        item_variation_data: data,
      });
    }
  }
  return { objects, temps };
}

// Pushes the website's prices (and stock for one-of-one originals) to Square.
//   manual: every row in the plan (first sync / "Sync now"); `prefer` picks the winner on conflicts.
//   steady: only the rows named in `only` (what a save or a sale just changed); does nothing until linked.
async function pushToSquare(content, { mode = 'steady', prefer = 'site', only = null, dryRun = false } = {}) {
  const listed = await listItems();
  if (!listed.ok) return { ok: false, message: listed.message };
  const { items } = listed;
  if (mode === 'steady' && !isLinked(items)) return { ok: true, skipped: 'not-linked' };

  const plan = planSync(content, items, { prefer });
  const selected = (id, key) => mode === 'manual' || Boolean(only && only.has(`${id}|${key}`));

  // Stock: an original is 1 until sold, then 0 — kept in step with the website's "sold" switch.
  const canvasRows = plan.items.flatMap((it) => it.variations.filter((r) => r.key === 'canvas').map((r) => ({ it, r })));
  const existingIds = canvasRows.map(({ r }) => r.squareId).filter(Boolean);
  const countsRes = dryRun || !existingIds.length ? { ok: true, counts: new Map() } : await retrieveCounts(existingIds);
  if (!countsRes.ok) return { ok: false, message: countsRes.message };
  const counts = countsRes.counts;

  const pullChanges = [];
  if (prefer === 'square' && mode === 'manual') {
    for (const it of plan.items) {
      for (const r of it.variations) {
        if (r.action === 'pull') pullChanges.push({ type: 'price', id: it.id, key: r.key, cents: r.squarePrice, from: r.sitePrice });
        if (r.key === 'canvas' && r.squareId && counts.has(r.squareId) && (counts.get(r.squareId) <= 0) !== it.sold) pullChanges.push({ type: 'sold', id: it.id, sold: counts.get(r.squareId) <= 0 });
      }
    }
  }

  const { objects, temps } = buildObjects(plan, items, selected);
  if (dryRun) return { ok: true, dryRun: true, plan, pullChanges, writes: objects.length };

  let idMap = new Map();
  if (objects.length) {
    const r = await request('POST', '/v2/catalog/batch-upsert', { idempotency_key: crypto.randomUUID(), batches: [{ objects }] });
    if (!r.ok) return { ok: false, message: `Square rejected the catalog update: ${r.message}` };
    idMap = new Map((r.data.id_mappings || []).map((m) => [m.client_object_id, m.object_id]));
  }
  const newIdFor = new Map(); // `${siteId}|${key}` → real Square id of a just-created variation
  for (const [tmp, ref] of temps) if (idMap.has(tmp)) newIdFor.set(`${ref.siteId}|${ref.key}`, idMap.get(tmp));

  const wanted = new Map();
  for (const { it, r } of canvasRows) {
    const id = r.squareId || newIdFor.get(`${it.id}|canvas`);
    if (!id) continue;
    if (prefer === 'square' && mode === 'manual' && counts.has(id)) continue; // Square's count wins; the website adopts it
    const qty = it.sold ? 0 : 1;
    const isNew = !r.squareId;
    const requested = mode === 'manual' || isNew || (only && only.has(`${it.id}|sold`));
    if (requested && counts.get(id) !== qty) wanted.set(id, qty);
  }
  const inv = await setCounts(wanted);
  if (!inv.ok) return { ok: false, message: `Prices were updated, but Square stock could not be: ${inv.message}`, partial: true };

  const writes = objects.reduce((sum, o) => sum + (o.type === 'ITEM' ? o.item_data.variations.length : 1), 0);
  return { ok: true, plan, pullChanges, writes, stockUpdates: wanted.size, created: [...temps.keys()].filter((t) => idMap.has(t)).length };
}

// Reads Square and works out what the website should copy (prices + sold status).
async function pullPlan(content) {
  const listed = await listItems();
  if (!listed.ok) return { ok: false, message: listed.message };
  if (!isLinked(listed.items)) return { ok: true, skipped: 'not-linked', changes: [] };
  const canvasIds = [];
  for (const item of listed.items) {
    for (const v of variationsOf(item)) if (/^lw:[^:]+:canvas$/.test(v.item_variation_data?.sku || '')) canvasIds.push(v.id);
  }
  const countsRes = await retrieveCounts(canvasIds);
  if (!countsRes.ok) return { ok: false, message: countsRes.message };
  return { ok: true, changes: planPull(content, listed.items, countsRes.counts) };
}

module.exports = { listItems, retrieveCounts, setCounts, buildObjects, pushToSquare, pullPlan, SKU_PREFIX };
