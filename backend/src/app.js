const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const errorHandler = require('./middleware/error');
const { notFound } = require('./utils/httpError');

const app = express();
app.use(cors({ origin: env.clientOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/organizations', require('./routes/organization.routes'));
app.use('/api/tenants', require('./routes/tenant.routes'));
app.use('/api/boards', require('./routes/board.routes'));
app.use('/api/columns', require('./routes/column.routes'));
app.use('/api/tasks', require('./routes/task.routes'));
app.use('/api/activity', require('./routes/activity.routes'));

app.use((_req, _res, next) => next(notFound('Route not found')));
app.use(errorHandler);

module.exports = app;
