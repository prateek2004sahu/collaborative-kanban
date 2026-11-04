import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { useBoard } from '../hooks/useBoard';
import { useRealtime } from '../hooks/useRealtime';
import KanbanBoard from '../components/KanbanBoard';
import TaskDetails from '../components/TaskDetails';
import PresenceIndicator from '../components/PresenceIndicator';
import ActivityLog from '../components/ActivityLog';

export default function Board() {
  const { boardId } = useParams();
  const { user, tenant, canManage } = useAuth();
  const b = useBoard(boardId);
  const [openId, setOpenId] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [members, setMembers] = useState([]);
  const [resyncKey, setResyncKey] = useState(0);

  // Join the tenant room; after a reconnect, refetch the board (we may have missed events).
  const { status, presence } = useRealtime(tenant?.id, () => { b.reload(); setResyncKey((k) => k + 1); });

  useEffect(() => { if (tenant?.id) api.get(`/tenants/${tenant.id}/members`).then((r) => setMembers(r.data)).catch(() => {}); }, [tenant?.id]);
  const names = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m.name])), [members]);

  const task = b.tasks.find((t) => t.id === openId);
  useEffect(() => { if (openId && !task && !b.loading) { setOpenId(null); b.flash('That task was deleted.', 'warn'); } }, [openId, task, b.loading]); // eslint-disable-line

  if (b.error) return <main className="page"><div className="error">{b.error}</div><Link to="/">← Back to boards</Link></main>;
  if (b.loading) return <main className="page muted">Loading board…</main>;

  const canDelete = task && (canManage || task.createdBy === user.id);
  return (
    <main className="board-page">
      <div className="board-bar">
        <div><Link to="/" className="muted small">← Boards</Link><h2>{b.board.name}</h2></div>
        <div className="row wrap">
          <button className="btn sm" disabled={!b.canUndo} onClick={b.undo} title="Undo last move/edit">↶ Undo</button>
          <button className="btn sm" disabled={!b.canRedo} onClick={b.redo} title="Redo">↷ Redo</button>
          <button className="btn sm" onClick={() => setShowActivity((s) => !s)}>{showActivity ? 'Hide' : 'Show'} activity</button>
          <PresenceIndicator users={presence} meId={user.id} status={status} />
        </div>
      </div>

      {status === 'reconnecting' && <div className="banner warn">Connection lost — reconnecting. Your view will re-sync automatically.</div>}
      {status === 'denied' && <div className="banner error">You do not have access to live updates for this branch.</div>}

      <div className="board-layout">
        <KanbanBoard columns={b.columns} tasksByColumn={b.tasksByColumn} names={names}
          onMove={b.moveTask} onOpen={setOpenId} onAdd={b.createTask} />
        {showActivity && <aside className="side card"><h3>Activity</h3><ActivityLog tenantId={tenant.id} limit={40} reloadKey={resyncKey} /></aside>}
      </div>

      {task && (
        <TaskDetails key={task.id} task={task} columns={b.columns} members={members}
          canEdit onSave={b.updateTask} canDelete={canDelete}
          onDelete={(id) => { setOpenId(null); b.deleteTask(id); }} onClose={() => setOpenId(null)}
          activityNode={<ActivityLog tenantId={tenant.id} entityId={task.id} limit={15} reloadKey={resyncKey} />} />
      )}
      {b.notice && <div className={`toast ${b.notice.type}`}>{b.notice.message}</div>}
    </main>
  );
}
