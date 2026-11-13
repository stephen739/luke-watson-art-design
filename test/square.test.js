const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fixtures = require('./fixtures');
const { makeWorld, install, variation, item } = require('./fakeSquare');
const { planSync, changedKeys, applyChanges, planPull, formatPrice } = require('../lib/squareSync');
const { pushToSquare } = require('../lib/squareCatalog');
const { pullFromSquare, manualSync } = require('../lib/squareRun');
const { chargeCart } = require('../lib/squareOrder');
const { priceCart, catalog } = require('../lib/checkout');

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

// Luke's hand-made "Coyote" in Square, before any sync.
const manualCoyote = () => item('MANUAL_COYOTE', 'Coyote', [variation('MV1', 'Original', 30000), variation('MV2', 'Print', 2500), variation('MV3', 'Digital download', 1500)]);

test('formatPrice', () => {
  assert.equal(formatPrice(30000), '$300');
  assert.equal(formatPrice(1250), '$12.50');
});

test('planSync adopts a hand-made item by name and matches its variations', () => {
  const plan = planSync(fixtures(), [manualCoyote()], { prefer: 'site' });
  assert.equal(plan.linked, false);
  const coyote = plan.items.find((i) => i.id === 'coyote-53x');
  assert.equal(coyote.adopted, true);
  const byKey = Object.fromEntries(coyote.variations.map((v) => [v.key, v]));
  assert.deepEqual([byKey.canvas.squareId, byKey.print.squareId, byKey.digital.squareId], ['MV1', 'MV2', 'MV3']);
  assert.equal(byKey.canvas.action, 'link'); // same price, just needs our SKU
  assert.equal(byKey.print.action, 'push'); // site $30 vs Square $25
  assert.equal(plan.items.find((i) => i.id === 'faces').action, 'create');
});

test('planSync prefer=square marks differing prices to be pulled', () => {
  const plan = planSync(fixtures(), [manualCoyote()], { prefer: 'square' });
  assert.equal(plan.items[0].variations.find((v) => v.key === 'print').action, 'pull');
});

test('planSync refuses to guess between duplicate names', () => {
  const plan = planSync(fixtures(), [manualCoyote(), item('DUP', 'coyote', [variation('D1', 'Print', 100)])]);
  assert.equal(plan.items.find((i) => i.id === 'coyote-53x'), undefined);
  assert.match(plan.warnings[0], /same name/);
});

test('manual sync links Coyote, creates the rest, sets stock, and is idempotent', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  const r = await manualSync({ prefer: 'site', apply: true });
  assert.equal(r.ok, true);
  const coyote = w.items.find((i) => i.id === 'MANUAL_COYOTE');
  const skus = coyote.item_data.variations.map((v) => v.item_variation_data.sku).sort();
  assert.deepEqual(skus, ['lw:coyote-53x:canvas', 'lw:coyote-53x:digital', 'lw:coyote-53x:print']);
  assert.equal(coyote.item_data.variations.find((v) => v.item_variation_data.name === 'Print').item_variation_data.price_money.amount, 3000);
  assert.equal(coyote.item_data.variations.find((v) => v.item_variation_data.name === 'Original').item_variation_data.track_inventory, true);
  // Faces + the photograph exist now, with per-size photo print variations
  const photo = w.items.find((i) => i.item_data.name === 'Milky Way');
  assert.deepEqual(photo.item_data.variations.map((v) => v.item_variation_data.sku).sort(), ['lw:milky-way:digital', 'lw:milky-way:print:p1', 'lw:milky-way:print:p2']);
  // originals are in stock (1)
  const canvasIds = w.items.flatMap((i) => i.item_data.variations).filter((v) => v.item_variation_data.sku?.endsWith(':canvas')).map((v) => v.id);
  assert.equal(canvasIds.length, 2);
  for (const id of canvasIds) assert.equal(w.counts[id], 1);
  // second run changes nothing
  w.upserts.length = 0;
  const again = await manualSync({ prefer: 'site', apply: true });
  assert.equal(again.writes, 0);
  assert.equal(w.upserts.length, 0);
});

test('manual sync prefer=square copies Square prices into content.json', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  const r = await manualSync({ prefer: 'square', apply: true });
  assert.equal(r.ok, true);
  assert.equal(w.github.content.artworks[0].printPrice, '$25');
  assert.equal(w.github.writes.length, 1);
});

test('dry run changes nothing', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  const r = await manualSync({ prefer: 'site', apply: false });
  assert.equal(r.dryRun, true);
  assert.equal(w.upserts.length, 0);
  assert.equal(w.github.writes.length, 0);
});

test('steady-state push does nothing until the first sync has linked Square', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  const next = fixtures();
  next.artworks[0].printPrice = '$35';
  const r = await pushToSquare(next, { mode: 'steady', only: changedKeys(fixtures(), next) });
  assert.equal(r.skipped, 'not-linked');
  assert.equal(w.upserts.length, 0);
});

