# Real-Time Collaborative Kanban Board
**Multi-organization → multi-tenant (branch) task board with strict data isolation and live synchronization.**

Stack: **React (Vite) · Node.js/Express · PostgreSQL · Socket.IO · JWT · dnd-kit**

![Board](screenshots/03-kanban-board-presence-activity.png)

---

## 1. Business problem
ABC Technologies has branches in Hyderabad, Bangalore and Chennai. Each branch runs its own projects, but all employees use one task-management app. When someone moves a card, teammates in the **same branch** must see it instantly — while employees of other branches (or other companies) must never see or touch that data.

## 2. Features

| Area | Implemented |
| --- | --- |
| Hierarchy | Organization → Tenants (branches) → Boards → Columns → Tasks |
| Auth | Register / login, bcrypt password hashing, JWT |
| RBAC | **Org Admin**, **Tenant Admin**, **Member** – enforced on the backend (REST *and* WebSocket) |
| CRUD APIs | Organizations, Tenants, Boards, Columns, Tasks (+ members, activity) |
| Tenant isolation | Header validated against DB memberships on every call, tenant-scoped queries, composite foreign keys, tenant-scoped socket rooms |
| Real-time | Live create / update / move / delete, per-tenant presence, reconnect + re-sync |
| Concurrency | Optimistic locking (`version`) + board row lock + transactions; field-level conflict resolution UI |
| UI | Org selector, tenant switcher, Kanban drag & drop, task detail drawer, activity feed, presence avatars, responsive |
| Advanced | Optimistic UI, **undo/redo** (moves & edits), activity log per tenant, network-recovery banner |

## 3. Architecture

![Architecture](docs/architecture.png)

**Request flow – "Priya moves a task":**
1. dnd-kit drop → `useBoard.moveTask` updates the UI **optimistically**.
2. `PATCH /api/tasks/:id/move {columnId, index, version}` + JWT + `X-Tenant-Id`.
3. `authenticate` verifies JWT → `tenantScope` looks up Priya's membership in the DB → role checked.
4. `task.service.move` opens a transaction, **locks the board row**, re-reads the task `FOR UPDATE`, compares `version` (409 if stale), computes the new ordering, renumbers positions, bumps `version`, writes an `activity_logs` row, **COMMIT**.
5. Only after commit: `io.to('tenant:<id>').emit('task:moved', …)`.
6. Arjun's browser merges the authoritative task list; Priya's browser reconciles with the same payload.

Code layout:
```
backend/src
  config/      env + pg pool + withTransaction()
  middleware/  auth (JWT) · tenant (isolation) · role · validate (Zod) · error
  services/    access (who can see which tenant) · task (concurrency) · activity
  routes/      auth · organization · tenant(+members) · board · column · task · activity
  sockets/     Socket.IO: JWT handshake, tenant:join, presence
  db/          schema.sql · migrate.js · seed.js
  tests/       integration tests (15)
frontend/src
  context/ (AuthContext)  hooks/ (useBoard, useRealtime)  services/ (api, socket)
  components/ (Kanban, Column, TaskCard, TaskDetails, Presence, ActivityLog, Navbar, Members)  pages/
```

## 4. Tenancy model (the most important part)

**Why Organization *and* Tenant?** An organization is the paying customer/company; a tenant is one isolated workspace (branch) inside it. Org Admins manage all branches; everyone else lives inside one or more branches. Data is isolated per **tenant**, not per organization.

**Memberships** (`memberships` table) connect users to the hierarchy:
| tenant_id | role | Meaning |
| --- | --- | --- |
| `NULL` | `org_admin` | Admin of the whole organization → effective Org Admin in **every** tenant of it |
| set | `tenant_admin` / `member` | Role inside that single branch |
A DB `CHECK` guarantees this pairing; partial unique indexes prevent duplicates.

