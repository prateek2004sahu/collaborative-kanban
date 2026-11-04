/** validate(zodSchema) parses req.body and replaces it with the clean result. */
module.exports = (schema) => (req, _res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const e = new Error('Validation failed');
    e.status = 400;
    e.extra = { details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    return next(e);
  }
  req.body = r.data;
  next();
};
