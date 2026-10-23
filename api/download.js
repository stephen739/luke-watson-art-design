const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const content = require('../content.json');
const { verifyDownloadToken, catalog } = require('../lib/checkout');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.pdf': 'application/pdf', '.zip': 'application/zip' };

// Name the customer sees when the file lands in their Downloads folder.
const downloadName = (artwork, ext) => {
  const given = String(artwork.digitalFileName || '').replace(/[^A-Za-z0-9._ -]/g, '').trim();
  return given && path.extname(given).toLowerCase() === ext ? given : `${artwork.id}${ext}`;
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const claim = verifyDownloadToken(req.query?.token);
  if (!claim) return res.status(403).json({ error: 'This download link has expired. Please contact Luke for a new one.' });

  const artwork = catalog(content).find((a) => a.id === claim.artworkId);
  if (!artwork?.digitalFile) return res.status(404).json({ error: 'File not found.' });

  // Masters uploaded through the portal live in private Blob storage and are streamed through here,
  // so the storage address is never exposed and large files don't hit the function size limit.
  if (artwork.digitalFile.startsWith('blob:')) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Downloads are temporarily unavailable. Please contact Luke.' });
    const pathname = artwork.digitalFile.slice('blob:'.length);
    const ext = path.extname(pathname).toLowerCase();
    let result;
    try {
      const { get } = require('@vercel/blob');
      result = await get(pathname, { access: 'private' });
    } catch (e) {
      console.error('download: blob read failed', e?.message);
      return res.status(502).json({ error: 'Could not fetch the file right now. Please try again in a moment.' });
    }
    if (!result || result.statusCode !== 200 || !result.stream) return res.status(404).json({ error: 'File not found.' });
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    if (result.blob?.size) res.setHeader('Content-Length', String(result.blob.size));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName(artwork, ext)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200);
    try {
      await pipeline(Readable.fromWeb(result.stream), res);
    } catch (e) {
      console.error('download: stream interrupted', e?.message);
    }
    return;
  }

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
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName(artwork, ext)}"`);
  return res.status(200).send(data);
};
