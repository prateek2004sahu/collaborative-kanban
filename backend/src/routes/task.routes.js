const router = require('express').Router();
const { z } = require('zod');
const { authenticate } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenant');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound, badRequest } = require('../utils/httpError');
const { isUuid } = require('../services/access.service');
const tasks = require('../services/task.service');
const { emitToTenant } = require('../realtime');

router.use(authenticate, tenantScope()); // any member of the tenant; finer rules are inside task.service

const fields = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(10000),
  assignedTo: z.string().uuid().nullable(),
  priority: z.enum(['low', 'medium', 'high']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable(),
  labels: z.array(z.string().trim().min(1).max(30)).max(10),
};
const createSchema = z.object({
  boardId: z.string().uuid(), columnId: z.string().uuid(), title: fields.title,
  description: fields.description.optional(), assignedTo: fields.assignedTo.optional(),
  priority: fields.priority.optional(), dueDate: fields.dueDate.optional(), labels: fields.labels.optional(),
});
const updateSchema = z.object({
  version: z.number().int().min(1),
  title: fields.title.optional(), description: fields.description.optional(), assignedTo: fields.assignedTo.optional(),
  priority: fields.priority.optional(), dueDate: fields.dueDate.optional(), labels: fields.labels.optional(),
});
const moveSchema = z.object({ columnId: z.string().uuid(), index: z.number().int().min(0), version: z.number().int().min(1) });

const checkId = (req) => { if (!isUuid(req.params.id)) throw badRequest('Invalid task id'); };

router.get('/', asyncHandler(async (req, res) => {
  if (!isUuid(req.query.boardId)) throw badRequest('boardId query parameter is required');
  res.json(await tasks.listByBoard(req.tenant.id, req.query.boardId));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  checkId(req);
  const t = await tasks.getOne(req.tenant.id, req.params.id);
  if (!t) throw notFound('Task not found'); // same answer for "doesn't exist" and "belongs to another tenant"
  res.json(t);
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const { task, activity } = await tasks.create(req.tenant, req.user, req.body);
  emitToTenant(req.tenant.id, 'task:created', { task, actorId: req.user.id });
  emitToTenant(req.tenant.id, 'activity:created', { activity });
  res.status(201).json(task);
}));

router.put('/:id', validate(updateSchema), asyncHandler(async (req, res) => {
  checkId(req);
  const { version, ...changes } = req.body;
  const { task, activity } = await tasks.update(req.tenant, req.user, req.params.id, { version, ...changes });
  if (activity) {
    emitToTenant(req.tenant.id, 'task:updated', { task, actorId: req.user.id });
    emitToTenant(req.tenant.id, 'activity:created', { activity });
  }
  res.json(task);
}));

router.patch('/:id/move', validate(moveSchema), asyncHandler(async (req, res) => {
  checkId(req);
  const r = await tasks.move(req.tenant, req.user, req.params.id, req.body);
  if (!r.noop) {
    emitToTenant(req.tenant.id, 'task:moved', { task: r.task, tasks: r.tasks, actorId: req.user.id });
    emitToTenant(req.tenant.id, 'activity:created', { activity: r.activity });
  }
  res.json({ task: r.task, tasks: r.tasks });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  checkId(req);
  const r = await tasks.remove(req.tenant, req.user, req.params.id);
  emitToTenant(req.tenant.id, 'task:deleted', { taskId: r.task.id, boardId: r.task.boardId, tasks: r.tasks, actorId: req.user.id });
  emitToTenant(req.tenant.id, 'activity:created', { activity: r.activity });
  res.status(204).end();
}));

module.exports = router;
