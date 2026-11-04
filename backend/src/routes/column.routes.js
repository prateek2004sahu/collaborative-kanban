const router = require('express').Router();
const { z } = require('zod');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenant');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/httpError');
const activity = require('../services/activity.service');
const { emitToTenant } = require('../realtime');

router.use(authenticate, tenantScope('tenant_admin')); // columns are managed by Tenant Admins / Org Admins

async function boardColumns(db, tenantId, boardId) {
  const { rows } = await db.query('SELECT * FROM columns WHERE board_id=$1 AND tenant_id=$2 ORDER BY position', [boardId, tenantId]);
  return rows;
}
const broadcast = (tenantId, boardId, columns, act) => {
  emitToTenant(tenantId, 'column:updated', { boardId, columns });
  if (act) emitToTenant(tenantId, 'activity:created', { activity: act });
};

router.post('/', validate(z.object({ boardId: z.string().uuid(), name: z.string().trim().min(1).max(100) })), asyncHandler(async (req, res) => {
  const out = await withTransaction(async (db) => {
    const b = await db.query('SELECT id FROM boards WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.body.boardId, req.tenant.id]);
    if (!b.rowCount) throw notFound('Board not found');
    const { rows: [{ next }] } = await db.query('SELECT COALESCE(MAX(position)+1,0) AS next FROM columns WHERE board_id=$1', [req.body.boardId]);
    const { rows: [col] } = await db.query(
      'INSERT INTO columns (board_id, tenant_id, name, position) VALUES ($1,$2,$3,$4) RETURNING *', [req.body.boardId, req.tenant.id, req.body.name, next]);
    const act = await activity.log(db, { tenantId: req.tenant.id, user: req.user, entityType: 'column', entityId: col.id, action: 'created', details: { name: col.name } });
    return { col, act, columns: await boardColumns(db, req.tenant.id, req.body.boardId) };
  });
  broadcast(req.tenant.id, out.col.board_id, out.columns, out.act);
  res.status(201).json(out.col);
}));

router.put('/:id', validate(z.object({ name: z.string().trim().min(1).max(100).optional(), position: z.number().int().min(0).optional() })),
  asyncHandler(async (req, res) => {
    const out = await withTransaction(async (db) => {
      const { rows } = await db.query('SELECT * FROM columns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!rows.length) throw notFound('Column not found');
      const col = rows[0];
      await db.query('SELECT id FROM boards WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [col.board_id, req.tenant.id]);
      if (req.body.name) await db.query('UPDATE columns SET name=$1 WHERE id=$2 AND tenant_id=$3', [req.body.name, col.id, req.tenant.id]);
      if (req.body.position !== undefined) {
        const ids = (await boardColumns(db, req.tenant.id, col.board_id)).map((c) => c.id).filter((i) => i !== col.id);
        ids.splice(Math.min(req.body.position, ids.length), 0, col.id);
        await db.query(`UPDATE columns c SET position=v.pos FROM unnest($1::uuid[],$2::int[]) AS v(id,pos) WHERE c.id=v.id AND c.tenant_id=$3`,
          [ids, ids.map((_, i) => i), req.tenant.id]);
      }
      const columns = await boardColumns(db, req.tenant.id, col.board_id);
      const act = await activity.log(db, { tenantId: req.tenant.id, user: req.user, entityType: 'column', entityId: col.id, action: 'updated', details: { name: req.body.name || col.name } });
      return { col: columns.find((c) => c.id === col.id), columns, act, boardId: col.board_id };
    });
    broadcast(req.tenant.id, out.boardId, out.columns, out.act);
    res.json(out.col);
  }));

router.delete('/:id', asyncHandler(async (req, res) => {
  const out = await withTransaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM columns WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
    if (!rows.length) throw notFound('Column not found');
    const col = rows[0];
    await db.query('SELECT id FROM boards WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [col.board_id, req.tenant.id]);
    await db.query('DELETE FROM columns WHERE id=$1 AND tenant_id=$2', [col.id, req.tenant.id]); // tasks cascade
    const ids = (await boardColumns(db, req.tenant.id, col.board_id)).map((c) => c.id);
    await db.query(`UPDATE columns c SET position=v.pos FROM unnest($1::uuid[],$2::int[]) AS v(id,pos) WHERE c.id=v.id AND c.tenant_id=$3`,
      [ids, ids.map((_, i) => i), req.tenant.id]);
    const act = await activity.log(db, { tenantId: req.tenant.id, user: req.user, entityType: 'column', entityId: col.id, action: 'deleted', details: { name: col.name } });
    return { columns: await boardColumns(db, req.tenant.id, col.board_id), act, boardId: col.board_id, columnId: col.id };
  });
  broadcast(req.tenant.id, out.boardId, out.columns, out.act);
  emitToTenant(req.tenant.id, 'column:deleted', { boardId: out.boardId, columnId: out.columnId });
  res.status(204).end();
}));

module.exports = router;