test('saving a new price pushes only that variation and keeps Square-side edits to others', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  // Luke edits the digital price directly in Square…
  const coyote = w.items.find((i) => i.id === 'MANUAL_COYOTE');
  coyote.item_data.variations.find((v) => v.item_variation_data.sku === 'lw:coyote-53x:digital').item_variation_data.price_money.amount = 2000;
  // …then someone saves an unrelated change plus a new print price in the portal.
  const before = fixtures();
  const after = fixtures();
  after.artworks[0].printPrice = '$35';
  w.upserts.length = 0;
  const r = await pushToSquare(after, { mode: 'steady', only: changedKeys(before, after) });
  assert.equal(r.ok, true);
  assert.equal(w.upserts.length, 1);
  assert.equal(w.upserts[0].length, 1);
  const byName = Object.fromEntries(coyote.item_data.variations.map((v) => [v.item_variation_data.name, v.item_variation_data.price_money.amount]));
  assert.equal(byName.Print, 3500);
  assert.equal(byName['Digital download'], 2000); // untouched
});

test('a new artwork added in the portal is created in Square once linked', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  const before = fixtures();
  const after = fixtures();
  after.artworks.push({ id: 'wolf', title: 'Wolf', canvasPrice: '$200', printPrice: '$25', digitalPrice: '$15', sold: false });
  const r = await pushToSquare(after, { mode: 'steady', only: changedKeys(before, after) });
  assert.equal(r.ok, true);
  assert.ok(w.items.find((i) => i.item_data.name === 'Wolf'));
});

test('marking an original sold sets Square stock to 0; un-selling sets it back to 1', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  const id = w.items.find((i) => i.id === 'MANUAL_COYOTE').item_data.variations.find((v) => v.item_variation_data.sku.endsWith(':canvas')).id;
  const before = fixtures();
  const sold = fixtures();
  sold.artworks[0].sold = true;
  await pushToSquare(sold, { mode: 'steady', only: changedKeys(before, sold) });
  assert.equal(w.counts[id], 0);
  await pushToSquare(before, { mode: 'steady', only: changedKeys(sold, before) });
  assert.equal(w.counts[id], 1);
});

test('Square → site: a price edited in Square is committed to content.json, and echoes are no-ops', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  const v = w.items.find((i) => i.id === 'MANUAL_COYOTE').item_data.variations.find((x) => x.item_variation_data.sku === 'lw:coyote-53x:canvas');
  v.item_variation_data.price_money.amount = 32500;
  const r = await pullFromSquare();
  assert.equal(r.ok, true);
  assert.equal(w.github.content.artworks[0].canvasPrice, '$325');
  assert.equal(w.github.writes.length, 1);
  const echo = await pullFromSquare();
  assert.deepEqual(echo.changed, []);
  assert.equal(w.github.writes.length, 1);
});

test('Square → site: stock of 0 marks the original sold; restocking un-sells it', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  const id = w.items.find((i) => i.id === 'MANUAL_COYOTE').item_data.variations.find((x) => x.item_variation_data.sku.endsWith(':canvas')).id;
  w.counts[id] = 0;
  await pullFromSquare();
  assert.equal(w.github.content.artworks[0].sold, true);
  w.counts[id] = 1;
  await pullFromSquare();
  assert.equal(w.github.content.artworks[0].sold, false);
});

test('Square → site never copies a missing/zero price', () => {
  const content = fixtures();
  const it = item('S1', 'Coyote', [variation('V1', 'Original Canvas', 30000, 'lw:coyote-53x:canvas'), variation('V2', 'Print', 3000, 'lw:coyote-53x:print', { pricing_type: 'VARIABLE_PRICING', price_money: undefined })]);
  assert.deepEqual(planPull(content, [it]), []);
});

test('applyChanges updates photo print rows and digital prices', () => {
  const { content, applied } = applyChanges(fixtures(), [
    { type: 'price', id: 'milky-way', key: 'print:p2', cents: 6500 },
    { type: 'price', id: 'milky-way', key: 'digital', cents: 1250 },
  ]);
  assert.equal(applied, 2);
  assert.equal(content.photos[0].prints[1].price, '$65');
  assert.equal(content.photos[0].digitalPrice, '$12.50');
});

// ---- webhook ----
test('webhook rejects a bad signature and accepts a valid one', async () => {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()] });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  w.items[0].item_data.variations[0].item_variation_data.price_money.amount = 31000;
  process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'sigkey';
  process.env.SQUARE_WEBHOOK_URL = 'https://example.com/api/square-webhook';
  const handler = require('../api/square-webhook');
  const raw = JSON.stringify({ type: 'catalog.version.updated', data: { object: { catalog_version: { updated_at: 'x' } } } });
  const call = async (sig, body = raw) => {
    const out = {};
    const res = { setHeader() {}, status(c) { out.status = c; return this; }, json(d) { out.body = d; return this; } };
    await handler({ method: 'POST', headers: { 'x-square-hmacsha256-signature': sig }, body }, res);
    return out;
  };
  assert.equal((await call('bm9wZQ==')).status, 401);
  const good = crypto.createHmac('sha256', 'sigkey').update('https://example.com/api/square-webhook' + raw).digest('base64');
  const ok = await call(good);
  assert.equal(ok.status, 200);
  assert.equal(w.github.content.artworks[0].canvasPrice, '$310');
  assert.equal((await call(good, raw.replace('catalog', 'xatalog'))).status, 401);
});

