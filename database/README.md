# Database

* `schema.sql` – full PostgreSQL schema (also used by `backend/src/db/migrate.js`).
* Demo data: `cd backend && npm run db:seed` (see `backend/src/db/seed.js`). `npm run db:reset` = schema + seed.
* ER diagram: `../docs/database-erd.png`

Apply manually with psql:
```bash
psql postgresql://kanban:kanban123@localhost:5432/collaborative_kanban -f schema.sql
```
> `schema.sql` **drops and recreates** all tables.
