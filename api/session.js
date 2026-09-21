const { isAuthed } = require('../lib/portal');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ authed: isAuthed(req) });
};
