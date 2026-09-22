const fs = require('fs/promises');
const path = require('path');
const content = require('../content.json');
const { verifyDownloadToken } = require('../lib/checkout');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.zip': 'application/zip' };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const claim = verifyDownloadToken(req.query?.token);
  if (!claim) return res.status(403).json({ error: 'This download link has expired. Please contact Luke for a new one.' });

  const artwork = content.artworks.find((a) => a.id === claim.artworkId);
  if (!artwork?.digitalFile) return res.status(404).json({ error: 'File not found.' });

  const filePath = path.join(process.cwd(), artwork.digitalFile);
  if (!filePath.startsWith(path.join(process.cwd(), 'digital-assets') + path.sep)) {
    return res.status(400).json({ error: 'Invalid file.' });
  }

  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return res.status(404).json({ error: 'File not found.' });
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${artwork.id}${ext}"`);
  return res.status(200).send(data);
};
