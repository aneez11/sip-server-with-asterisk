import { useMemo, useRef } from 'react';
import { Music2, Play, Radio, SkipBack, SkipForward, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { Checkbox } from '@/components/Checkbox/Checkbox';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';

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

  const selectedZones = useStore((s) => s.selectedZoneIds);
  const toggleZone = useStore((s) => s.toggleZone);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const duration = current ? current.fileSize / 32000 : 0;
  const elapsed = musicPlaying && musicStartedAt ? Math.max(0, (Date.now() - new Date(musicStartedAt).getTime()) / 1000) : 0;
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  const handleTogglePlay = () => {
    if (musicPlaying) {
      stopMusic();
      return;
    }
    const id = currentMusicId ?? music[0]?.id;
    if (id == null) {
      useStore.getState().addToast('No music in the library yet');
      return;
    }
    void playMusic(id, targetedIds);
  };

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Music player"
        subtitle="Play uploaded music to the endpoints in the selected zones. Tracks auto-advance through the playlist while playing."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".wav,audio/wav"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadMusic(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={13} /> Upload music
            </Button>
          </>
        }
      />

      <div className="music-grid">
        <Card className="now-playing">
          <div className="card-title" style={{ marginBottom: 10 }}>Now playing</div>
          <div className={`album-art${musicPlaying ? ' playing' : ''}`}>
            <span className="album-icon">
              <Music2 size={38} className={musicPlaying ? 'animate-pulse' : ''} />
            </span>
            <div style={{ minWidth: 0, maxWidth: '100%' }}>
              <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {musicPlaying && current ? current.name : 'Nothing playing'}
              </b>
              <small>
                {musicPlaying && current
                  ? `Track ${music.findIndex((m) => m.id === current.id) + 1} of ${music.length}`
                  : 'Select a track from the playlist and press play'}
              </small>
            </div>
          </div>

          <div className="stack-sm">
            <div className="meter-thin">
              <i style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="inline" style={{ justifyContent: 'space-between', font: 'var(--font-mono)', fontSize: 11, color: 'var(--mut)' }}>
              <span>{fmtDur(elapsed)}</span>
              <span>-{fmtDur(Math.max(0, duration - elapsed))}</span>
            </div>
          </div>

          <div className="play-controls">
            <Button variant="outline" size="icon" onClick={() => void prevMusic()} disabled={!musicPlaying || music.length < 2} title="Previous track">
              <SkipBack size={16} />
            </Button>
            <Button
              variant={musicPlaying ? 'destructive' : 'default'}
              size="icon"
              className="play-main"
              onClick={handleTogglePlay}
              disabled={busy}
              title={musicPlaying ? 'Stop music' : 'Play'}
            >
              {musicPlaying ? <Square size={18} /> : <Play size={20} />}
            </Button>
            <Button variant="outline" size="icon" onClick={() => void nextMusic()} disabled={!musicPlaying || music.length < 2} title="Next track">
              <SkipForward size={16} />
            </Button>
          </div>

          <div className="inline muted tiny" style={{ justifyContent: 'center', width: '100%' }}>
            <Volume2 size={12} />
            {musicPlaying
              ? `Playing to ${musicTargetIds.length} endpoint${musicTargetIds.length === 1 ? '' : 's'}`
              : 'Stream to the selected zones'}
          </div>
        </Card>

        <Card className="stack" style={{ minHeight: 0 }}>
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h3 className="card-title" style={{ margin: 0 }}>
              Playlist <span className="muted" style={{ fontWeight: 400 }}>({music.length})</span>
            </h3>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="stack-sm">
            {music.length === 0 && (
              <div className="state state-empty" style={{ minHeight: 120 }}>
                No music yet — upload a WAV file to build a playlist.
              </div>
            )}
            {music.map((m, i) => {
              const isCurrent = musicPlaying && current?.id === m.id;
              return (
                <div key={m.id} className={`track-row${isCurrent ? ' on' : ''}`}>
                  <button
                    type="button"
                    className="track-play"
                    onClick={() => void playMusic(m.id, targetedIds)}
                    title="Play this track"
                  >
                    <span className="track-index">
                      {isCurrent ? <Radio size={13} className="animate-pulse" /> : i + 1}
                    </span>
                    <div className="track-main">
                      <b>{m.name}</b>
                      <small>
                        {fmtSize(m.fileSize)}
                        {isCurrent ? <span className="ok-text"> · playing</span> : null}
                      </small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="icon-link danger"
                    onClick={() => void removeMusic(m.id)}
                    title="Remove from playlist"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <div className="zone-picker">
          <span>Stream to:</span>
          {zones.length === 0 && <span className="muted tiny">No zones configured yet.</span>}
          {zones.map((zone) => {
            const zs = endpoints.filter((e) => zone.endpointIds.includes(e.id));
            const online = zs.filter((e) => e.registered).length;
            return (
              <label key={zone.id} className={`zone-chip${selectedZones.has(zone.id) ? ' on' : ''}`}>
                <Checkbox checked={selectedZones.has(zone.id)} onCheckedChange={() => toggleZone(zone.id)} />
                <span>{zone.name}</span>
                <span className="num">
                  {online}/{zs.length}
                </span>
              </label>
            );
          })}
          {musicPlaying && (
            <span className="inline ok-text tiny" style={{ marginLeft: 'auto', gap: 6 }}>
              <Radio size={12} className="animate-pulse" />
              Streaming to {musicTargetIds.length} endpoint{musicTargetIds.length === 1 ? '' : 's'}
              <button className="btn link small" onClick={() => stopMusic()}>
                stop
              </button>
            </span>
          )}
          {!musicPlaying && targetedIds.length > 0 && (
            <span className="muted tiny" style={{ marginLeft: 'auto' }}>
              {targetedIds.length} endpoint{targetedIds.length === 1 ? '' : 's'} targeted ({onlineInZones} registered)
            </span>
          )}
        </div>
      </Card>
    </div>
  );
};
