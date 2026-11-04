# WebSocket (Socket.IO) Documentation

Server: same origin/port as the API (`http://localhost:5000`), Socket.IO v4.

## Design rules

1. **Authenticated** – the JWT is sent in the handshake: `io(url, { auth: { token } })`. Invalid/expired token → `connect_error: unauthorized`.
2. **Tenant-scoped rooms** – room name `tenant:<tenantId>`. A client is in **at most one** tenant room at a time.
3. **Server-authorised joins** – `tenant:join` re-checks the user's membership in PostgreSQL. A client cannot join a room just by naming it.
4. **Read-only channel** – clients never send mutations over the socket. Writes go through REST (one place for RBAC, validation, versioning). The server broadcasts **after the DB transaction commits**, so every event describes committed state.
5. **Idempotent events** – payloads carry full task objects (with `version`), so applying the same event twice is harmless.

## Client → Server

| Event | Payload | Ack | Description |
| --- | --- | --- | --- |
| `tenant:join` | `{ tenantId }` | `{ ok:true, role, presence:[{userId,name}] }` or `{ ok:false, error:'forbidden'\|'server_error' }` | Leave current tenant room (if any) and join the new one. Marks the user online in that tenant. |
| `tenant:leave` | – | `{ ok:true }` | Leave the current tenant room. |

## Server → Client (all emitted only to `tenant:<id>`)

| Event | Payload | Triggered by |
| --- | --- | --- |
| `presence:update` | `{ tenantId, users:[{userId,name}] }` | A user comes online (first tab) or goes offline (last tab closes) |
| `task:created` | `{ task, actorId }` | `POST /tasks` |
| `task:updated` | `{ task, actorId }` | `PUT /tasks/:id` |
| `task:moved` | `{ task, tasks:[…], actorId }` | `PATCH /tasks/:id/move` – `tasks` = all tasks of the source & destination columns with their new `position`s |
| `task:deleted` | `{ taskId, boardId, tasks:[…], actorId }` | `DELETE /tasks/:id` – `tasks` = re-numbered remaining tasks of that column |
| `column:updated` | `{ boardId, columns:[…] }` | Column create / rename / reorder / delete (full ordered column list) |
| `column:deleted` | `{ boardId, columnId }` | Column delete |
| `board:updated` | `{ action:'created'\|'updated'\|'deleted', board }` | Board create / update / delete |
| `members:updated` | `{}` | Membership added / changed / removed in the tenant |
| `activity:created` | `{ activity }` | Every logged action |

## Presence
Tracked in memory as `tenantId → userId → Set<socketId>`. A user with several tabs is **one** online user; `presence:update` is only emitted when the set of online users actually changes.

## Reconnection & network recovery
1. Socket.IO reconnects automatically (the `auth` option is a function, so the latest token is used).
2. On every `connect` the client emits `tenant:join` again (server re-authorises).
3. After a **re**-join the client refetches `GET /boards/:id` and the activity feed – it never assumes it received every event while offline.
4. The UI shows a "Reconnecting…" banner while disconnected.

## Example client
```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:5000', { auth: { token } });
socket.on('connect', () =>
  socket.emit('tenant:join', { tenantId }, (res) => console.log(res))); // { ok:true, role:'member', presence:[…] }
socket.on('task:moved', ({ task, tasks }) => console.log('moved', task.title));
socket.on('presence:update', ({ users }) => console.log('online:', users.map(u => u.name)));
```
