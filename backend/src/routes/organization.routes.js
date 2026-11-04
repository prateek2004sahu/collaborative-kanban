const router = require('express').Router();
const { z } = require('zod');
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound, forbidden, badRequest } = require('../utils/httpError');
const { listWorkspaces, hasOrgAccess, isOrgAdmin } = require('../services/access.service');

router.use(authenticate);

const nameSchema = z.object({ name: z.string().trim().min(1).max(150) });

// Create an organization -> the creator becomes its Org Admin
router.post('/', validate(nameSchema), asyncHandler(async (req, res) => {
  const org = await withTransaction(async (db) => {
    const { rows: [o] } = await db.query('INSERT INTO organizations (name) VALUES ($1) RETURNING *', [req.body.name]);
    await db.query(`INSERT INTO memberships (user_id, organization_id, tenant_id, role) VALUES ($1,$2,NULL,'org_admin')`, [req.user.id, o.id]);
    return o;
  });
  res.status(201).json(org);
}));

// Only organizations the user belongs to
router.get('/', asyncHandler(async (req, res) => res.json(await listWorkspaces(req.user.id))));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!(await hasOrgAccess(req.user.id, req.params.id))) throw notFound('Organization not found');
  const { rows } = await query('SELECT * FROM organizations WHERE id=$1', [req.params.id]);
  res.json(rows[0]);
}));

router.put('/:id', validate(nameSchema), asyncHandler(async (req, res) => {
  if (!(await hasOrgAccess(req.user.id, req.params.id))) throw notFound('Organization not found');
  if (!(await isOrgAdmin(req.user.id, req.params.id))) throw forbidden('Org Admin only');
  const { rows } = await query('UPDATE organizations SET name=$1, updated_at=now() WHERE id=$2 RETURNING *', [req.body.name, req.params.id]);
  res.json(rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await hasOrgAccess(req.user.id, req.params.id))) throw notFound('Organization not found');
  if (!(await isOrgAdmin(req.user.id, req.params.id))) throw forbidden('Org Admin only');
  await query('DELETE FROM organizations WHERE id=$1', [req.params.id]); // cascades to everything below
  res.status(204).end();
}));

// ---- Org-level admins ----
router.get('/:id/members', asyncHandler(async (req, res) => {
  if (!(await isOrgAdmin(req.user.id, req.params.id))) throw forbidden('Org Admin only');
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.tenant_id IS NULL ORDER BY u.name`, [req.params.id]);
  res.json(rows);
}));

router.post('/:id/members', validate(z.object({ email: z.string().trim().toLowerCase().email() })), asyncHandler(async (req, res) => {
  if (!(await isOrgAdmin(req.user.id, req.params.id))) throw forbidden('Org Admin only');
  const u = await query('SELECT id,name,email FROM users WHERE email=$1', [req.body.email]);
  if (!u.rowCount) throw badRequest('No registered user with that email');
  await query(
    `INSERT INTO memberships (user_id, organization_id, tenant_id, role) VALUES ($1,$2,NULL,'org_admin')
     ON CONFLICT DO NOTHING`, [u.rows[0].id, req.params.id]);
  res.status(201).json({ ...u.rows[0], role: 'org_admin' });
}));

module.exports = router;
