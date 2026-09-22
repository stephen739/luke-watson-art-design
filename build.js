const fs = require('fs');
const path = require('path');
const { esc, validateContent } = require('./lib/schema');

const root = __dirname;
const dist = path.join(root, 'dist');

const content = validateContent(JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8')));
const t = content.text;

const MAX_QTY = 10;

function optionRow({ artworkId, title, option, label, price, sold, qtyId }) {
  if (sold) {
    // Originals are one-of-one — once sold there's nothing left to add to cart for this option.
    return `
          <div class="art-option opt-row-sold">
            <span class="opt-info"><span class="opt-label">${esc(label)}</span><span class="opt-price opt-price-sold">${esc(price)} <span class="sold-note">(Sold)</span></span></span>
          </div>`;
  }
  const button = `<button type="button" class="opt-buy add-to-cart" data-artwork="${esc(artworkId)}" data-option="${esc(option)}" data-title="${esc(title)}" data-label="${esc(label)}"${qtyId ? ` data-qty-id="${esc(qtyId)}"` : ''}>Add to Cart</button>`;
  const qty = qtyId
    ? `<label class="opt-qty-label" for="${esc(qtyId)}"><span class="sr-only">Quantity</span>
            <select class="opt-qty" id="${esc(qtyId)}">${Array.from({ length: MAX_QTY }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label>`
    : '';
  return `
          <div class="art-option">
            <span class="opt-info"><span class="opt-label">${esc(label)}</span><span class="opt-price">${esc(price)}</span></span>
            <span class="opt-actions">${qty}${button}</span>
          </div>`;
}

function renderArtwork(a) {
  const options = [
    optionRow({ artworkId: a.id, title: a.title, option: 'canvas', label: 'Original Canvas', price: a.canvasPrice, sold: a.sold }),
    optionRow({ artworkId: a.id, title: a.title, option: 'print', label: 'Print', price: a.printPrice, qtyId: `qty-${a.id}-print` }),
    optionRow({ artworkId: a.id, title: a.title, option: 'digital', label: 'Digital Download', price: a.digitalPrice }),
  ].join('');
  const multi = a.images.length > 1;
  const nav = multi
    ? `
          <button type="button" class="art-nav prev" aria-label="Previous photo">‹</button>
          <button type="button" class="art-nav next" aria-label="Next photo">›</button>
          <span class="art-count" data-count>1 / ${a.images.length}</span>`
    : '';
  return `
      <article class="art-card reveal">
        <div class="art-visual"${multi ? ` data-images='${JSON.stringify(a.images).replace(/'/g, '&#39;')}' tabindex="0" role="button" aria-label="${esc(`View photos of ${a.title}`)}"` : ''}>
          <img class="art-photo" src="${esc(a.images[0])}" alt="${esc(`Original artwork: ${a.title}`)}" loading="lazy">${a.sold ? '\n          <span class="sold-badge">Sold</span>' : ''}${nav}
        </div>
        <div class="art-body">
          <h3>${esc(a.title)}</h3>
          ${a.blurb ? `<p class="art-blurb">${esc(a.blurb)}</p>` : ''}
          ${a.meta ? `<p class="art-meta">${esc(a.meta)}</p>` : ''}
          <div class="art-options">${options}
          </div>
        </div>
      </article>`;
}

let html = fs.readFileSync(path.join(root, 'template.html'), 'utf8');

const blocks = {
  '<!--HERO_TAGS-->': [t.hero_tag_1, t.hero_tag_2, t.hero_tag_3].filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join('\n      '),
  '<!--ABOUT_BADGES-->': [t.about_badge_1, t.about_badge_2, t.about_badge_3].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('\n        '),
  '<!--ABOUT_PARAGRAPHS-->': [t.about_p1, t.about_p2, t.about_p3]
    .filter(Boolean)
    .map((x, i) => `<p class="reveal"${i === 0 ? ' style="margin-top:22px;"' : ''}>${esc(x)}</p>`)
    .join('\n      '),
  '<!--ARTWORKS-->': content.artworks.length
    ? content.artworks.map(renderArtwork).join('\n')
    : '<p class="art-empty">New work is on the way — check back soon.</p>',
  '<!--NOTE-->': t.art_note
    ? `<div class="square-note reveal">\n      <span>🔒</span>\n      <span>${esc(t.art_note)}</span>\n    </div>`
    : '',
  '<!--SQUARE_CONFIG-->': (() => {
    const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
    const sdkUrl = environment === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js';
    const config = {
      applicationId: process.env.SQUARE_APPLICATION_ID || '',
      locationId: process.env.SQUARE_LOCATION_ID || '',
      environment,
    };
    return `<script>window.LW_SQUARE = ${JSON.stringify(config)};</script>\n<script src="${sdkUrl}"></script>`;
  })(),
};
for (const [marker, value] of Object.entries(blocks)) {
  if (!html.includes(marker)) throw new Error(`Template is missing ${marker}`);
  html = html.replace(marker, () => value);
}

html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in t)) throw new Error(`Template uses unknown text key "${key}"`);
  return esc(t[key]);
});

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.cpSync(path.join(root, 'images'), path.join(dist, 'images'), { recursive: true });
fs.cpSync(path.join(root, 'admin'), path.join(dist, 'admin'), { recursive: true });
console.log(`Built site: ${content.artworks.length} artworks`);
