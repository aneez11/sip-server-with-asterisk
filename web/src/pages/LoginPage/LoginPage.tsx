import { useState } from 'react';
import { ArrowRight, Check, MonitorSpeaker, Moon, Sun } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useTheme } from '@/lib/theme';

export const LoginPage = ({ onLogin }: { onLogin: () => void }) => {
  const { theme, toggle } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.login(username, password);
      if (res.ok) onLogin();
      else setError(res.message ?? 'Login failed');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <section className="login-art" aria-label="Infinity Echo paging console">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <MonitorSpeaker size={20} />
          </span>
          <b>Infinity Echo</b>
          <small>Institute SIP paging · LAN only</small>
        </div>
        <div className="login-pitch">
          <h1>One console for every announcement.</h1>
          <p>
            Broadcast to phones and IP speakers, page live, run music, and watch
            every device answer — all from a single operator screen.
          </p>
          <ul>
            <li>
              <Check size={14} /> Zone, PA-group and per-endpoint targeting
            </li>
            <li>
              <Check size={14} /> Live talk and two-way calls with camera preview
            </li>
            <li>
              <Check size={14} /> Per-device receive status and broadcast history
            </li>
          </ul>
        </div>
        <div className="login-meta">
          <span>Infinity Echo · Asterisk AMI</span>
          <span className="chip">LAN deployment</span>
        </div>
      </section>

      <section className="login-panel">
        <button
          type="button"
          className="icon-btn login-theme"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <form className="login-card" onSubmit={(e) => void submit(e)}>
          <header>
            <h2>Sign in to the console</h2>
            <p>Use your operator credentials to open the paging console.</p>
          </header>

          <div className="field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              placeholder="operator"
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Password"
            />
          </div>

          {error ? (
            <div className="form-error" role="alert">
              <span>{error}</span>
            </div>
          ) : null}

          <button type="submit" className="btn primary login-submit" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <ArrowRight size={17} />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-api">
            API: <code>{window.location.origin}/api</code>
          </p>
        </form>
      </section>
    </div>
  );
};
