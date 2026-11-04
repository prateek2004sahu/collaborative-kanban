import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../services/api';

export default function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (mode === 'register' && form.password !== form.confirm) return setErr('Passwords do not match');
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate('/');
    } catch (ex) {
      const d = ex.response?.data?.details;
      setErr(d ? d.map((x) => x.message).join(', ') : errorMessage(ex));
    } finally { setBusy(false); }
  };
  const demo = (email) => setForm({ ...form, email, password: 'Password@123' });

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>▦ Collaborative Kanban</h1>
        <p className="muted">{mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}</p>
        {mode === 'register' && <label>Full name<input required value={form.name} onChange={set('name')} /></label>}
        <label>Email<input type="email" required value={form.email} onChange={set('email')} /></label>
        <label>Password<input type="password" required minLength={mode === 'register' ? 8 : 1} value={form.password} onChange={set('password')} /></label>
        {mode === 'register' && <label>Confirm password<input type="password" required value={form.confirm} onChange={set('confirm')} /></label>}
        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Already registered? Sign in'}
        </button>
        {mode === 'login' && (
          <div className="demo">
            <div className="muted small">Demo accounts (password: Password@123)</div>
            <div className="row wrap">
              {[['rahul@abc.com', 'Rahul · Org Admin'], ['priya@abc.com', 'Priya · Tenant Admin'], ['arjun@abc.com', 'Arjun · Member'], ['sneha@abc.com', 'Sneha · Bangalore'], ['kiran@xyz.com', 'Kiran · XYZ']].map(([e, l]) => (
                <button type="button" key={e} className="chip" onClick={() => demo(e)}>{l}</button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
