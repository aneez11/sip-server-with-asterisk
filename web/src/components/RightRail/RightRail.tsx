import { Mic, Radio, History, Music } from 'lucide-react';
import { useStore } from '@/store';
import { Badge } from '@/components/Badge/Badge';
import { Card, CardContent } from '@/components/Card/Card';
import { ScrollArea } from '@/components/ScrollArea/ScrollArea';
import { cn } from '@/lib/utils';

const fmtClock = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

export const RightRail = () => {
  const activeTab = useStore((s) => s.activeTab);
  const endpoints = useStore((s) => s.endpoints);
  const recentLogs = useStore((s) => s.recentLogs);
  const recording = useStore((s) => s.recording);
  const talkTargetIds = useStore((s) => s.talkTargetIds);
  const toggleTalkTarget = useStore((s) => s.toggleTalkTarget);
  const selectedZoneIds = useStore((s) => s.selectedZoneIds);
  const zones = useStore((s) => s.zones);
  const musicPlaying = useStore((s) => s.musicPlaying);
  const music = useStore((s) => s.music);
  const currentMusicId = useStore((s) => s.currentMusicId);
  const musicTargetIds = useStore((s) => s.musicTargetIds);
  const calls = useStore((s) => s.calls);

  const currentTrack = currentMusicId ? music.find((m) => m.id === currentMusicId) : null;

  const monitorCalls = calls?.active ?? [];
  const monitorTargets = monitorCalls.reduce((n, c) => n + c.members.length, 0);
  const monitorReceiving = monitorCalls.reduce((n, c) => n + c.members.filter((m) => m.status === 'receiving').length, 0);
  const monitorMissed = monitorCalls.reduce((n, c) => n + c.members.filter((m) => m.status === 'missed').length, 0);

  const active = recentLogs.filter((b) => b.status === 'pending');
  const history = recentLogs.filter((b) => b.status !== 'pending').slice(0, 8);
  const statusVariant = (status: string) => (status === 'success' ? 'default' : status === 'failed' ? 'destructive' : 'outline');

  const headerTitle = { broadcast: 'Broadcast history', media: 'Media library', monitor: 'Live monitor', talk: 'Live talk', music: 'Music player', endpoints: 'Endpoints', zones: 'Zones', history: 'History', 'pa-group': 'PA groups' }[activeTab];

  return (
    <aside className="flex flex-col overflow-hidden border-l border-border bg-card">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 border-b border-border">
        <div className="font-display font-semibold text-sm flex items-center gap-1.5">
          {activeTab === 'talk' ? <Mic size={14} /> : activeTab === 'history' ? <History size={14} /> : activeTab === 'music' ? <Music size={14} /> : <Radio size={14} />}
          {headerTitle}
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 py-2">
        {activeTab === 'talk' && (
          <>
            {endpoints.map((e) => {
              const online = e.registered && e.isActive;
              const live = talkTargetIds.has(e.id) && recording;
              const targeted = talkTargetIds.has(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={!online}
                  onClick={() => toggleTalkTarget(e.id)}
                  title={online ? 'Click to talk to this endpoint' : 'Endpoint not registered'}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors border mb-1.5',
                    !online && 'opacity-45 cursor-not-allowed bg-muted/20 border-border',
                    online && live && 'bg-red-500/10 border-red-500',
                    online && !live && targeted && 'bg-primary/5 border-primary/40',
                    online && !live && !targeted && 'bg-muted/50 border-transparent hover:border-primary/50',
                  )}
                >
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', !online ? 'bg-muted-foreground' : live ? 'bg-red-500 animate-pulse' : 'bg-emerald-400')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{e.label}</div>
                    <div className="text-muted-foreground text-[10px] truncate">{e.extension} · {e.location || '—'}</div>
                  </div>
                  <Badge variant={live ? 'destructive' : targeted ? 'default' : 'outline'} className={cn('text-[10px] px-1.5 py-0 flex-shrink-0', !live && !targeted && 'text-muted-foreground')}>
                    {live ? 'Live' : online ? (targeted ? 'Selected' : 'Online') : 'Offline'}
                  </Badge>
                </button>
              );
            })}
          </>
        )}

        {activeTab === 'broadcast' && (
          <>
            {history.length === 0 && active.length === 0 && (
              <div className="text-muted-foreground text-xs text-center py-8">Nothing broadcast yet</div>
            )}
            {history.map((b) => (
              <Card key={b.id} className="mb-2 bg-muted/30 border-border/50">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground text-xs font-medium truncate">{b.zoneName ?? 'Ad-hoc'}</div>
                      <div className="text-muted-foreground text-[10px] truncate">{fmtClock(b.startedAt)}</div>
                    </div>
                    <Badge variant={statusVariant(b.status)} className="text-[10px] px-1.5 py-0 flex-shrink-0">{b.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
            {active.map((b) => (
              <Card key={b.id} className="mb-2 bg-amber-500/10 border-amber-500/20">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-amber-500 text-xs font-semibold truncate flex items-center gap-1.5">
                        <Radio size={12} className="animate-pulse" />
                        {b.title || b.zoneName || 'Broadcast'}
                      </div>
                      <div className="text-muted-foreground text-[10px] truncate">{b.zoneName ?? 'Ad-hoc'} · {b.endpointIds?.length ?? 0} endpoint{(b.endpointIds?.length ?? 0) === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {activeTab === 'music' && (
          <>
            {musicPlaying ? (
              <Card className="mb-2 bg-emerald-500/10 border-emerald-500/20">
                <CardContent className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-emerald-500 text-xs font-semibold truncate flex items-center gap-1.5">
                        <Music size={12} className="animate-pulse" />
                        {currentTrack?.name ?? 'Playing'}
                      </div>
                      <div className="text-muted-foreground text-[10px] truncate">{musicTargetIds.length} endpoint{musicTargetIds.length === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-muted-foreground text-xs text-center py-8">Nothing playing — pick a track in the main panel.</div>
            )}
            <div className="text-muted-foreground text-[11px] px-2 py-1">{music.length} track{music.length === 1 ? '' : 's'} in library</div>
          </>
        )}

        {activeTab === 'monitor' && (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Active calls</span><span className="text-foreground font-semibold">{monitorCalls.length}</span></div>
              <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Targeted</span><span className="text-foreground font-semibold">{monitorTargets}</span></div>
              <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Receiving</span><span className="text-emerald-500 font-semibold">{monitorReceiving}</span></div>
              <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Unavailable</span><span className={cn('font-semibold', monitorMissed > 0 ? 'text-red-500' : 'text-foreground')}>{monitorMissed}</span></div>
            </div>
          </>
        )}

        {activeTab === 'history' && <div className="text-muted-foreground text-xs text-center py-8">Full history is in the main panel.</div>}        {activeTab === 'endpoints' && <div className="text-muted-foreground text-xs text-center py-8">Manage endpoints in the main panel.</div>}
        {activeTab === 'zones' && <div className="text-muted-foreground text-xs text-center py-8">Manage zones in the main panel.</div>}
      </ScrollArea>

      <div className="flex-shrink-0 border-t border-border bg-muted/30 px-4 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Endpoints</span><span className="text-foreground font-semibold">{endpoints.length}</span></div>
        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Registered</span><span className="text-emerald-500 font-semibold">{endpoints.filter((e) => e.registered).length}</span></div>
        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Zones selected</span><span className="text-foreground font-semibold">{selectedZoneIds.size}</span></div>
      </div>
    </aside>
  );
};
