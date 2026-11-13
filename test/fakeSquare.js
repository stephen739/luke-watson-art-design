// In-memory stand-in for Square (catalog, inventory, orders, payments) and the GitHub contents API,
// installed over global fetch so the real sync code runs end to end without any network.
let seq = 0;

function makeWorld({ content, items = [], counts = {}, ignorePriceOverride = false, rejectOrders = false, rejectOrderPayments = false } = {}) {
  const w = { items, counts, orders: [], payments: [], upserts: [], github: { content: JSON.parse(JSON.stringify(content)), sha: 'a'.repeat(40), writes: [] }, calls: [], ignorePriceOverride, rejectOrders, rejectOrderPayments };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  const allVars = () => w.items.flatMap((i) => i.item_data.variations);

  w.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    w.calls.push(`${opts.method || 'GET'} ${u.pathname}`);

    if (u.host === 'api.github.com') {
      if (opts.method === 'PUT') {
        if (body.sha !== w.github.sha) return json(409, {});
        w.github.content = JSON.parse(Buffer.from(body.content, 'base64').toString());
        w.github.sha = (++seq).toString(16).padStart(40, '0');
        w.github.writes.push(body.message);
        return json(200, { content: { sha: w.github.sha } });
      }
      return json(200, { content: Buffer.from(JSON.stringify(w.github.content)).toString('base64'), sha: w.github.sha });
    }

    const p = u.pathname;
    if (p === '/v2/catalog/list') return json(200, { objects: w.items });
    if (p === '/v2/catalog/batch-upsert') {
      const objs = body.batches[0].objects;
      w.upserts.push(objs);
      const map = {};
      const real = (id) => (id.startsWith('#') ? (map[id] ||= `SQ${++seq}`) : id);
      for (const o of objs) {
        if (o.type === 'ITEM') {
          const id = real(o.id);
          const item = { type: 'ITEM', id, version: 1, item_data: { name: o.item_data.name, variations: [] } };
          for (const v of o.item_data.variations) item.item_data.variations.push({ type: 'ITEM_VARIATION', id: real(v.id), version: 1, item_variation_data: { ...v.item_variation_data, item_id: id } });
          w.items.push(item);
        } else {
          const itemId = real(o.item_variation_data.item_id);
          const item = w.items.find((i) => i.id === itemId);
          const vars = item.item_data.variations;
          const idx = vars.findIndex((v) => v.id === o.id);
          if (o.id.startsWith('#')) vars.push({ type: 'ITEM_VARIATION', id: real(o.id), version: 1, item_variation_data: o.item_variation_data });
          else if (idx < 0) return json(400, { errors: [{ detail: 'unknown variation' }] });
          else if (o.version !== vars[idx].version) return json(409, { errors: [{ detail: 'version mismatch' }] });
          else vars[idx] = { ...vars[idx], version: vars[idx].version + 1, item_variation_data: o.item_variation_data };
        }
      }
      return json(200, { id_mappings: Object.entries(map).map(([c, o]) => ({ client_object_id: c, object_id: o })), objects: [] });
    }
    if (p === '/v2/inventory/counts/batch-retrieve') {
      return json(200, { counts: body.catalog_object_ids.filter((id) => id in w.counts).map((id) => ({ catalog_object_id: id, state: 'IN_STOCK', quantity: String(w.counts[id]) })) });
    }
    if (p === '/v2/inventory/changes/batch-create') {
      for (const c of body.changes) w.counts[c.physical_count.catalog_object_id] = Number(c.physical_count.quantity);
      return json(200, { counts: [] });
    }
    if (p === '/v2/orders') {
      if (w.rejectOrders) return json(400, { errors: [{ detail: 'nope' }] });
      const o = body.order;
      let sub = 0;
      for (const li of o.line_items) {
        const cat = li.catalog_object_id && allVars().find((v) => v.id === li.catalog_object_id);
        const unit = cat && (w.ignorePriceOverride || !li.base_price_money) ? cat.item_variation_data.price_money.amount : li.base_price_money.amount;
        sub += unit * Number(li.quantity);
      }
      let taxable = sub;
      let flat = 0;
      for (const sc of o.service_charges || []) {
        if (sc.taxable) taxable += sc.amount_money.amount;
        else flat += sc.amount_money.amount;
        if (sc.taxable) sub += sc.amount_money.amount;
      }
      const tax = (o.taxes || []).reduce((s, t) => s + Math.round((taxable * Number(t.percentage)) / 100), 0);
      const order = { id: `ORD${++seq}`, version: 1, state: 'OPEN', location_id: o.location_id, total_money: { amount: sub + flat + tax }, _req: o };
      w.orders.push(order);
      return json(200, { order });
    }
    if (p.startsWith('/v2/orders/')) {
      const order = w.orders.find((o) => `/v2/orders/${o.id}` === p);
      if (order && body.order.state) order.state = body.order.state;
      return json(200, { order });
    }
    if (p === '/v2/payments') {
      if (body.source_id === 'cnon:card-declined') return json(402, { errors: [{ detail: 'Card declined' }] });
      if (body.order_id && w.rejectOrderPayments) return json(400, { errors: [{ detail: 'bad order payment' }] });
      if (body.order_id) {
        const order = w.orders.find((o) => o.id === body.order_id);
        if (order.total_money.amount !== body.amount_money.amount) return json(400, { errors: [{ detail: 'amount mismatch' }] });
      }
      const pay = { id: `PAY${++seq}`, ...body };
      w.payments.push(pay);
      return json(200, { payment: pay });
    }
    return json(404, { errors: [{ detail: `unhandled ${p}` }] });
  };
  return w;
}

function install(world) {
  process.env.SQUARE_ACCESS_TOKEN = 'tok';
  process.env.SQUARE_LOCATION_ID = 'LOC1';
  process.env.SQUARE_ENVIRONMENT = 'sandbox';
  process.env.GITHUB_TOKEN = 'gh';
  global.fetch = world.fetch;
}

const variation = (id, name, cents, sku, extra = {}) => ({ type: 'ITEM_VARIATION', id, version: 3, item_variation_data: { item_id: 'x', name, pricing_type: 'FIXED_PRICING', price_money: { amount: cents, currency: 'USD' }, ...(sku ? { sku } : {}), ...extra } });
const item = (id, name, variations) => ({ type: 'ITEM', id, version: 5, item_data: { name, variations: variations.map((v) => ({ ...v, item_variation_data: { ...v.item_variation_data, item_id: id } })) } });

module.exports = { makeWorld, install, variation, item };
