// Records each website sale in Square as an Order with real line items (so Square's reports read
// "Coyote — Print", not a lump sum), then settles it with the card payment.
//
// The amount charged is always the website's own server-side total. An order is only paid when Square's
// computed total matches it to the cent; otherwise we try the next, simpler way of describing the same
// order, and finally fall back to the plain lump-sum payment so a sale is never lost to a bookkeeping quirk.
const { request, createPayment } = require('./square');
const { listItems } = require('./squareCatalog');
const { skuIndex, SKU_PREFIX } = require('./squareSync');

const money = (cents) => ({ amount: cents, currency: 'USD' });

function skuForLine(l) {
  return `${SKU_PREFIX}${l.artworkId}:${l.option === 'print' && l.variant ? `print:${l.variant}` : l.option}`;
}

// Order descriptions to try, most faithful first.
//   catalog  — line items reference the Square catalog variation (price still set to ours)
//   tax      — 'percent' uses a real Square sales tax; 'fixed' adds the tax as a flat line so cents always match
function strategies(hasCatalogIds) {
  return [
    ...(hasCatalogIds ? [{ catalog: true, tax: 'percent' }, { catalog: true, tax: 'fixed' }] : []),
    { catalog: false, tax: 'fixed' },
  ];
}

function buildOrder(priced, catalogIds, { catalog, tax }, referenceId) {
  const line_items = priced.lines.map((l) => {
    const id = catalog ? catalogIds.get(skuForLine(l)) : null;
    return {
      quantity: String(l.qty),
      base_price_money: money(l.unitCents),
      ...(id ? { catalog_object_id: id } : { name: `${l.title} — ${l.optionLabel}`.slice(0, 500) }),
    };
  });
  const service_charges = [];
  const taxes = [];
  const taxed = priced.taxCents > 0;
  if (priced.shippingCents) {
    const percentTaxed = tax === 'percent' && taxed; // shipping is taxable only when the order is
    service_charges.push({ name: 'Shipping', amount_money: money(priced.shippingCents), calculation_phase: percentTaxed ? 'SUBTOTAL_PHASE' : 'TOTAL_PHASE', taxable: percentTaxed });
  }
  if (taxed && tax === 'percent') {
    taxes.push({ uid: 'sales-tax', name: 'Sales tax', percentage: String(priced.taxRatePercent), scope: 'ORDER' });
  } else if (taxed) {
    service_charges.push({ name: `Sales tax (${priced.taxRatePercent}%)`, amount_money: money(priced.taxCents), calculation_phase: 'TOTAL_PHASE', taxable: false });
  }
  return {
    location_id: process.env.SQUARE_LOCATION_ID,
    reference_id: referenceId,
    line_items,
    ...(service_charges.length ? { service_charges } : {}),
    ...(taxes.length ? { taxes } : {}),
  };
}

async function cancelOrder(order) {
  if (!order?.id) return;
  await request('PUT', `/v2/orders/${order.id}`, { order: { location_id: order.location_id, version: order.version, state: 'CANCELED' } });
}

// Returns { ok, payment, orderId?, via } or { ok:false, status, message } when the card is declined.
async function chargeCart({ nonce, priced, buyerEmail, note, referenceId }) {
  let catalogIds = new Map();
  try {
    const listed = await listItems();
    if (listed.ok) catalogIds = new Map([...skuIndex(listed.items)].map(([sku, h]) => [sku, h.v.id]));
  } catch (e) {
    console.error('checkout: could not read Square catalog:', e?.message);
  }
  const hasCatalogIds = priced.lines.some((l) => catalogIds.has(skuForLine(l)));

  for (const s of strategies(hasCatalogIds)) {
    const r = await request('POST', '/v2/orders', { idempotency_key: `${referenceId}-${s.catalog}-${s.tax}`, order: buildOrder(priced, catalogIds, s, referenceId) });
    if (!r.ok) {
      console.error(`checkout: Square order (${JSON.stringify(s)}) rejected:`, r.message);
      continue;
    }
    const order = r.data.order;
    if (order?.total_money?.amount !== priced.totalCents) {
      console.error(`checkout: Square order total ${order?.total_money?.amount} != expected ${priced.totalCents} (${JSON.stringify(s)})`);
      await cancelOrder(order);
      continue;
    }
    const pay = await createPayment({ nonce, amountCents: priced.totalCents, buyerEmail, note, orderId: order.id });
    if (pay.ok) return { ...pay, orderId: order.id, via: s };
    await cancelOrder(order);
    // A declined card is final. But a 400 means Square disliked the request itself (nothing was charged), so
    // fall through to the plain payment rather than turning a bookkeeping problem into a lost sale.
    if (pay.status !== 400) return pay;
    console.error('checkout: Square refused to pay the order, retrying as a plain payment:', pay.message);
    break;
  }

  console.error('checkout: falling back to a plain payment with no Square order');
  const pay = await createPayment({ nonce, amountCents: priced.totalCents, buyerEmail, note });
  return pay.ok ? { ...pay, via: 'payment-only' } : pay;
}

module.exports = { chargeCart, buildOrder, skuForLine };
