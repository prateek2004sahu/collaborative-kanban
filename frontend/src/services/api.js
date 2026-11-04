import axios from 'axios';

// All REST calls go through this axios instance.
const api = axios.create({ baseURL: (import.meta.env.VITE_API_URL || '') + '/api' });

// The tenant the user is currently working in. The backend re-validates it on
// EVERY request (we never rely on this value being honest).
let activeTenant = null;
export const setActiveTenant = (id) => { activeTenant = id; };

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  if (activeTenant) cfg.headers['X-Tenant-Id'] = activeTenant;
  return cfg;
});

api.interceptors.response.use((r) => r, (err) => {
  if (err.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  return Promise.reject(err);
});

export const errorMessage = (e) => e.response?.data?.error || e.message || 'Something went wrong';
export default api;
