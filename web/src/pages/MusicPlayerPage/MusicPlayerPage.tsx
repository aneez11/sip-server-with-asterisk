import { useEffect, useMemo, useRef, useState } from 'react';
import { Music, Play, Radio, SkipBack, SkipForward, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/Card/Card';
import { Checkbox } from '@/components/Checkbox/Checkbox';
import { cn } from '@/lib/utils';

const fmtSize = (b: number) => {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
};

const fmtDur = (s: number) => {
  const sec = Math.max(0, Math.round(s));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

export const MusicPlayerPage = () => {
  const music = useStore((s) => s.music);
  const endpoints = useStore((s) => s.endpoints);
  const zones = useStore((s) => s.zones);
  const busy = useStore((s) => s.busy);
  const musicPlaying = useStore((s) => s.musicPlaying);
  const currentMusicId = useStore((s) => s.currentMusicId);
  const musicStartedAt = useStore((s) => s.musicStartedAt);
  const musicTargetIds = useStore((s) => s.musicTargetIds);
  const playMusic = useStore((s) => s.playMusic);
  const stopMusic = useStore((s) => s.stopMusic);
  const nextMusic = useStore((s) => s.nextMusic);
  const prevMusic = useStore((s) => s.prevMusic);
  const uploadMusic = useStore((s) => s.uploadMusic);
  const removeMusic = useStore((s) => s.removeMusic);

  const [selectedZones, setSelectedZones] = useState<Set<number>>(() => new Set(useStore.getState().selectedZoneIds));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (musicPlaying) return;
    const st = useStore.getState();
    if (selectedZones.size === 0 && st.selectedZoneIds.size > 0) setSelectedZones(new Set(st.selectedZoneIds));
  }, [musicPlaying, selectedZones]);

  const current = useMemo(() => music.find((m) => m.id === currentMusicId) ?? null, [music, currentMusicId]);

  const targetedIds = useMemo(() => {
    const zoneSet = Array.from(selectedZones).map((zid) => zones.find((z) => z.id === zid)).filter(Boolean);
    const ids = new Set<number>();
    for (const z of zoneSet) for (const eid of z!.endpointIds) ids.add(eid);
    return endpoints.filter((e) => ids.has(e.id) && e.isActive).map((e) => e.id);
  }, [selectedZones, zones, endpoints]);

  const onlineInZones = useMemo(() => {
    const zoneSet = Array.from(selectedZones).map((zid) => zones.find((z) => z.id === zid)).filter(Boolean);
    const ids = new Set<number>();
    for (const z of zoneSet) for (const eid of z!.endpointIds) ids.add(eid);
    return endpoints.filter((e) => ids.has(e.id)).filter((e) => e.registered).length;
  }, [selectedZones, zones, endpoints]);

  // Normalized files are 16 kHz mono 16-bit PCM → 32000 bytes per second.
  const duration = current ? current.fileSize / 32000 : 0;
  const elapsed = musicPlaying && musicStartedAt ? Math.max(0, (Date.now() - new Date(musicStartedAt).getTime()) / 1000) : 0;
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  const toggleZone = (id: number) => setSelectedZones((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const handleTogglePlay = () => {
    if (musicPlaying) { stopMusic(); return; }
    const id = currentMusicId ?? music[0]?.id;
    if (id == null) { useStore.getState().addToast('No music in the library yet'); return; }
    void playMusic(id, targetedIds);
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Music player</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Play uploaded music to the endpoints in the selected zones. Tracks auto-advance through the playlist while playing.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".wav,audio/wav"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMusic(f); e.target.value = ''; }}
        />
        <Button variant="outline" size="sm" className="text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Upload music
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 flex-1 min-h-0">
        {/* Now playing */}
        <Card className="lg:col-span-2 flex flex-col min-h-0">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-sm font-semibold">Now playing</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4 pt-0">
            <div className={cn('rounded-xl flex flex-col items-center justify-center gap-3 py-8 px-4 transition-colors', musicPlaying ? 'bg-primary/10' : 'bg-muted/40')}>
              <div className="w-24 h-24 rounded-2xl bg-primary/15 flex items-center justify-center text-primary">
                <Music size={40} className={musicPlaying ? 'animate-pulse' : ''} />
              </div>
              <div className="text-center min-w-0 w-full">
                <div className="text-base font-semibold truncate max-w-full">{musicPlaying && current ? current.name : 'Nothing playing'}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {musicPlaying && current ? `Track ${music.findIndex((m) => m.id === current.id) + 1} of ${music.length}` : 'Select a track from the playlist and press play'}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>{fmtDur(elapsed)}</span>
                <span>-{fmtDur(Math.max(0, duration - elapsed))}</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => void prevMusic()} disabled={!musicPlaying || music.length < 2} title="Previous track">
                <SkipBack size={16} />
              </Button>
              <Button variant={musicPlaying ? 'destructive' : 'default'} size="icon" className="h-14 w-14 rounded-full" onClick={handleTogglePlay} disabled={busy} title={musicPlaying ? 'Stop music' : 'Play'}>
                {musicPlaying ? <Square size={18} /> : <Play size={20} />}
              </Button>
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => void nextMusic()} disabled={!musicPlaying || music.length < 2} title="Next track">
                <SkipForward size={16} />
              </Button>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <Volume2 size={12} />
              {musicPlaying ? `Playing to ${musicTargetIds.length} endpoint${musicTargetIds.length === 1 ? '' : 's'}` : 'Stream to the selected zones'}
            </div>
          </CardContent>
        </Card>

        {/* Playlist */}
        <Card className="lg:col-span-3 flex flex-col min-h-0">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-sm font-semibold">
              Playlist <span className="text-muted-foreground font-normal">({music.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-1.5 pt-0">
            {music.length === 0 && (
              <div className="text-muted-foreground text-xs text-center py-8">
                No music yet — upload a WAV file to build a playlist.
              </div>
            )}
            {music.map((m, i) => {
              const isCurrent = musicPlaying && current?.id === m.id;
              return (
                <div
                  key={m.id}
                  className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors cursor-pointer', isCurrent ? 'bg-primary/10 border-primary/40' : 'bg-muted/50 border-border hover:border-primary/50')}
                  onClick={() => void playMusic(m.id, targetedIds)}
                  title="Play this track"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                    {isCurrent ? <Radio size={14} className="animate-pulse" /> : <span className="font-mono text-[10px]">{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-sm truncate', isCurrent && 'font-medium')}>{m.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtSize(m.fileSize)}
                      {isCurrent && <span className="text-primary ml-1.5">&middot; playing</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); void removeMusic(m.id); }}
                    title="Remove from playlist"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Zones */}
      <Card className="flex-shrink-0">
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground mr-1 flex-shrink-0">Stream to:</span>
          {zones.length === 0 && <span className="text-xs text-muted-foreground">No zones configured yet.</span>}
          {zones.map((zone) => {
            const zs = endpoints.filter((e) => zone.endpointIds.includes(e.id));
            const online = zs.filter((e) => e.registered).length;
            return (
              <label key={zone.id} className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors', selectedZones.has(zone.id) ? 'bg-primary/5 border-primary/40' : 'bg-muted/50 border-border hover:border-primary/50')}>
                <Checkbox checked={selectedZones.has(zone.id)} onCheckedChange={() => toggleZone(zone.id)} className="h-3.5 w-3.5" />
                <span className="text-xs truncate">{zone.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{online}/{zs.length}</span>
              </label>
            );
          })}
          {musicPlaying && (
            <span className="flex items-center gap-1.5 ml-auto text-[11px] text-emerald-500 flex-shrink-0">
              <Radio size={12} className="animate-pulse" />
              Streaming to {musicTargetIds.length} endpoint{musicTargetIds.length === 1 ? '' : 's'} &middot;{' '}
              <button className="underline hover:text-destructive" onClick={() => stopMusic()}>stop</button>
            </span>
          )}
          {!musicPlaying && targetedIds.length > 0 && (
            <span className="flex items-center gap-1.5 ml-auto text-[11px] text-muted-foreground flex-shrink-0">
              {targetedIds.length} endpoint{targetedIds.length === 1 ? '' : 's'} targeted ({onlineInZones} registered)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
