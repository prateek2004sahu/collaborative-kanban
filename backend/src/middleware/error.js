/** Central error handler: turns thrown errors into JSON responses. */
module.exports = (err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  // Postgres error codes
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid id format' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist or belongs to another tenant' });
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate value' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
