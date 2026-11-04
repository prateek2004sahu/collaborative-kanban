const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { tenantScope } = require('../middleware/tenant');
const asyncHandler = require('../utils/asyncHandler');
const { isUuid } = require('../services/access.service');
const activity = require('../services/activity.service');

router.use(authenticate, tenantScope());

// GET /api/activity?limit=50&entityId=<uuid>
router.get('/', asyncHandler(async (req, res) => {
  const entityId = isUuid(req.query.entityId) ? req.query.entityId : null;
  res.json(await activity.list(req.tenant.id, { limit: req.query.limit, entityId }));
}));

module.exports = router;
