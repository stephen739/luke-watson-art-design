// Pure planning logic for keeping the website's prices / sold status and Square's catalog in step.
// Nothing here talks to the network — lib/squareCatalog.js does that — so every rule is unit-testable.
//
// How the two sides are tied together: each Square variation we manage carries the SKU
// "lw:<site id>:<option>" (option = canvas | print | digital | print:<print size id>). The SKU is the
// link, so no extra database is needed and a Square item Luke renames by hand stays linked.
const { catalog, centsFromPriceString } = require('./checkout');

const SKU_PREFIX = 'lw:';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function formatPrice(cents) {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

// What the website says should exist in Square.
function desiredItems(content) {
  return catalog(content).map((item) => {
    const vars = [];
    if (item.kind === 'photo') {
      for (const p of item.prints || []) {
        const cents = centsFromPriceString(p.price);
        if (cents) vars.push({ key: `print:${p.id}`, name: `Print — ${p.size}`, cents });
      }
      const d = centsFromPriceString(item.digitalPrice);
      if (d) vars.push({ key: 'digital', name: 'Digital Download', cents: d });
    } else {
      const c = centsFromPriceString(item.canvasPrice);
      if (c) vars.push({ key: 'canvas', name: 'Original Canvas', cents: c, track: true });
      const p = centsFromPriceString(item.printPrice);
      if (p) vars.push({ key: 'print', name: 'Print', cents: p });
      const d = centsFromPriceString(item.digitalPrice);
      if (d) vars.push({ key: 'digital', name: 'Digital Download', cents: d });
    }
    return {
      id: item.id,
      title: item.title,
      sold: Boolean(item.sold),
      variations: vars.map((v) => ({ ...v, sku: `${SKU_PREFIX}${item.id}:${v.key}` })),
    };
  });
}

function squarePrice(v) {
  const d = v?.item_variation_data;
  if (!d || d.pricing_type !== 'FIXED_PRICING' || !d.price_money) return null;
  const n = Number(d.price_money.amount);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function variationsOf(item) {
  return (item?.item_data?.variations || []).filter((v) => !v.is_deleted);
}

function skuIndex(items) {
  const bySku = new Map();
  for (const item of items) {
    for (const v of variationsOf(item)) {
      const sku = v.item_variation_data?.sku;
      if (typeof sku === 'string' && sku.startsWith(SKU_PREFIX)) bySku.set(sku, { item, v });
    }
  }
  return bySku;
}

// True once at least one variation carries our SKU, i.e. the first sync has been run deliberately.
// Automatic syncing stays off until then so nothing touches Square by surprise.
const isLinked = (items) => skuIndex(items).size > 0;

// When adopting an item Luke already made by hand in Square, line its variations up with ours by name.
function nameMatches(dv, sqVariation) {
  const n = norm(sqVariation.item_variation_data?.name);
  if (dv.key === 'canvas') return /\b(canvas|original)\b/.test(n);
  if (dv.key === 'digital') return /\b(digital|download)\b/.test(n);
  if (dv.key === 'print') return /^print\b/.test(n) || n === 'prints';
  return n === norm(dv.name) || n.includes(norm(dv.name.replace(/^Print\s*—\s*/, '')));
}

// Compares the website with Square's items and says, per variation, what would happen.
// action: ok | link (just add our SKU) | push (site price → Square) | pull (Square price → site)
//         | create | skip. `prefer` decides which side wins when both have a price and they differ.
function planSync(content, items, { prefer = 'site' } = {}) {
  const bySku = skuIndex(items);
  const linkedItemIds = new Set([...bySku.values()].map((h) => h.item.id));
  const byName = new Map();
  for (const item of items) {
    if (item.is_deleted || linkedItemIds.has(item.id)) continue;
    const k = norm(item.item_data?.name);
    byName.set(k, [...(byName.get(k) || []), item]);
  }

  const warnings = [];
  const out = [];
  for (const d of desiredItems(content)) {
    if (!d.variations.length) continue;
    let parent = d.variations.map((dv) => bySku.get(dv.sku)?.item).find(Boolean) || null;
    let adopted = false;
    if (!parent) {
      const cands = byName.get(norm(d.title)) || [];
      if (cands.length > 1) {
        warnings.push(`"${d.title}" matches ${cands.length} items in Square with the same name, so it was skipped. Rename or delete the duplicates in Square.`);
        continue;
      }
      if (cands.length === 1) {
        parent = cands[0];
        adopted = true;
      }
    }

    const claimed = new Set();
    const vars = d.variations.map((dv) => {
      const row = { key: dv.key, name: dv.name, sku: dv.sku, sitePrice: dv.cents, track: Boolean(dv.track), squareId: null, squarePrice: null, hasSku: false, action: 'create' };
      if (!parent) return row;
      let v = bySku.get(dv.sku)?.item.id === parent.id ? bySku.get(dv.sku).v : null;
      if (!v && adopted) {
        v = variationsOf(parent).find((sv) => !claimed.has(sv.id) && !sv.item_variation_data?.sku?.startsWith(SKU_PREFIX) && nameMatches(dv, sv)) || null;
      }
      if (!v) return row;
      claimed.add(v.id);
      row.squareId = v.id;
      row.squarePrice = squarePrice(v);
      const hasSku = v.item_variation_data?.sku === dv.sku;
      row.hasSku = hasSku;
      if (row.squarePrice === null) {
        warnings.push(`"${d.title}" — ${dv.name}: Square has no fixed price for it, so its price was left alone.`);
        row.action = hasSku ? 'ok' : 'skip';
      } else if (row.squarePrice === dv.cents) {
        row.action = hasSku ? 'ok' : 'link';
      } else {
        row.action = prefer === 'square' ? 'pull' : 'push';
      }
      return row;
    });
    out.push({ id: d.id, title: d.title, sold: d.sold, squareItemId: parent?.id || null, adopted, action: parent ? (adopted ? 'link' : 'ok') : 'create', variations: vars });
  }
  return { linked: bySku.size > 0, items: out, warnings };
}

// Which variations changed between two saved copies of content.json: new/changed prices and sold flags.
// Only these are pushed to Square on a portal save, so a price Luke changed directly in Square is never
// overwritten just because someone saved an unrelated text edit.
function changedKeys(before, after) {
  const prior = new Map();
  for (const d of desiredItems(before || {})) for (const v of d.variations) prior.set(`${d.id}|${v.key}`, v.cents);
  const priorSold = new Map(desiredItems(before || {}).map((d) => [d.id, d.sold]));
  const changed = new Set();
  for (const d of desiredItems(after)) {
    for (const v of d.variations) if (prior.get(`${d.id}|${v.key}`) !== v.cents) changed.add(`${d.id}|${v.key}`);
    if (priorSold.get(d.id) !== d.sold) changed.add(`${d.id}|sold`);
  }
  return changed;
}

// What Square holds that the website should now copy: prices of linked variations, and sold status from
// the original canvas's stock count. `counts` maps variation id → quantity (number).
function planPull(content, items, counts = new Map()) {
  const bySku = skuIndex(items);
  const changes = [];
  for (const d of desiredItems(content)) {
    for (const dv of d.variations) {
      const hit = bySku.get(dv.sku);
      if (!hit) continue;
      const sq = squarePrice(hit.v);
      if (sq !== null && sq !== dv.cents) changes.push({ type: 'price', id: d.id, key: dv.key, cents: sq, from: dv.cents });
      if (dv.key === 'canvas' && counts.has(hit.v.id)) {
        const soldInSquare = counts.get(hit.v.id) <= 0;
        if (soldInSquare !== d.sold) changes.push({ type: 'sold', id: d.id, sold: soldInSquare });
      }
    }
  }
  return changes;
}

// Applies pull changes to a content.json object (returns a new object; unchanged ids are left alone).
function applyChanges(content, changes) {
  const next = { ...content, artworks: (content.artworks || []).map((a) => ({ ...a })), photos: (content.photos || []).map((p) => ({ ...p, prints: (p.prints || []).map((r) => ({ ...r })) })) };
  let applied = 0;
  for (const c of changes) {
    const art = next.artworks.find((a) => a.id === c.id);
    const photo = next.photos.find((p) => p.id === c.id);
    if (c.type === 'sold') {
      if (art && Boolean(art.sold) !== c.sold) { art.sold = c.sold; applied++; }
      continue;
    }
    const price = formatPrice(c.cents);
    if (art) {
      const field = { canvas: 'canvasPrice', print: 'printPrice', digital: 'digitalPrice' }[c.key];
      if (field && art[field] !== price) { art[field] = price; applied++; }
    } else if (photo) {
      if (c.key === 'digital') {
        if (photo.digitalPrice !== price) { photo.digitalPrice = price; applied++; }
      } else if (c.key.startsWith('print:')) {
        const row = photo.prints.find((r) => r.id === c.key.slice(6));
        if (row && row.price !== price) { row.price = price; applied++; }
      }
    }
  }
  return { content: next, applied };
}

module.exports = { SKU_PREFIX, formatPrice, desiredItems, planSync, planPull, applyChanges, changedKeys, isLinked, skuIndex, squarePrice, variationsOf };
