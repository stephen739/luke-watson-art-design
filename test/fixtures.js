// Pinned content so tests never depend on whatever the client has published.
module.exports = () => ({
  // Real, always-valid site text; only the catalog below is pinned.
  text: { ...require('../content.json').text, sales_tax_rate: '8.25' },
  artworks: [
    { id: 'coyote-53x', title: 'Coyote', canvasPrice: '$300', printPrice: '$30', digitalPrice: '$15', digitalFile: '', images: ['images/art/test.jpg'], category: 'Wildlife', blurb: '', meta: '', sold: false },
    { id: 'faces', title: 'Faces', canvasPrice: '$75', printPrice: '$20', digitalPrice: '$15', digitalFile: '', images: ['images/art/test.jpg'], category: 'Wildlife', blurb: '', meta: '', sold: false },
  ],
  photos: [
    { id: 'milky-way', title: 'Milky Way', prints: [{ id: 'p1', size: '8" x 12"', price: '$25' }, { id: 'p2', size: '16" x 24"', price: '$60' }], digitalPrice: '$15', images: ['images/art/test.jpg'], category: 'Astro', blurb: '', meta: '' },
  ],
  featured: [],
});
