const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { unauthorized } = require('../utils/httpError');

const sign = (user) => jwt.sign({ sub: user.id, name: user.name, email: user.email }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
const verifyToken = (token) => {
  const p = jwt.verify(token, env.jwtSecret);
  return { id: p.sub, name: p.name, email: p.email };
};

/** Requires "Authorization: Bearer <jwt>" and sets req.user */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try { req.user = verifyToken(token); next(); } catch { next(unauthorized('Invalid or expired token')); }
}

module.exports = { authenticate, sign, verifyToken };
