import { useCallback, useEffect, useState } from 'react';
import api, { errorMessage } from '../services/api';
import { useSocketEvent } from '../hooks/useRealtime';

const LABEL = { org_admin: 'Org Admin', tenant_admin: 'Tenant Admin', member: 'Member' };

/** Branch members. Tenant Admins can add / change role / remove. */
export default function MembersPanel({ tenantId, canManage, meId }) {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [err, setErr] = useState('');

  const load = useCallback(() => api.get(`/tenants/${tenantId}/members`).then((r) => setMembers(r.data)).catch(() => {}), [tenantId]);
  useEffect(() => { setMembers([]); load(); }, [load]);
  useSocketEvent('members:updated', load);

  const add = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post(`/tenants/${tenantId}/members`, { email, role }); setEmail(''); load(); }
    catch (ex) { setErr(errorMessage(ex)); }
  };
  const change = (uid, r) => api.patch(`/tenants/${tenantId}/members/${uid}`, { role: r }).then(load).catch((ex) => setErr(errorMessage(ex)));
  const remove = (uid) => api.delete(`/tenants/${tenantId}/members/${uid}`).then(load).catch((ex) => setErr(errorMessage(ex)));

  return (
    <div className="card">
      <h3>Team members</h3>
      <ul className="members">
        {members.map((m) => (
          <li key={m.id}>
            <div><strong>{m.name}</strong> <span className="muted small">{m.email}</span></div>
            {m.viaOrganization || !canManage || m.id === meId ? (
              <span className={`badge role-${m.role}`}>{LABEL[m.role]}{m.viaOrganization ? ' (org)' : ''}</span>
            ) : (
              <div className="row">
                <select value={m.role} onChange={(e) => change(m.id, e.target.value)}>
                  <option value="member">Member</option><option value="tenant_admin">Tenant Admin</option>
                </select>
                <button className="btn sm danger" onClick={() => remove(m.id)}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form onSubmit={add} className="row wrap" style={{ marginTop: 10 }}>
          <input type="email" required placeholder="Registered user's email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value)}><option value="member">Member</option><option value="tenant_admin">Tenant Admin</option></select>
          <button className="btn primary sm">Add</button>
        </form>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
