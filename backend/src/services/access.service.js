/**
 * Access service = the single source of truth for "who can see which tenant".
 * Every middleware / route / socket handler uses these functions, so tenant
 * isolation is enforced in ONE place.
 */
const { query } = require('../config/database');

const ROLE_RANK = { member: 1, tenant_admin: 2, org_admin: 3 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const maxRole = (a, b) => (!a ? b : !b ? a : ROLE_RANK[a] >= ROLE_RANK[b] ? a : b);

/**
 * Effective role of a user inside ONE tenant.
 * A user has access if they have:
 *   - a membership on that tenant, OR
 *   - an org-level (org_admin) membership on the tenant's organization.
 * Returns { organizationId, role } or null.   `db` may be a transaction client.
 */
async function getTenantAccess(userId, tenantId, db = { query }) {
  if (!isUuid(tenantId) || !isUuid(userId)) return null;
  const { rows } = await db.query(
    `SELECT t.organization_id, m.role
       FROM tenants t
       JOIN memberships m
         ON m.user_id = $1
        AND m.organization_id = t.organization_id
        AND (m.tenant_id = t.id OR m.tenant_id IS NULL)
      WHERE t.id = $2`,
    [userId, tenantId]
  );
  if (!rows.length) return null;
  return {
    organizationId: rows[0].organization_id,
    role: rows.reduce((best, r) => maxRole(best, r.role), null),
  };
}

/** Is the user an org_admin of this organization? */
async function isOrgAdmin(userId, orgId, db = { query }) {
  if (!isUuid(orgId) || !isUuid(userId)) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2 AND tenant_id IS NULL AND role='org_admin'`,
    [userId, orgId]
  );
  return rows.length > 0;
}

/** Does the user have ANY membership in this organization? */
async function hasOrgAccess(userId, orgId) {
  if (!isUuid(orgId)) return false;
  const { rows } = await query(`SELECT 1 FROM memberships WHERE user_id=$1 AND organization_id=$2 LIMIT 1`, [userId, orgId]);
  return rows.length > 0;
}

/** All organizations + tenants a user may see, with their effective role per tenant. */
async function listWorkspaces(userId) {
  const { rows } = await query(
    `SELECT o.id AS org_id, o.name AS org_name, t.id AS tenant_id, t.name AS tenant_name, m.role,
            (m.tenant_id IS NULL) AS org_level
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       JOIN tenants t ON t.organization_id = o.id AND (m.tenant_id IS NULL OR m.tenant_id = t.id)
      WHERE m.user_id = $1
      ORDER BY o.name, t.name`,
    [userId]
  );
  const orgs = new Map();
  for (const r of rows) {
    if (!orgs.has(r.org_id)) orgs.set(r.org_id, { id: r.org_id, name: r.org_name, isOrgAdmin: false, tenants: new Map() });
    const org = orgs.get(r.org_id);
    if (r.org_level) org.isOrgAdmin = true;
    const prev = org.tenants.get(r.tenant_id);
    org.tenants.set(r.tenant_id, { id: r.tenant_id, name: r.tenant_name, role: maxRole(prev && prev.role, r.role) });
  }
  // Org admins of an org with ZERO tenants still need to see the org
  const empty = await query(
    `SELECT o.id, o.name FROM memberships m JOIN organizations o ON o.id=m.organization_id
      WHERE m.user_id=$1 AND m.tenant_id IS NULL`, [userId]);
  for (const o of empty.rows) {
    if (!orgs.has(o.id)) orgs.set(o.id, { id: o.id, name: o.name, isOrgAdmin: true, tenants: new Map() });
  }
  return [...orgs.values()].map((o) => ({ ...o, tenants: [...o.tenants.values()] }));
}

module.exports = { ROLE_RANK, isUuid, getTenantAccess, isOrgAdmin, hasOrgAccess, listWorkspaces, maxRole };
