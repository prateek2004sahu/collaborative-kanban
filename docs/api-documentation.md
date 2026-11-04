# REST API Documentation

Base URL (local): `http://localhost:5000/api`
All bodies are JSON. Timestamps are ISO-8601 UTC.

## Conventions

| Topic | Rule |
| --- | --- |
| Authentication | `Authorization: Bearer <JWT>` on everything except `register` and `login` |
| Tenant scoping | Board / column / task / activity endpoints require header `X-Tenant-Id: <tenantId>`. The server **re-checks the caller's membership in the database on every request**; a spoofed header gives `403`. Endpoints under `/tenants/:id/...` use the `:id` in the path instead. |
| Roles | `member` < `tenant_admin` < `org_admin`. An `org_admin` of an organization is automatically `org_admin` in every tenant of that organization. |
| Cross-tenant ids | A task/board/column id that belongs to another tenant answers **404** (same as "does not exist") so ids cannot be probed. |

### Status codes

| Code | Meaning |
| --- | --- |
| 200 / 201 / 204 | OK / created / no content |
| 400 | Validation error (body `{ error, details:[{path,message}] }`) or reference to another tenant's record |
| 401 | Missing / invalid / expired token |
| 403 | Authenticated but role or tenant membership insufficient |
| 404 | Not found (or not visible in your tenant) |
| 409 | **Version conflict** – body `{ error, current: <latest task> }`; or duplicate value |
| 500 | Unexpected server error |

---

## Auth

### POST `/auth/register`
Body `{ "name": "Rahul", "email": "rahul@abc.com", "password": "min 8 chars" }` → `201 { token, user }`. `409` if email exists.

### POST `/auth/login`
Body `{ "email", "password" }` → `200 { token, user:{id,name,email} }`. `401` for wrong credentials (same message for unknown email).

### GET `/auth/me`  *(JWT)*
Returns the user and **every organization/tenant they may access with their effective role** – this drives the frontend selectors:
```json
{ "user": {"id":"…","name":"Priya","email":"priya@abc.com"},
  "organizations": [ { "id":"…","name":"ABC Technologies","isOrgAdmin":false,
      "tenants":[ {"id":"…","name":"Hyderabad","role":"tenant_admin"} ] } ] }
```

---