**How isolation is enforced – defence in depth**
1. **Every business row has `tenant_id`** (boards, columns, tasks, activity_logs).
2. **Server never trusts the client's tenant.** `X-Tenant-Id` is only a *request*; `tenantScope` runs `getTenantAccess(userId, tenantId)` against `memberships` on every request → `403` otherwise. The verified `req.tenant` is what all queries use.
3. **Every query filters by the verified tenant:** `WHERE id=$1 AND tenant_id=$2`. A Bangalore task id used from Hyderabad simply returns **404** (indistinguishable from "doesn't exist").
4. **Cross-reference checks:** a task's column must belong to the same board *and* tenant; an assignee must be a member of that tenant.
5. **Database-level guarantee:** composite foreign keys `(column_id, board_id, tenant_id) → columns(id, board_id, tenant_id)` etc. make it *impossible for the DB to store* a task pointing at another tenant's column – even if application code had a bug (covered by a test).
6. **WebSocket rooms are tenant-scoped** (`tenant:<id>`), joined only after a DB membership check; one room per socket; broadcasts only go to that room.
7. **Cross-organization isolation** follows from 2–6: a user's memberships define the only tenants reachable.

> Not implemented (documented as future work): PostgreSQL Row-Level Security as a 3rd layer.

## 5. RBAC matrix

| Action | Member | Tenant Admin | Org Admin |
| --- | :-: | :-: | :-: |
| View boards / tasks / activity of their tenant | ✅ | ✅ | ✅ (all tenants of org) |
| Create / edit / move tasks | ✅ | ✅ | ✅ |
| Delete tasks | own only | any | any |
| Create / edit / delete boards & columns | ❌ | ✅ | ✅ |
| Add / remove / re-role tenant members | ❌ | ✅ | ✅ |
| Create / rename / delete tenants, rename / delete org, add org admins | ❌ | ❌ | ✅ |

Enforced in middleware (`tenantScope(minRole)`) and services — hiding buttons in the UI is only cosmetic.

## 6. Database design
Tables: `organizations, tenants, users, memberships, boards, columns, tasks, activity_logs` → see **[docs/database-erd.png](docs/database-erd.png)** and [`database/schema.sql`](database/schema.sql).

![ERD](docs/database-erd.png)

* **Task ordering:** integer `position` per column. Moves recompute and renumber `0..n-1` for the affected columns inside one transaction (simple, deterministic, contiguous – verified by tests).
* **Versioning:** `tasks.version` increments on every edit/move.
* **Indexes:** tenant-leading composite indexes, e.g. `(tenant_id, board_id, column_id, position)`, `(tenant_id, created_at DESC)` for activity.
* UUID primary keys (no guessable ids), `TIMESTAMPTZ` timestamps, `JSONB` for activity details.

## 7. Real-time communication
Details in [docs/websocket-documentation.md](docs/websocket-documentation.md). Summary: JWT-authenticated Socket.IO; `tenant:join` re-authorised in DB; events broadcast **after commit** to `tenant:<id>`; presence per tenant (multi-tab aware); on reconnect the client re-joins and **refetches** the board.

## 8. Concurrency & conflict resolution

| Scenario | Handling |
| --- | --- |
| Two users edit the same task | Optimistic locking. Update carries `version`; the row is locked `FOR UPDATE`; stale → **409 + latest task**. UI shows *Load latest* / *Keep mine*; "Keep mine" re-sends **only the fields the user changed** (field-level merge) against the new version. |
| Two users move the same task | Board row lock serialises them; first commits and bumps version; second sees a stale version → 409 → UI rolls back its optimistic move and shows the latest state. |
| Two users reorder different tasks | Both serialise on the board lock; each recomputes the full ordering in its transaction → positions stay unique & contiguous. |
| Edit vs delete | Edit gets 404 → UI closes the panel and tells the user. |
| Offline | Optimistic change rolled back on failure; after reconnect the board is refetched. |
| Deadlocks | Fixed lock order: **board → task**. |

All verified by automated tests that fire the requests *in parallel*.

## 9. Setup – from zero (A to Z)

**Prerequisites:** Node.js 18+ (LTS), PostgreSQL 14+, Git.

### Step 1 – Create the database
Windows: open **SQL Shell (psql)**; macOS/Linux: `sudo -u postgres psql`. Then:
```sql
CREATE USER kanban WITH PASSWORD 'kanban123';
CREATE DATABASE collaborative_kanban OWNER kanban;
\q
```
### Step 2 – Backend
```bash
cd backend
cp .env.example .env          # Windows: copy .env.example .env   (edit DATABASE_URL / JWT_SECRET if needed)
npm install
npm run db:reset              # creates all tables + loads demo data
npm run dev                   # API + WebSocket on http://localhost:5000
```
Check: open http://localhost:5000/api/health → `{"status":"ok"}`

