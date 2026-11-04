import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { errorMessage } from '../services/api';
import MembersPanel from '../components/MembersPanel';
import ActivityLog from '../components/ActivityLog';
import { useRealtime, useSocketEvent } from '../hooks/useRealtime';
import PresenceIndicator from '../components/PresenceIndicator';

/** Overview of the selected branch: boards, members, recent activity. */
export default function Dashboard() {
  const { user, org, tenant, role, canManage, isOrgAdmin, refresh, organizations } = useAuth();
  const [boards, setBoards] = useState(null);
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [orgName, setOrgName] = useState('');
  const [err, setErr] = useState('');
  const tenantId = tenant?.id;
  const { status, presence } = useRealtime(tenantId);

  const load = useCallback(() => {
    if (!tenantId) return;
    api.get('/boards').then((r) => setBoards(r.data)).catch((e) => setErr(errorMessage(e)));
  }, [tenantId]);
  useEffect(() => { setBoards(null); load(); }, [load]);   // clear previous tenant's data first
  useSocketEvent('board:updated', load);

  const guard = (fn) => async (e) => { e.preventDefault(); setErr(''); try { await fn(); } catch (ex) { setErr(errorMessage(ex)); } };
  const createBoard = guard(async () => { await api.post('/boards', { name }); setName(''); load(); });
  const createBranch = guard(async () => { await api.post('/tenants', { organizationId: org.id, name: branch }); setBranch(''); await refresh(); });
  const createOrg = guard(async () => { await api.post('/organizations', { name: orgName }); setOrgName(''); await refresh(); });
  const removeBoard = async (id) => { if (window.confirm('Delete this board and all its tasks?')) { await api.delete(`/boards/${id}`).catch((e) => setErr(errorMessage(e))); load(); } };

  return (
    <main className="page">
      {err && <div className="error">{err}</div>}

      {!organizations.length && (
        <div className="card">
          <h3>Welcome, {user.name}!</h3>
          <p className="muted">You are not a member of any organization yet. Create one (you become its Org Admin), or ask an admin to add you.</p>
        </div>
      )}
      {(!organizations.length || isOrgAdmin) && (
        <div className="card">
          <h3>Create a new organization</h3>
          <form className="row wrap" onSubmit={createOrg}>
            <input required placeholder="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            <button className="btn sm">Create</button>
          </form>
        </div>
      )}
      {org && isOrgAdmin && (
        <div className="card">
          <h3>Add a branch (tenant) to {org.name}</h3>
          <form className="row wrap" onSubmit={createBranch}>
            <input required placeholder="e.g. Pune" value={branch} onChange={(e) => setBranch(e.target.value)} />
            <button className="btn sm">Add branch</button>
          </form>
        </div>
      )}

      {tenant && (
        <>
          <div className="page-head">
            <div><h2>{org.name} · {tenant.name}</h2><span className="muted">Your role here: {role.replace('_', ' ')}</span></div>
            <PresenceIndicator users={presence} meId={user.id} status={status} />
          </div>
          <div className="dash-grid">
            <div>
              <div className="card">
                <h3>Boards</h3>
                {boards === null ? <div className="muted">Loading…</div> : (
                  <div className="board-grid">
                    {boards.map((b) => (
                      <div key={b.id} className="board-tile">
                        <Link to={`/boards/${b.id}`}><strong>{b.name}</strong><div className="muted small">{b.description || 'No description'}</div></Link>
                        {canManage && <button className="icon-btn" title="Delete board" onClick={() => removeBoard(b.id)}>🗑</button>}
                      </div>
                    ))}
                    {!boards.length && <div className="muted">No boards yet.{canManage ? ' Create the first one below.' : ''}</div>}
                  </div>
                )}
                {canManage && (
                  <form className="row wrap" style={{ marginTop: 12 }} onSubmit={createBoard}>
                    <input required placeholder="New board name" value={name} onChange={(e) => setName(e.target.value)} />
                    <button className="btn primary sm">Create board</button>
                  </form>
                )}
              </div>
              <MembersPanel tenantId={tenant.id} canManage={canManage} meId={user.id} />
            </div>
            <div className="card"><h3>Recent activity</h3><ActivityLog tenantId={tenant.id} limit={25} /></div>
          </div>
        </>
      )}
      {org && !tenant && <div className="card muted">This organization has no branches yet.</div>}
    </main>
  );
}
