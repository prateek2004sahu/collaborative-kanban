const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { tenantParam } = require('../middleware/tenant');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound, forbidden, badRequest } = require('../utils/httpError');
const { listWorkspaces, isOrgAdmin, isUuid } = require('../services/access.service');
const { emitToTenant } = require('../realtime');

router.use(authenticate);

// Create a branch (Org Admin of that organization only)
router.post('/', validate(z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(1).max(150) })),
  asyncHandler(async (req, res) => {
    if (!(await isOrgAdmin(req.user.id, req.body.organizationId))) throw forbidden('Only an Org Admin can create tenants');
    const { rows } = await query('INSERT INTO tenants (organization_id, name) VALUES ($1,$2) RETURNING *', [req.body.organizationId, req.body.name]);
    res.status(201).json(rows[0]);
  }));

// Tenants the user may access (optionally of one organization)
router.get('/', asyncHandler(async (req, res) => {
  const orgs = await listWorkspaces(req.user.id);
  const wanted = req.query.organizationId;
  const out = [];
  for (const o of orgs) if (!wanted || o.id === wanted) for (const t of o.tenants) out.push({ ...t, organizationId: o.id });
  res.json(out);
}));

router.get('/:id', tenantParam(), asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM tenants WHERE id=$1', [req.params.id]);
  res.json({ ...rows[0], role: req.tenant.role });
}));

router.put('/:id', tenantParam('org_admin'), validate(z.object({ name: z.string().trim().min(1).max(150) })),
  asyncHandler(async (req, res) => {
    const { rows } = await query('UPDATE tenants SET name=$1, updated_at=now() WHERE id=$2 RETURNING *', [req.body.name, req.params.id]);
    res.json(rows[0]);
  }));

router.delete('/:id', tenantParam('org_admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM tenants WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

// ---------------- Tenant members ----------------
router.get('/:id/members', tenantParam(), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, m.role, (m.tenant_id IS NULL) AS "viaOrganization"
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1 AND (m.tenant_id = $2 OR m.tenant_id IS NULL)
      ORDER BY u.name`, [req.tenant.organizationId, req.params.id]);
  res.json(rows);
}));

const roleSchema = z.enum(['tenant_admin', 'member']); // org_admin is granted at organization level only

router.post('/:id/members', tenantParam('tenant_admin'),
  validate(z.object({ email: z.string().trim().toLowerCase().email(), role: roleSchema.default('member') })),
  asyncHandler(async (req, res) => {
    const u = await query('SELECT id,name,email FROM users WHERE email=$1', [req.body.email]);
    if (!u.rowCount) throw badRequest('No registered user with that email');
    await query(
      `INSERT INTO memberships (user_id, organization_id, tenant_id, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, tenant_id) WHERE tenant_id IS NOT NULL DO UPDATE SET role = EXCLUDED.role`,
      [u.rows[0].id, req.tenant.organizationId, req.params.id, req.body.role]);
    emitToTenant(req.params.id, 'members:updated', {});
    res.status(201).json({ ...u.rows[0], role: req.body.role });
  }));

router.patch('/:id/members/:userId', tenantParam('tenant_admin'), validate(z.object({ role: roleSchema })),
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.userId)) throw badRequest('Invalid user id');
    const r = await query(`UPDATE memberships SET role=$1 WHERE user_id=$2 AND tenant_id=$3`, [req.body.role, req.params.userId, req.params.id]);
    if (!r.rowCount) throw notFound('Membership not found');
    emitToTenant(req.params.id, 'members:updated', {});
    res.json({ ok: true });
  }));

router.delete('/:id/members/:userId', tenantParam('tenant_admin'), asyncHandler(async (req, res) => {
  if (!isUuid(req.params.userId)) throw badRequest('Invalid user id');
  const r = await query(`DELETE FROM memberships WHERE user_id=$1 AND tenant_id=$2`, [req.params.userId, req.params.id]);
  if (!r.rowCount) throw notFound('Membership not found');
  emitToTenant(req.params.id, 'members:updated', {});
  res.status(204).end();
}));

module.exports = router;
