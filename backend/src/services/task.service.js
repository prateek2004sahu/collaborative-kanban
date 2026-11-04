/**
 * Task service - all task business logic lives here.
 *
 * Concurrency model:
 *   1. Optimistic locking: every task has `version`. Writers send the version
 *      they last saw; if it changed, we answer 409 Conflict (+ the latest task).
 *   2. Pessimistic board lock for ORDERING: any operation that changes task
 *      positions first takes `SELECT ... FOR UPDATE` on the board row. This
 *      serialises concurrent reorders of the same board, so positions never
 *      end up duplicated or gapped. (Different boards never block each other.)
 *   3. Everything runs inside one DB transaction (all-or-nothing).
 */
const { withTransaction, query } = require('../config/database');
const { badRequest, notFound, forbidden, conflict } = require('../utils/httpError');
const { getTenantAccess, ROLE_RANK } = require('./access.service');
const activity = require('./activity.service');

// SQL column list -> camelCase JSON
const COLS = `id, board_id AS "boardId", column_id AS "columnId", tenant_id AS "tenantId", title, description,
  assigned_to AS "assignedTo", created_by AS "createdBy", priority, due_date AS "dueDate", labels,
  position, version, created_at AS "createdAt", updated_at AS "updatedAt"`;

async function listByBoard(tenantId, boardId) {
  const { rows } = await query(
    `SELECT ${COLS} FROM tasks WHERE tenant_id=$1 AND board_id=$2 ORDER BY column_id, position`, [tenantId, boardId]);
  return rows;
}

async function getOne(tenantId, id, db = { query }) {
  const { rows } = await db.query(`SELECT ${COLS} FROM tasks WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  return rows[0] || null;
}

/** Assignee must belong to the SAME tenant (directly or via org admin). */
async function assertAssignee(db, tenantId, userId) {
  if (!userId) return;
  const access = await getTenantAccess(userId, tenantId, db);
  if (!access) throw badRequest('Assignee does not belong to this tenant');
}

async function lockBoard(db, tenantId, boardId) {
  const { rows } = await db.query(`SELECT id FROM boards WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [boardId, tenantId]);
  if (!rows.length) throw notFound('Board not found');
}

async function assertColumn(db, tenantId, boardId, columnId) {
  const { rows } = await db.query(
    `SELECT id FROM columns WHERE id=$1 AND board_id=$2 AND tenant_id=$3`, [columnId, boardId, tenantId]);
  if (!rows.length) throw badRequest('Column does not belong to this board');
}

/** Rewrite positions of a list of task ids to 0..n-1 (one statement). */
async function writePositions(db, tenantId, ids) {
  if (!ids.length) return;
  await db.query(
    `UPDATE tasks t SET position = v.pos
       FROM unnest($1::uuid[], $2::int[]) AS v(id, pos)
      WHERE t.id = v.id AND t.tenant_id = $3`,
    [ids, ids.map((_, i) => i), tenantId]
  );
}

async function create(tenant, user, input) {
  return withTransaction(async (db) => {
    await lockBoard(db, tenant.id, input.boardId);
    await assertColumn(db, tenant.id, input.boardId, input.columnId);
    await assertAssignee(db, tenant.id, input.assignedTo);
    const { rows: [{ next }] } = await db.query(
      `SELECT COALESCE(MAX(position)+1, 0) AS next FROM tasks WHERE column_id=$1 AND tenant_id=$2`, [input.columnId, tenant.id]);
    const { rows } = await db.query(
      `INSERT INTO tasks (board_id, column_id, tenant_id, title, description, assigned_to, created_by, priority, due_date, labels, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLS}`,
      [input.boardId, input.columnId, tenant.id, input.title, input.description || '', input.assignedTo || null,
       user.id, input.priority || 'medium', input.dueDate || null, input.labels || [], next]
    );
    const task = rows[0];
    const act = await activity.log(db, { tenantId: tenant.id, user, entityType: 'task', entityId: task.id, action: 'created', details: { title: task.title } });
    return { task, activity: act };
  });
}

const EDITABLE = ['title', 'description', 'assignedTo', 'priority', 'dueDate', 'labels'];
const DB_FIELD = { title: 'title', description: 'description', assignedTo: 'assigned_to', priority: 'priority', dueDate: 'due_date', labels: 'labels' };

