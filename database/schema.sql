-- =====================================================================
-- Collaborative Kanban - PostgreSQL schema
-- Hierarchy: organizations -> tenants -> boards -> columns -> tasks
-- Every business row carries tenant_id. Composite foreign keys
-- (id, tenant_id) make it IMPOSSIBLE at the DB level for a task to point
-- at a column/board that belongs to a different tenant.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

DROP TABLE IF EXISTS activity_logs, tasks, columns, boards, memberships, users, tenants, organizations CASCADE;

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(150) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)            -- target for composite FKs below
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenant_id NULL  => organization-level membership (only 'org_admin')
-- tenant_id set   => branch-level membership ('tenant_admin' | 'member')
CREATE TABLE memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tenant_id       UUID,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('org_admin','tenant_admin','member')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES tenants(id, organization_id) ON DELETE CASCADE,
  CHECK ( (role = 'org_admin' AND tenant_id IS NULL) OR (role <> 'org_admin' AND tenant_id IS NOT NULL) )
);
CREATE UNIQUE INDEX uq_membership_org    ON memberships (user_id, organization_id) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX uq_membership_tenant ON memberships (user_id, tenant_id)       WHERE tenant_id IS NOT NULL;

CREATE TABLE boards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  tenant_id       UUID NOT NULL,
  name            VARCHAR(150) NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, organization_id) REFERENCES tenants(id, organization_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);

CREATE TABLE columns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   UUID NOT NULL,
  tenant_id  UUID NOT NULL,
  name       VARCHAR(100) NOT NULL,
  position   INTEGER NOT NULL,
  FOREIGN KEY (board_id, tenant_id) REFERENCES boards(id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id),
  UNIQUE (id, board_id, tenant_id)
);

CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    UUID NOT NULL,
  column_id   UUID NOT NULL,
  tenant_id   UUID NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  priority    VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  due_date    DATE,
  labels      TEXT[] NOT NULL DEFAULT '{}',
  position    INTEGER NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,      -- optimistic locking
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- column must belong to the SAME board AND SAME tenant as the task
  FOREIGN KEY (column_id, board_id, tenant_id) REFERENCES columns(id, board_id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(30) NOT NULL,
  entity_id   UUID,
  action      VARCHAR(30) NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes (tenant-scoped queries are the hot path)
CREATE INDEX idx_tenants_org            ON tenants (organization_id);
CREATE INDEX idx_memberships_user       ON memberships (user_id);
CREATE INDEX idx_memberships_tenant     ON memberships (tenant_id);
CREATE INDEX idx_memberships_org        ON memberships (organization_id);
CREATE INDEX idx_boards_tenant          ON boards (tenant_id);
CREATE INDEX idx_columns_board          ON columns (board_id, position);
CREATE INDEX idx_tasks_tenant           ON tasks (tenant_id);
CREATE INDEX idx_tasks_board_column_pos ON tasks (tenant_id, board_id, column_id, position);
CREATE INDEX idx_activity_tenant_time   ON activity_logs (tenant_id, created_at DESC);
