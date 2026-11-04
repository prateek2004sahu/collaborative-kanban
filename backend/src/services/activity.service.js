const { query } = require('../config/database');

const map = (r) => ({
  id: r.id, tenantId: r.tenant_id, userId: r.user_id, userName: r.user_name || null,
  entityType: r.entity_type, entityId: r.entity_id, action: r.action, details: r.details, createdAt: r.created_at,
});

/** Insert an activity row (pass the transaction client so it commits/rolls back with the change). */
async function log(db, { tenantId, user, entityType, entityId, action, details = {} }) {
  const { rows } = await db.query(
    `INSERT INTO activity_logs (tenant_id, user_id, entity_type, entity_id, action, details)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenantId, user.id, entityType, entityId, action, JSON.stringify(details)]
  );
  return map({ ...rows[0], user_name: user.name });
}

async function list(tenantId, { limit = 50, entityId = null } = {}) {
  const { rows } = await query(
    `SELECT a.*, u.name AS user_name FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = $1 AND ($2::uuid IS NULL OR a.entity_id = $2)
      ORDER BY a.created_at DESC, a.id LIMIT $3`,
    [tenantId, entityId, Math.min(Number(limit) || 50, 200)]
  );
  return rows.map(map);
}

module.exports = { log, list };