async function update(tenant, user, id, input) {
  return withTransaction(async (db) => {
    const { rows } = await db.query(`SELECT ${COLS} FROM tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenant.id]);
    if (!rows.length) throw notFound('Task not found (it may have been deleted)');
    const current = rows[0];
    if (current.version !== input.version) {
      throw conflict('Task was modified by someone else', { current });
    }
    if (input.assignedTo !== undefined) await assertAssignee(db, tenant.id, input.assignedTo);

    const sets = []; const params = []; const changes = {};
    for (const f of EDITABLE) {
      if (input[f] === undefined) continue;
      if (JSON.stringify(input[f]) === JSON.stringify(current[f])) continue; // unchanged
      params.push(input[f]); sets.push(`${DB_FIELD[f]} = $${params.length}`);
      changes[f] = { from: current[f], to: input[f] };
    }
    if (!sets.length) return { task: current, activity: null };

    params.push(id, tenant.id);
    const { rows: [task] } = await db.query(
      `UPDATE tasks SET ${sets.join(', ')}, version = version + 1, updated_at = now()
        WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING ${COLS}`, params);
    const act = await activity.log(db, { tenantId: tenant.id, user, entityType: 'task', entityId: id, action: 'updated', details: { title: task.title, changes } });
    return { task, activity: act };
  });
}

/**
 * Move a task to (columnId, index). Server decides the final ordering.
 * Returns every task in the affected columns so clients can reconcile.
 */
async function move(tenant, user, id, { columnId, index, version }) {
  return withTransaction(async (db) => {
    // Lock order is ALWAYS board -> task, so two transactions can't deadlock.
    const peek = await getOne(tenant.id, id, db);
    if (!peek) throw notFound('Task not found (it may have been deleted)');
    await lockBoard(db, tenant.id, peek.boardId);

    const { rows } = await db.query(`SELECT ${COLS} FROM tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenant.id]);
    if (!rows.length) throw notFound('Task not found (it may have been deleted)');
    const task = rows[0];
    if (task.version !== version) throw conflict('Task was moved/edited by someone else', { current: task });
    await assertColumn(db, tenant.id, task.boardId, columnId);

    const fromColumnId = task.columnId;
    const { rows: destRows } = await db.query(
      `SELECT id FROM tasks WHERE column_id=$1 AND tenant_id=$2 AND id <> $3 ORDER BY position, created_at`, [columnId, tenant.id, id]);
    const destIds = destRows.map((r) => r.id);
    const at = Math.max(0, Math.min(index, destIds.length));
    const fromIndex = fromColumnId === columnId
      ? (await db.query(`SELECT position FROM tasks WHERE id=$1`, [id])).rows[0].position : null;
    if (fromColumnId === columnId && fromIndex === at) return { task, tasks: [task], activity: null, noop: true };

    destIds.splice(at, 0, id);
    await db.query(`UPDATE tasks SET column_id=$1, version=version+1, updated_at=now() WHERE id=$2 AND tenant_id=$3`, [columnId, id, tenant.id]);
    await writePositions(db, tenant.id, destIds);

    if (fromColumnId !== columnId) {
      const { rows: srcRows } = await db.query(
        `SELECT id FROM tasks WHERE column_id=$1 AND tenant_id=$2 ORDER BY position, created_at`, [fromColumnId, tenant.id]);
      await writePositions(db, tenant.id, srcRows.map((r) => r.id));
    }

    const { rows: tasks } = await db.query(
      `SELECT ${COLS} FROM tasks WHERE tenant_id=$1 AND column_id = ANY($2::uuid[]) ORDER BY column_id, position`,
      [tenant.id, [...new Set([columnId, fromColumnId])]]);
    const moved = tasks.find((t) => t.id === id);
    const names = await db.query(`SELECT id, name FROM columns WHERE id = ANY($1::uuid[])`, [[columnId, fromColumnId]]);
    const nm = Object.fromEntries(names.rows.map((r) => [r.id, r.name]));
    const act = await activity.log(db, {
      tenantId: tenant.id, user, entityType: 'task', entityId: id, action: 'moved',
      details: { title: moved.title, fromColumn: nm[fromColumnId], toColumn: nm[columnId], fromColumnId, toColumnId: columnId },
    });
    return { task: moved, tasks, activity: act, fromColumnId };
  });
}

async function remove(tenant, user, id) {
  return withTransaction(async (db) => {
    const peek = await getOne(tenant.id, id, db);
    if (!peek) throw notFound('Task not found');
    await lockBoard(db, tenant.id, peek.boardId);
    const { rows } = await db.query(`SELECT ${COLS} FROM tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenant.id]);
    if (!rows.length) throw notFound('Task not found');
    const task = rows[0];
    // Members may delete only their own tasks; admins may delete any.
    if (ROLE_RANK[tenant.role] < ROLE_RANK.tenant_admin && task.createdBy !== user.id) {
      throw forbidden('Members can only delete tasks they created');
    }
    await db.query(`DELETE FROM tasks WHERE id=$1 AND tenant_id=$2`, [id, tenant.id]);
    const { rows: left } = await db.query(
      `SELECT id FROM tasks WHERE column_id=$1 AND tenant_id=$2 ORDER BY position, created_at`, [task.columnId, tenant.id]);
    await writePositions(db, tenant.id, left.map((r) => r.id));
    const { rows: tasks } = await db.query(`SELECT ${COLS} FROM tasks WHERE column_id=$1 AND tenant_id=$2 ORDER BY position`, [task.columnId, tenant.id]);
    const act = await activity.log(db, { tenantId: tenant.id, user, entityType: 'task', entityId: id, action: 'deleted', details: { title: task.title } });
    return { task, tasks, activity: act };
  });
}

module.exports = { listByBoard, getOne, create, update, move, remove };