### Step 3 – Frontend (new terminal)
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```
### Step 4 – Try it
Open http://localhost:5173 and sign in (password for all demo users: **`Password@123`**).

| User | Role | Sees |
| --- | --- | --- |
| rahul@abc.com | Org Admin (ABC) | Hyderabad, Bangalore, Chennai |
| priya@abc.com | Tenant Admin | Hyderabad |
| arjun@abc.com | Member | Hyderabad |
| sneha@abc.com | Tenant Admin | Bangalore |
| kiran@xyz.com | Member (XYZ Solutions) | Mumbai |

**Two-user demo:** open a normal window as Priya and an incognito window as Arjun → open *Website Development* in both → drag a card in one, watch the other update. Log in as Sneha: none of it is visible.

### Step 5 – Run the tests
```bash
cd backend && npm run db:reset && npm test
```
(Tests need the seeded database. They create/delete temporary rows and are safe to re-run.)

### Environment variables
| File | Variable | Purpose |
| --- | --- | --- |
| backend/.env | `PORT` | API port (5000) |
| | `DATABASE_URL` | `postgresql://user:pass@host:5432/db` |
| | `JWT_SECRET` | **change in production** (long random string) |
| | `JWT_EXPIRES_IN` | token lifetime (12h) |
| | `CLIENT_ORIGIN` | allowed CORS / socket origin |
| frontend/.env | `VITE_API_URL` | only if the API is on another origin (deployment) |

### Troubleshooting
* `ECONNREFUSED 5432` → PostgreSQL isn't running. * `password authentication failed` → fix `DATABASE_URL`. * Blank page / 401 loop → clear `localStorage` and log in again. * Port busy → change `PORT` (and the proxy target in `frontend/vite.config.js`).

### Deployment (optional)
Frontend → Vercel (set `VITE_API_URL`), backend → Render/Railway (set env vars, `CLIENT_ORIGIN` = frontend URL), DB → Neon/Supabase (run `npm run db:reset` once).

## 10. Testing
See [docs/test-report.md](docs/test-report.md): 15 automated integration tests (isolation, RBAC, concurrency races, WebSocket scoping, presence) + a scripted two-browser end-to-end run.

## 11. Design trade-offs

| Decision | Why | Cost / limitation |
| --- | --- | --- |
| Shared DB, `tenant_id` column ("pool" model) | Simple ops, cheap, one migration path | Isolation relies on discipline → mitigated by composite FKs + central middleware; RLS would add a 3rd layer |
| PostgreSQL | Relational integrity, transactions, row locks | Vertical scaling first |
| Socket.IO read-only channel, writes via REST | One validation/RBAC path; broadcast only committed state | One extra HTTP call per action |
| Optimistic locking (`version`) | Never silently overwrites; cheap | User must resolve conflicts (UI helps) |
| Board-level row lock for ordering | Guarantees contiguous positions simply | Serialises writers *per board* (fine for Kanban sizes) |
| Integer positions + renumber | Easy to reason about & test | O(n) writes per move; fractional ranks would reduce this at scale |
| JWT in `localStorage` | Simple SPA + socket handshake | XSS-exposed; production → httpOnly cookie + refresh tokens |
| In-memory presence | Zero infrastructure | Single-node only (see scaling) |

## 12. Known limitations
* Presence & rooms are per-process: running several Node instances needs the Socket.IO Redis adapter + shared presence store (Redis).
* A user's tenant role changes apply on their next request; an already-joined socket isn't force-evicted on membership removal (REST is blocked immediately).
* Undo/redo covers moves and edits (not create/delete) and is per-session, client-side.
* No rate-limiting, email verification, refresh tokens or password reset.
* Activity log has no pagination UI (API supports `limit`).
* Task moves bump the moved task's `version` only; positions of its neighbours change without a version bump (events carry the authoritative list).

## 13. Future improvements
Row-Level Security · Redis adapter + presence · refresh-token/httpOnly cookie auth · fractional-rank ordering · rate limiting · file attachments & comments · pagination/virtualised columns · Postman/OpenAPI export · k6 load tests.

## 14. Documentation index
* [API documentation](docs/api-documentation.md) · [WebSocket documentation](docs/websocket-documentation.md) · [Test report](docs/test-report.md)
* ER diagram: `docs/database-erd.png` (editable source `docs/database-erd.dot`, SVG included)
* Screenshots: `screenshots/`
