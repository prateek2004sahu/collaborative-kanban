/**
 * Tenant isolation middleware.
 * The browser says WHICH tenant it wants (X-Tenant-Id header or :id param),
 * but we never trust that: we look up the user's memberships in the DB and
 * only continue if they truly have access. The result (tenant id + effective
 * role) is stored on req.tenant, and every later query uses req.tenant.id.
 */
const { getTenantAccess, ROLE_RANK, isUuid } = require('../services/access.service');
const { badRequest, forbidden } = require('../utils/httpError');

async function load(req, tenantId, minRole) {
  if (!isUuid(tenantId)) throw badRequest('A valid tenant id is required');
  const access = await getTenantAccess(req.user.id, tenantId);
  if (!access) throw forbidden('You do not have access to this tenant');
  if (minRole && ROLE_RANK[access.role] < ROLE_RANK[minRole]) throw forbidden(`Requires ${minRole} role`);
  req.tenant = { id: tenantId, organizationId: access.organizationId, role: access.role };
}

/** Tenant from the X-Tenant-Id header. Optional minimum role. */
const tenantScope = (minRole) => (req, _res, next) =>
  load(req, req.headers['x-tenant-id'], minRole).then(() => next(), next);

/** Tenant from the :id route param (used by /api/tenants/:id/...). */
const tenantParam = (minRole) => (req, _res, next) =>
  load(req, req.params.id, minRole).then(() => next(), next);

module.exports = { tenantScope, tenantParam };