// ---- checkout orders ----
const cart = (items, extra = {}) => priceCart(catalog(fixtures()), { items, fulfillment: 'shipping', shippingState: 'TX', taxRatePercent: 8.25, ...extra });

async function linkedWorld(opts = {}) {
  const w = makeWorld({ content: fixtures(), items: [manualCoyote()], ...opts });
  install(w);
  await manualSync({ prefer: 'site', apply: true });
  return w;
}

test('checkout records a catalog-linked Square order and pays it', async () => {
  const w = await linkedWorld();
  const priced = cart([{ artworkId: 'coyote-53x', option: 'print', qty: 2 }, { artworkId: 'milky-way', option: 'print', variant: 'p2', qty: 1 }]);
  const r = await chargeCart({ nonce: 'cnon:ok', priced, buyerEmail: 'a@b.co', note: 'x', referenceId: 'ref1' });
  assert.equal(r.ok, true);
  assert.equal(w.orders.length, 1);
  assert.ok(w.orders[0]._req.line_items.every((l) => l.catalog_object_id));
  assert.equal(w.payments[0].amount_money.amount, priced.totalCents);
  assert.equal(w.payments[0].order_id, w.orders[0].id);
});

test('checkout falls back to named lines when Square ignores the price override', async () => {
  const w = await linkedWorld({ ignorePriceOverride: true });
  // make the catalog price differ from the site price so the catalog-linked order can't match
  w.items[0].item_data.variations.find((v) => v.item_variation_data.sku.endsWith(':print')).item_variation_data.price_money.amount = 2500;
  const priced = cart([{ artworkId: 'coyote-53x', option: 'print', qty: 1 }]);
  const r = await chargeCart({ nonce: 'cnon:ok', priced, buyerEmail: 'a@b.co', note: 'x', referenceId: 'ref2' });
  assert.equal(r.ok, true);
  assert.equal(w.payments[0].amount_money.amount, priced.totalCents);
  assert.ok(w.orders.filter((o) => o.state === 'CANCELED').length >= 1);
  assert.ok(w.orders.at(-1)._req.line_items.every((l) => !l.catalog_object_id && l.name));
});

test('checkout falls back to a plain payment if Square orders fail entirely', async () => {
  const w = await linkedWorld({ rejectOrders: true });
  const priced = cart([{ artworkId: 'faces', option: 'digital' }], { fulfillment: undefined });
  const r = await chargeCart({ nonce: 'cnon:ok', priced, buyerEmail: 'a@b.co', note: 'x', referenceId: 'ref3' });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'payment-only');
  assert.equal(w.payments[0].amount_money.amount, priced.totalCents);
  assert.equal(w.payments[0].order_id, undefined);
});

test('a declined card cancels the order and is never retried as a plain payment', async () => {
  const w = await linkedWorld();
  const priced = cart([{ artworkId: 'faces', option: 'print', qty: 1 }]);
  const r = await chargeCart({ nonce: 'cnon:card-declined', priced, buyerEmail: 'a@b.co', note: 'x', referenceId: 'ref4' });
  assert.equal(r.ok, false);
  assert.equal(w.payments.length, 0);
  assert.equal(w.orders.at(-1).state, 'CANCELED');
});

test('totals match to the cent for out-of-state shipping (no tax) and pickup', async () => {
  const w = await linkedWorld();
  for (const extra of [{ shippingState: 'NM' }, { fulfillment: 'pickup' }]) {
    const priced = cart([{ artworkId: 'coyote-53x', option: 'canvas' }], extra);
    const r = await chargeCart({ nonce: 'cnon:ok', priced, buyerEmail: 'a@b.co', note: 'x', referenceId: `r-${JSON.stringify(extra)}` });
    assert.equal(r.ok, true);
    assert.equal(w.payments.at(-1).amount_money.amount, priced.totalCents);
  }
});

test('if Square refuses to pay the order (400), the buyer is still charged via a plain payment', async () => {
  const w = await linkedWorld({ rejectOrderPayments: true });
  const priced = cart([{ artworkId: 'faces', option: 'print', qty: 1 }]);
  const r = await chargeCart({ nonce: 'cnon:ok', priced, buyerEmail: 'a@b.co', note: 'x', referenceId: 'ref5' });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'payment-only');
  assert.equal(w.payments.length, 1);
  assert.equal(w.orders[0].state, 'CANCELED');
});
