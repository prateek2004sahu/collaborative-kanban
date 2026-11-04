import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_LABEL = { org_admin: 'Org Admin', tenant_admin: 'Tenant Admin', member: 'Member' };

/** Top bar = Organization selector + Tenant (branch) switcher + user menu. */
export default function Navbar() {
  const { user, organizations, org, tenant, role, selectOrg, selectTenant, logout } = useAuth();
  const navigate = useNavigate();
  const changeTenant = (id) => { selectTenant(id); navigate('/'); };   // leave the old tenant's board immediately
  const changeOrg = (id) => { selectOrg(id); navigate('/'); };

  return (
    <nav className="navbar">
      <Link to="/" className="brand">▦ Kanban</Link>
      <div className="selectors">
        <label className="sel"><span>Organization</span>
          <select value={org?.id || ''} onChange={(e) => changeOrg(e.target.value)}>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="sel"><span>Branch</span>
          <select value={tenant?.id || ''} onChange={(e) => changeTenant(e.target.value)} disabled={!org?.tenants.length}>
            {org?.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {!org?.tenants.length && <option>No branches</option>}
          </select>
        </label>
        {role && <span className={`badge role-${role}`}>{ROLE_LABEL[role]}</span>}
      </div>
      <div className="user">
        <span className="muted small hide-sm">{user?.name}</span>
        <button className="btn sm" onClick={() => { logout(); navigate('/login'); }}>Logout</button>
      </div>
    </nav>
  );
}
