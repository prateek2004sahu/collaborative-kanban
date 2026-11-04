# Test Report

Environment: Node 22, PostgreSQL 16, Chromium (Playwright). Date: 2026-11-02.

## 1. Automated integration tests – `cd backend && npm run db:reset && npm test`
**15 / 15 passed** (real PostgreSQL, real HTTP, real Socket.IO clients).

| # | Area | Scenario | Result |
| --- | --- | --- | --- |
| 1 | Auth | Wrong password → 401; no token → 401 | ✅ |
| 2 | Isolation | Hyderabad user + Bangalore `X-Tenant-Id` → 403; Bangalore task id via own tenant → 404 on GET/PUT/DELETE | ✅ |
| 3 | Isolation | Cross-organization (Mumbai user → Hyderabad) blocked; `/auth/me` lists only own org | ✅ |
| 4 | Isolation | Creating a task using another tenant's board/column ids rejected | ✅ |
| 5 | Isolation | **Database itself** rejects a task whose column belongs to another tenant (composite FK) | ✅ |
| 6 | Hierarchy | Org Admin sees all branches; member only own branch | ✅ |
| 7 | RBAC | Member cannot create board/column/tenant; Tenant Admin can create board; only Org Admin creates tenants | ✅ |
| 8 | RBAC | Member deletes own task only; admin deletes any | ✅ |
| 9 | Validation | Empty title → 400; assignee from another tenant → 400 | ✅ |
| 10 | Concurrency | Two **parallel** edits, same version → exactly one 200 and one 409 (with latest task) | ✅ |
| 11 | Concurrency | Two **parallel** moves of the same task → one 200, one 409; positions contiguous | ✅ |
| 12 | Ordering | 6 parallel moves of different tasks → all succeed, positions unique & contiguous | ✅ |
| 13 | WebSocket | Bad token rejected; joining another tenant's room or invalid id denied | ✅ |
| 14 | WebSocket | Same-tenant user receives `task:created`; other tenant does not; multi-tab presence stays online until last tab closes | ✅ |
| 15 | Activity | Activity feed contains only the caller's tenant | ✅ |

## 2. Scripted two-browser end-to-end run (Playwright)
| Check | Result |
| --- | --- |
| Org Admin sees 3 ABC branches; Bangalore admin sees only Bangalore + its boards | ✅ |
| Presence shows "2 online" when Priya and Arjun are on the board | ✅ |
| Drag card To Do → In Progress: **appears live in the second browser** | ✅ |
| Task created in browser B appears in browser A | ✅ |
| Same task edited by two users: conflict banner appears; "Keep mine" merges only changed fields | ✅ |
| Bangalore session receives nothing from Hyderabad activity | ✅ |
| Undo / redo of a move syncs to both browsers | ✅ |
| Browser offline → "Reconnecting…" banner; after reconnect board shows the edit made meanwhile | ✅ |
| No console / page errors | ✅ |

## 3. Not tested / caveats
No load testing (k6) was performed, so no scalability claims are made. Presence is in-memory (single node). Mobile layout was checked visually only (`screenshots/06-…`).
