import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setActiveTenant } from '../services/api';
import { closeSocket } from '../services/socket';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Holds: logged-in user, the organizations/tenants they may access (from the
 * server), and which org + tenant is currently selected.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [orgId, setOrgId] = useState(localStorage.getItem('orgId'));
  const [tenantId, setTenantId] = useState(localStorage.getItem('tenantId'));
  const [loading, setLoading] = useState(!!localStorage.getItem('token'));

  const refresh = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.user);
    setOrganizations(data.organizations);
    return data;
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    refresh().catch(() => localStorage.removeItem('token')).finally(() => setLoading(false));
  }, [refresh]);

  // Keep the selection valid: it must point to an org/tenant the server listed.
  useEffect(() => {
    if (!organizations.length) return;
    const org = organizations.find((o) => o.id === orgId) || organizations[0];
    const tenant = org.tenants.find((t) => t.id === tenantId) || org.tenants[0];
    if (org.id !== orgId) setOrgId(org.id);
    if ((tenant?.id || null) !== tenantId) setTenantId(tenant?.id || null);
  }, [organizations, orgId, tenantId]);

  // Persist the selection and tell the API client which tenant is active.
  setActiveTenant(tenantId); // synchronous on purpose: child effects fetch right after render
  useEffect(() => {
    orgId ? localStorage.setItem('orgId', orgId) : localStorage.removeItem('orgId');
    tenantId ? localStorage.setItem('tenantId', tenantId) : localStorage.removeItem('tenantId');
  }, [orgId, tenantId]);

  const authenticate = async (path, body) => {
    const { data } = await api.post(path, body);
    localStorage.setItem('token', data.token);
    await refresh();
  };
  const login = (email, password) => authenticate('/auth/login', { email, password });
  const register = (name, email, password) => authenticate('/auth/register', { name, email, password });
  const logout = () => {
    closeSocket();
    localStorage.clear();
    setActiveTenant(null);
    setUser(null); setOrganizations([]); setOrgId(null); setTenantId(null);
  };

  const org = organizations.find((o) => o.id === orgId) || null;
  const tenant = org?.tenants.find((t) => t.id === tenantId) || null;
  const role = tenant?.role || (org?.isOrgAdmin ? 'org_admin' : null);

  const value = useMemo(() => ({
    user, organizations, org, tenant, role, loading,
    selectOrg: (id) => { setOrgId(id); setTenantId(null); },   // tenant is re-picked by the effect above
    selectTenant: setTenantId,
    login, register, logout, refresh,
    canManage: role === 'tenant_admin' || role === 'org_admin',
    isOrgAdmin: !!org?.isOrgAdmin,
  }), [user, organizations, org, tenant, role, loading, refresh]); // eslint-disable-line

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
