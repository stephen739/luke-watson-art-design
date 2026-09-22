const fs = require('fs');
const path = require('path');
const { esc, validateContent } = require('./lib/schema');

const root = __dirname;
const dist = path.join(root, 'dist');

const content = validateContent(JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8')));
const t = content.text;

function renderArtwork(a) {
  const button = a.sold
    ? '<span class="btn btn-sold">Sold</span>'
    : a.buyUrl
      ? `<a href="${esc(a.buyUrl)}" target="_blank" rel="noopener" class="btn btn-primary">Purchase Now</a>`
      : '<a href="#" class="btn btn-primary dead-link" onclick="return false;">Purchase Now</a>';
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
          ${a.price ? `<p class="art-price">${esc(a.price)}</p>` : ''}
          <div class="art-actions">
            ${button}
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