## Organizations  *(JWT)*

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/organizations` `{name}` | any user | Create org; creator becomes **Org Admin** |
| GET | `/organizations` | any | Orgs/tenants the caller belongs to |
| GET | `/organizations/:id` | any member of org | Get organization (404 if not a member) |
| PUT | `/organizations/:id` `{name}` | Org Admin | Rename |
| DELETE | `/organizations/:id` | Org Admin | Delete (cascades to all tenants & data) |
| GET | `/organizations/:id/members` | Org Admin | List org-level admins |
| POST | `/organizations/:id/members` `{email}` | Org Admin | Make a registered user an Org Admin |

## Tenants (branches)  *(JWT)*

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/tenants` `{organizationId, name}` | Org Admin of that org | Create branch |
| GET | `/tenants?organizationId=` | any | Tenants the caller can access |
| GET | `/tenants/:id` | any member | Get tenant (+ caller's role) |
| PUT | `/tenants/:id` `{name}` | Org Admin | Rename |
| DELETE | `/tenants/:id` | Org Admin | Delete (cascades) |
| GET | `/tenants/:id/members` | any member | Members incl. org admins (`viaOrganization:true`) |
| POST | `/tenants/:id/members` `{email, role}` | Tenant Admin+ | Add / change role (`member` \| `tenant_admin`); emits `members:updated` |
| PATCH | `/tenants/:id/members/:userId` `{role}` | Tenant Admin+ | Change role |
| DELETE | `/tenants/:id/members/:userId` | Tenant Admin+ | Remove member |

## Boards  *(JWT + X-Tenant-Id)*

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/boards` `{name, description?}` | Tenant Admin+ | Create board **with default columns** To Do / In Progress / Testing / Done |
| GET | `/boards` | member | Boards of the tenant |
| GET | `/boards/:id` | member | **Full state** `{ board, columns, tasks }` – also used to re-sync after reconnect |
| GET | `/boards/:id/columns` | member | Columns only |
| PUT | `/boards/:id` | Tenant Admin+ | Update |
| DELETE | `/boards/:id` | Tenant Admin+ | Delete (cascades) |

## Columns  *(JWT + X-Tenant-Id, Tenant Admin+)*

| Method | Endpoint | Body | Purpose |
| --- | --- | --- | --- |
| POST | `/columns` | `{boardId, name}` | Append column |
| PUT | `/columns/:id` | `{name?, position?}` | Rename / reorder (board is row-locked while renumbering) |
| DELETE | `/columns/:id` | – | Delete column (its tasks are deleted too) |

## Tasks  *(JWT + X-Tenant-Id)*

| Method | Endpoint | Role | Purpose |
| --- | --- | --- | --- |
| POST | `/tasks` | member | Create |
| GET | `/tasks?boardId=` | member | List a board's tasks (ordered by column, position) |
| GET | `/tasks/:id` | member | Get one |
| PUT | `/tasks/:id` | member | Update (**requires `version`**) |
| PATCH | `/tasks/:id/move` | member | Move / reorder (**requires `version`**) |
| DELETE | `/tasks/:id` | creator or Tenant Admin+ | Delete |

### POST `/tasks`
```json
{ "boardId":"…", "columnId":"…", "title":"Create Login Page",
  "description":"", "assignedTo":"<userId>|null", "priority":"low|medium|high",
  "dueDate":"2026-11-10", "labels":["frontend"] }
```
→ `201` task. Task is appended at the end of the column. `assignedTo` must belong to the same tenant (else `400`); the column must belong to the board (else `400`).

### Task object
```json
{ "id":"…","boardId":"…","columnId":"…","tenantId":"…","title":"…","description":"…",
  "assignedTo":"…|null","createdBy":"…","priority":"medium","dueDate":"2026-11-10|null",
  "labels":["…"],"position":0,"version":3,"createdAt":"…","updatedAt":"…" }
```

### PUT `/tasks/:id`  – optimistic locking
```json
{ "version": 3, "title": "New title", "description": "…" }
```
Only the supplied fields change. Success → `200` updated task (`version` = 4) and a `task:updated` broadcast.
If the stored version is not `3` → **`409`** `{ "error":"Task was modified by someone else", "current":{…latest task…} }`.
`404` if the task was deleted meanwhile.

### PATCH `/tasks/:id/move`
```json
{ "columnId":"<destination>", "index": 2, "version": 4 }
```
`index` = desired 0-based position in the destination column. The server (not the client) computes the final ordering inside one transaction, under a row lock on the board, and renumbers positions `0..n-1`.
Response `200 { task, tasks:[…every task of the affected columns…] }`. `409` on stale version (same body as above).

### DELETE `/tasks/:id` → `204`
Members may delete only tasks they created (`403` otherwise).

## Activity  *(JWT + X-Tenant-Id)*

### GET `/activity?limit=50&entityId=<uuid>`
Newest first. Each item: `{ id, tenantId, userId, userName, entityType, entityId, action, details, createdAt }`.

## Health
`GET /health` → `{ status:"ok" }` (no auth).

---

## Example: moving a task (cURL)
```bash
TOKEN=$(curl -s -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"priya@abc.com","password":"Password@123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:5000/api/auth/me -H "Authorization: Bearer $TOKEN"        # find tenant / board ids
curl -s -X PATCH localhost:5000/api/tasks/<taskId>/move \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: <tenantId>" -H 'Content-Type: application/json' \
  -d '{"columnId":"<columnId>","index":0,"version":1}'
```
