/**
 * Integration tests (need PostgreSQL with the seeded demo data: `npm run db:reset`).
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const app = require('../app');
const sockets = require('../sockets');
const { pool } = require('../config/database');

let server; let base;
const tokens = {}; const ctx = {};

const api = async (method, path, { token, tenant, body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(tenant ? { 'X-Tenant-Id': tenant } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: 'Password@123' } })).body.token;
const connect = (token) => new Promise((resolve, reject) => {
  const s = ioClient(base, { auth: { token }, transports: ['websocket'], forceNew: true });
  s.on('connect', () => resolve(s)); s.on('connect_error', reject);
});
const emitAck = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  server = http.createServer(app); sockets.init(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  for (const n of ['rahul@abc.com', 'priya@abc.com', 'arjun@abc.com', 'sneha@abc.com', 'kiran@xyz.com']) tokens[n.split('@')[0]] = await login(n);
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  ctx.hyd = (await q(`SELECT id FROM tenants WHERE name='Hyderabad'`))[0].id;
  ctx.blr = (await q(`SELECT id FROM tenants WHERE name='Bangalore'`))[0].id;
  ctx.mum = (await q(`SELECT id FROM tenants WHERE name='Mumbai'`))[0].id;
  ctx.hydBoard = (await q(`SELECT id FROM boards WHERE tenant_id=$1 AND name='Website Development'`, [ctx.hyd]))[0].id;
  ctx.blrTask = (await q(`SELECT id FROM tasks WHERE tenant_id=$1 LIMIT 1`, [ctx.blr]))[0].id;
  ctx.cols = (await q(`SELECT id FROM columns WHERE board_id=$1 ORDER BY position`, [ctx.hydBoard])).map((r) => r.id);
});
test.after(async () => { server.closeAllConnections?.(); server.close(); await pool.end(); });

test('auth: wrong password rejected, protected route needs token', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'rahul@abc.com', password: 'nope' } })).status, 401);
  assert.equal((await api('GET', '/api/boards', { tenant: ctx.hyd })).status, 401);
});

test('isolation: Hyderabad user cannot read Bangalore data (header spoof + direct id)', async () => {
  const spoof = await api('GET', '/api/boards', { token: tokens.priya, tenant: ctx.blr });
  assert.equal(spoof.status, 403);
  // own tenant header + Bangalore task id => 404 (task is invisible, not "forbidden")
  const direct = await api('GET', `/api/tasks/${ctx.blrTask}`, { token: tokens.priya, tenant: ctx.hyd });
  assert.equal(direct.status, 404);
  const upd = await api('PUT', `/api/tasks/${ctx.blrTask}`, { token: tokens.priya, tenant: ctx.hyd, body: { version: 1, title: 'hacked' } });
  assert.equal(upd.status, 404);
  const del = await api('DELETE', `/api/tasks/${ctx.blrTask}`, { token: tokens.priya, tenant: ctx.hyd });
  assert.equal(del.status, 404);
});

test('isolation: cross-organization (Mumbai user -> Hyderabad)', async () => {
  assert.equal((await api('GET', '/api/boards', { token: tokens.kiran, tenant: ctx.hyd })).status, 403);
  const me = await api('GET', '/api/auth/me', { token: tokens.kiran });
  assert.deepEqual(me.body.organizations.map((o) => o.name), ['XYZ Solutions']);
});

test('isolation: cannot create a task in another tenant via foreign board/column ids', async () => {
  const r = await api('POST', '/api/tasks', { token: tokens.kiran, tenant: ctx.mum, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'x' } });
  assert.ok([400, 404].includes(r.status), `got ${r.status}`);
});

test('isolation: DB itself refuses a task whose column is in another tenant (composite FK)', async () => {
  await assert.rejects(pool.query(
    `INSERT INTO tasks (board_id,column_id,tenant_id,title,position) VALUES ($1,$2,$3,'bad',0)`, [ctx.hydBoard, ctx.cols[0], ctx.blr]));
});

test('org admin sees all ABC tenants; members only their own', async () => {
  const rahul = await api('GET', '/api/auth/me', { token: tokens.rahul });
  const abc = rahul.body.organizations.find((o) => o.name === 'ABC Technologies');
  for (const n of ['Bangalore', 'Chennai', 'Hyderabad']) assert.ok(abc.tenants.some((t) => t.name === n), `missing ${n}`);
  const arjun = await api('GET', '/api/auth/me', { token: tokens.arjun });
  assert.deepEqual(arjun.body.organizations[0].tenants.map((t) => t.name), ['Hyderabad']);
});

test('RBAC: member cannot create boards/tenants/columns; admins can', async () => {
  assert.equal((await api('POST', '/api/boards', { token: tokens.arjun, tenant: ctx.hyd, body: { name: 'X' } })).status, 403);
  assert.equal((await api('POST', '/api/columns', { token: tokens.arjun, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, name: 'X' } })).status, 403);
  const org = (await api('GET', '/api/auth/me', { token: tokens.priya })).body.organizations[0].id;
  assert.equal((await api('POST', '/api/tenants', { token: tokens.priya, body: { organizationId: org, name: 'Goa' } })).status, 403);
  const created = await api('POST', '/api/tenants', { token: tokens.rahul, body: { organizationId: org, name: `Goa-${Date.now()}` } });
  assert.equal(created.status, 201);
  const b = await api('POST', '/api/boards', { token: tokens.priya, tenant: ctx.hyd, body: { name: `Temp-${Date.now()}` } });
  assert.equal(b.status, 201);
  assert.equal(b.body.columns.length, 4);
  assert.equal((await api('DELETE', `/api/boards/${b.body.id}`, { token: tokens.priya, tenant: ctx.hyd })).status, 204);
});

test('RBAC: member may delete own task but not others\'', async () => {
  const mine = await api('POST', '/api/tasks', { token: tokens.arjun, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'mine' } });
  assert.equal(mine.status, 201);
  const theirs = await api('POST', '/api/tasks', { token: tokens.priya, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'theirs' } });
  assert.equal((await api('DELETE', `/api/tasks/${theirs.body.id}`, { token: tokens.arjun, tenant: ctx.hyd })).status, 403);
  assert.equal((await api('DELETE', `/api/tasks/${mine.body.id}`, { token: tokens.arjun, tenant: ctx.hyd })).status, 204);
  assert.equal((await api('DELETE', `/api/tasks/${theirs.body.id}`, { token: tokens.priya, tenant: ctx.hyd })).status, 204);
});

test('validation: bad input -> 400; assignee from another tenant -> 400', async () => {
  const bad = await api('POST', '/api/tasks', { token: tokens.priya, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: '' } });
  assert.equal(bad.status, 400);
  const kiranId = (await api('GET', '/api/auth/me', { token: tokens.kiran })).body.user.id;
  const wrong = await api('POST', '/api/tasks', { token: tokens.priya, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'a', assignedTo: kiranId } });
  assert.equal(wrong.status, 400);
});

test('concurrency: two edits with the same version -> one 200, one 409 with latest task', async () => {
  const t = (await api('POST', '/api/tasks', { token: tokens.priya, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'race' } })).body;
  const [a, b] = await Promise.all([
    api('PUT', `/api/tasks/${t.id}`, { token: tokens.priya, tenant: ctx.hyd, body: { version: t.version, title: 'by priya' } }),
    api('PUT', `/api/tasks/${t.id}`, { token: tokens.arjun, tenant: ctx.hyd, body: { version: t.version, description: 'by arjun' } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.current.version, 2);
  await api('DELETE', `/api/tasks/${t.id}`, { token: tokens.priya, tenant: ctx.hyd });
});

test('concurrency: two users move the same task at once -> exactly one wins; positions stay contiguous', async () => {
  const t = (await api('POST', '/api/tasks', { token: tokens.priya, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'dragrace' } })).body;
  const [a, b] = await Promise.all([
    api('PATCH', `/api/tasks/${t.id}/move`, { token: tokens.priya, tenant: ctx.hyd, body: { columnId: ctx.cols[1], index: 0, version: t.version } }),
    api('PATCH', `/api/tasks/${t.id}/move`, { token: tokens.arjun, tenant: ctx.hyd, body: { columnId: ctx.cols[3], index: 0, version: t.version } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  await assertContiguous(ctx.hydBoard);
  await api('DELETE', `/api/tasks/${t.id}`, { token: tokens.priya, tenant: ctx.hyd });
});

test('ordering: many parallel moves of DIFFERENT tasks keep positions unique & contiguous', async () => {
  const list = (await api('GET', `/api/tasks?boardId=${ctx.hydBoard}`, { token: tokens.priya, tenant: ctx.hyd })).body.slice(0, 6);
  const results = await Promise.all(list.map((t, i) =>
    api('PATCH', `/api/tasks/${t.id}/move`, { token: tokens.priya, tenant: ctx.hyd, body: { columnId: ctx.cols[i % 4], index: 0, version: t.version } })));
  assert.ok(results.every((r) => r.status === 200));
  await assertContiguous(ctx.hydBoard);
});

async function assertContiguous(boardId) {
  const { rows } = await pool.query(`SELECT column_id, array_agg(position ORDER BY position) AS p FROM tasks WHERE board_id=$1 GROUP BY column_id`, [boardId]);
  for (const r of rows) assert.deepEqual(r.p, r.p.map((_, i) => i), `positions not contiguous: ${r.p}`);
}

test('websocket: unauthenticated connection rejected; cannot join other tenant room', async () => {
  await assert.rejects(new Promise((res, rej) => {
    const s = ioClient(base, { auth: { token: 'garbage' }, transports: ['websocket'], forceNew: true });
    s.on('connect', () => { s.close(); res(); }); s.on('connect_error', (e) => { s.close(); rej(e); });
  }));
  const s = await connect(tokens.arjun);
  assert.equal((await emitAck(s, 'tenant:join', { tenantId: ctx.blr })).ok, false);
  assert.equal((await emitAck(s, 'tenant:join', { tenantId: 'not-a-uuid' })).ok, false);
  s.close();
});

test('websocket: live updates reach same-tenant users only; presence handles multi-tab', async () => {
  const arjun1 = await connect(tokens.arjun); const arjun2 = await connect(tokens.arjun);
  const priya = await connect(tokens.priya); const sneha = await connect(tokens.sneha);
  assert.equal((await emitAck(arjun1, 'tenant:join', { tenantId: ctx.hyd })).ok, true);
  assert.equal((await emitAck(arjun2, 'tenant:join', { tenantId: ctx.hyd })).ok, true);
  const joined = await emitAck(priya, 'tenant:join', { tenantId: ctx.hyd });
  assert.deepEqual(joined.presence.map((u) => u.name).sort(), ['Arjun', 'Priya']); // Arjun counted once
  assert.equal((await emitAck(sneha, 'tenant:join', { tenantId: ctx.blr })).ok, true);

  const got = { priya: [], sneha: [] };
  priya.on('task:created', (p) => got.priya.push(p)); sneha.on('task:created', (p) => got.sneha.push(p));
  const t = await api('POST', '/api/tasks', { token: tokens.arjun, tenant: ctx.hyd, body: { boardId: ctx.hydBoard, columnId: ctx.cols[0], title: 'live!' } });
  await wait(300);
  assert.equal(got.priya.length, 1); assert.equal(got.priya[0].task.title, 'live!');
  assert.equal(got.sneha.length, 0, 'Bangalore user must not receive Hyderabad events');

  let last; priya.on('presence:update', (p) => { last = p; });
  arjun1.close(); await wait(250);
  assert.equal(last, undefined, 'one tab closing must not mark Arjun offline');
  arjun2.close(); await wait(250);
  assert.deepEqual(last.users.map((u) => u.name), ['Priya']);
  await api('DELETE', `/api/tasks/${t.body.id}`, { token: tokens.arjun, tenant: ctx.hyd });
  priya.close(); sneha.close();
});

test('activity log is tenant scoped', async () => {
  const hyd = await api('GET', '/api/activity?limit=100', { token: tokens.priya, tenant: ctx.hyd });
  assert.equal(hyd.status, 200);
  assert.ok(hyd.body.length > 0 && hyd.body.every((a) => a.tenantId === ctx.hyd));
});
