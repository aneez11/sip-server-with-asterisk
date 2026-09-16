import { useState } from 'react';
import { MonitorSpeaker } from 'lucide-react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/Button/Button';
import { Input } from '@/components/Input/Input';

export const LoginPage = ({ onLogin }: { onLogin: () => void }) => {
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
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <form onSubmit={submit} className="w-[320px] rounded-xl border bg-card p-8 shadow-lg space-y-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-md bg-primary/15 flex items-center justify-center">
            <MonitorSpeaker className="w-5 h-5 text-primary" />
          </div>
          <div className="font-display font-semibold text-lg tracking-wide">Paging console</div>
          <div className="text-[11px] text-muted-foreground font-mono">Infinity Echo · Institute SIP PA</div>
        </div>
        <div className="space-y-2">
          <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <Button type="submit" className="w-full" disabled={busy}>Sign in</Button>
      </form>
    </div>
  );
};
