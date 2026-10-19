// Hands the portal a short-lived token so the browser can upload print-ready masters straight into
// PRIVATE Vercel Blob storage (files are far bigger than a serverless request body allows).
const { handleUpload } = require('@vercel/blob/client');
const { reject } = require('../lib/portal');
const { DIGITAL_EXT } = require('../lib/schema');

const MAX_BYTES = 250 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'application/pdf', 'application/zip', 'application/x-zip-compressed'];
const PATH_RE = new RegExp(`^digital/[A-Za-z0-9._-]{1,100}\\.(${DIGITAL_EXT})$`, 'i');

module.exports = async (req, res) => {
  // Lets the portal show whether file storage is connected before anyone tries to upload.
  if (req.method === 'GET') {
    if (reject(req, res, { method: 'GET' })) return;
    return res.status(200).json({ configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN), maxBytes: MAX_BYTES });
  }

  const body = req.body || {};
  // Token requests come from the signed-in portal. Vercel's own "upload completed" callback is signed
  // and verified inside handleUpload, so it can't carry the admin cookie.
  if (body.type === 'blob.generate-client-token') {
    if (reject(req, res, { method: 'POST' })) return;
  } else if (req.method === 'POST' && body.type === 'blob.upload-completed') {
    res.setHeader('Cache-Control', 'no-store');
  } else {
    res.setHeader('Allow', 'GET, POST');
    return res.status(req.method === 'POST' ? 400 : 405).json({ error: 'Not supported' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Private file storage is not connected yet. Add a Blob store to the Vercel project first.' });
  }

  try {
    const out = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!PATH_RE.test(pathname)) throw new Error('Unsupported file name or type. Use JPG, PNG, TIFF, PDF or ZIP.');
        return { allowedContentTypes: ALLOWED_TYPES, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true, allowOverwrite: false };
      },
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(out);
  } catch (e) {
    console.error('digital-upload failed:', e?.message);
    return res.status(400).json({ error: e?.message || 'Upload could not be started.' });
  }
};
