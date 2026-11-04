const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../config/database');
const { authenticate, sign } = require('../middleware/auth');
const validate = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { unauthorized, conflict } = require('../utils/httpError');
const { listWorkspaces } = require('../services/access.service');

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  const exists = await query('SELECT 1 FROM users WHERE email=$1', [email]);
  if (exists.rowCount) throw conflict('Email already registered');
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email', [name, email, hash]);
  res.status(201).json({ token: sign(rows[0]), user: publicUser(rows[0]) });
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
  const user = rows[0];
  // Same message for "no such user" and "wrong password" (don't leak which emails exist)
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw unauthorized('Invalid email or password');
  res.json({ token: sign(user), user: publicUser(user) });
}));

/** Current user + every organization/tenant they may access (drives the selectors). */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT id,name,email FROM users WHERE id=$1', [req.user.id]);
  if (!rows.length) throw unauthorized('User no longer exists');
  res.json({ user: publicUser(rows[0]), organizations: await listWorkspaces(req.user.id) });
}));

module.exports = router;
