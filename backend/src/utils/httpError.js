/** An error that carries an HTTP status code. */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const badRequest = (m, e) => new HttpError(400, m, e);
const unauthorized = (m = 'Not authenticated') => new HttpError(401, m);
const forbidden = (m = 'Forbidden') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);
const conflict = (m, e) => new HttpError(409, m, e);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
