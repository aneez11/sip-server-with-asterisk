import { useState } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useStore } from '@/store';

const fmtClock = (d: Date | null) => {
  if (!d) return '—';
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

export const StatusBar = () => {
  const endpoints = useStore((s) => s.endpoints);
  const lastSync = useStore((s) => s.lastSync);
  const amiConnected = useStore((s) => s.amiConnected);
  const refresh = useStore((s) => s.refresh);
  const [refreshing, setRefreshing] = useState(false);

  const registered = endpoints.filter((e) => e.registered).length;
  const unreachable = endpoints.length - registered;

  const doRefresh = async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  return (
    <footer className="col-span-3 flex items-center justify-between px-4 h-8 bg-card border-t border-border text-xs">
      <span className="text-muted-foreground font-mono">
        Last sync {fmtClock(lastSync)} ·{' '}
        <span className={amiConnected ? 'text-emerald-400' : 'text-red-500'}>
          AMI {amiConnected ? 'connected' : 'disconnected'}
        </span>
      </span>
      <span className="flex items-center gap-3 text-muted-foreground">
        <button type="button" onClick={() => void doRefresh()} disabled={refreshing} className="flex items-center gap-1.5 hover:text-foreground transition-colors disabled:opacity-50" title="Refresh status now">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
        {endpoints.length === 0 ? (
          <span>No endpoints configured</span>
        ) : unreachable === 0 ? (
          <span className="flex items-center gap-1.5"><Wifi size={12} className="text-emerald-400" /> All endpoints registered</span>
        ) : (
          <span className="flex items-center gap-1.5"><WifiOff size={12} className="text-amber-400" /> {unreachable} endpoint{unreachable === 1 ? '' : 's'} unregistered</span>
        )}
      </span>
    </footer>
  );
};
