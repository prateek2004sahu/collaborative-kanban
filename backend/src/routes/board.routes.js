const router = require('express').Router();
const { z } = require('zod');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenant');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/httpError');
const activity = require('../services/activity.service');
const tasks = require('../services/task.service');
const { emitToTenant } = require('../realtime');

router.use(authenticate);

const boardSchema = z.object({ name: z.string().trim().min(1).max(150), description: z.string().max(2000).optional() });
const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Testing', 'Done'];

async function getBoard(tenantId, id) {
  const { rows } = await query('SELECT * FROM boards WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
  if (!rows.length) throw notFound('Board not found');
  return rows[0];
}

router.post('/', tenantScope('tenant_admin'), validate(boardSchema), asyncHandler(async (req, res) => {
  const { board, columns, act } = await withTransaction(async (db) => {
    const { rows: [board] } = await db.query(
      `INSERT INTO boards (organization_id, tenant_id, name, description, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.tenant.organizationId, req.tenant.id, req.body.name, req.body.description || '', req.user.id]);
    const columns = [];
    for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
      const { rows } = await db.query(
        `INSERT INTO columns (board_id, tenant_id, name, position) VALUES ($1,$2,$3,$4) RETURNING *`,
        [board.id, req.tenant.id, DEFAULT_COLUMNS[i], i]);
      columns.push(rows[0]);
    }
    const act = await activity.log(db, { tenantId: req.tenant.id, user: req.user, entityType: 'board', entityId: board.id, action: 'created', details: { name: board.name } });
    return { board, columns, act };
  });
  emitToTenant(req.tenant.id, 'board:updated', { action: 'created', board });
  emitToTenant(req.tenant.id, 'activity:created', { activity: act });
  res.status(201).json({ ...board, columns });
}));

router.get('/', tenantScope(), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM boards WHERE tenant_id=$1 ORDER BY created_at', [req.tenant.id]);
  res.json(rows);
}));

/** Full board state (board + columns + tasks). Also used to re-sync after a reconnect. */
router.get('/:id', tenantScope(), asyncHandler(async (req, res) => {
  const board = await getBoard(req.tenant.id, req.params.id);
  const { rows: columns } = await query('SELECT * FROM columns WHERE board_id=$1 AND tenant_id=$2 ORDER BY position', [board.id, req.tenant.id]);
  res.json({ board, columns, tasks: await tasks.listByBoard(req.tenant.id, board.id) });
}));

router.get('/:id/columns', tenantScope(), asyncHandler(async (req, res) => {
  const board = await getBoard(req.tenant.id, req.params.id);
  const { rows } = await query('SELECT * FROM columns WHERE board_id=$1 AND tenant_id=$2 ORDER BY position', [board.id, req.tenant.id]);
  res.json(rows);
}));

router.put('/:id', tenantScope('tenant_admin'), validate(boardSchema), asyncHandler(async (req, res) => {
  await getBoard(req.tenant.id, req.params.id);
  const { rows } = await query(
    `UPDATE boards SET name=$1, description=COALESCE($2, description), updated_at=now() WHERE id=$3 AND tenant_id=$4 RETURNING *`,
    [req.body.name, req.body.description ?? null, req.params.id, req.tenant.id]);
  const act = await activity.log({ query }, { tenantId: req.tenant.id, user: req.user, entityType: 'board', entityId: rows[0].id, action: 'updated', details: { name: rows[0].name } });
  emitToTenant(req.tenant.id, 'board:updated', { action: 'updated', board: rows[0] });
  emitToTenant(req.tenant.id, 'activity:created', { activity: act });
  res.json(rows[0]);
}));

router.delete('/:id', tenantScope('tenant_admin'), asyncHandler(async (req, res) => {
  const board = await getBoard(req.tenant.id, req.params.id);
  await query('DELETE FROM boards WHERE id=$1 AND tenant_id=$2', [board.id, req.tenant.id]);
  const act = await activity.log({ query }, { tenantId: req.tenant.id, user: req.user, entityType: 'board', entityId: board.id, action: 'deleted', details: { name: board.name } });
  emitToTenant(req.tenant.id, 'board:updated', { action: 'deleted', board });
  emitToTenant(req.tenant.id, 'activity:created', { activity: act });
  res.status(204).end();
}));

module.exports = router;
