import { useEffect, useMemo, useState } from 'react';
import {
  Library,
  Music2,
  Play,
  Radio,
  Search,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { Checkbox } from '@/components/Checkbox/Checkbox';
import { Input } from '@/components/Input/Input';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { formatDuration } from '@/lib/format';

const fmtSize = (b: number) => {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
};

const trackDuration = (fileSize: number) => fileSize / 32000;

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
  const removeMedia = useStore((s) => s.removeMedia);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const selectedZones = useStore((s) => s.selectedZoneIds);
  const toggleZone = useStore((s) => s.toggleZone);

  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!musicPlaying) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [musicPlaying, musicStartedAt]);

  const sortedMusic = useMemo(
    () => [...music].sort((a, b) => a.name.localeCompare(b.name)),
    [music],
  );

  const current = useMemo(
    () => sortedMusic.find((m) => m.id === currentMusicId) ?? null,
    [sortedMusic, currentMusicId],
  );
  const currentIndex = current ? sortedMusic.findIndex((m) => m.id === current.id) : -1;

  const targetedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const zid of selectedZones) {
      const zone = zones.find((z) => z.id === zid);
      for (const eid of zone?.endpointIds ?? []) ids.add(eid);
    }
    return endpoints.filter((e) => ids.has(e.id) && e.isActive).map((e) => e.id);
  }, [selectedZones, zones, endpoints]);

  const onlineInZones = useMemo(() => {
    const ids = new Set<number>();
    for (const zid of selectedZones) {
      const zone = zones.find((z) => z.id === zid);
      for (const eid of zone?.endpointIds ?? []) ids.add(eid);
    }
    return endpoints.filter((e) => ids.has(e.id) && e.registered).length;
  }, [selectedZones, zones, endpoints]);

  const duration = current ? trackDuration(current.fileSize) : 0;
  const elapsed =
    musicPlaying && musicStartedAt
      ? Math.max(0, (now - new Date(musicStartedAt).getTime()) / 1000)
      : 0;
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sortedMusic.filter((m) => m.name.toLowerCase().includes(q)) : sortedMusic;
  }, [sortedMusic, query]);

  const canPlay = targetedIds.length > 0 && sortedMusic.length > 0;

  const toggle = () => {
    if (musicPlaying) {
      stopMusic();
      return;
    }
    const id = currentMusicId ?? sortedMusic[0]?.id;
    if (id == null) {
      useStore.getState().addToast('No music in the library yet');
      return;
    }
    if (!canPlay) {
      useStore.getState().addToast('Select at least one zone to stream to');
      return;
    }
    void playMusic(id, targetedIds);
  };

  const clearZones = () => {
    for (const id of [...selectedZones]) toggleZone(id);
  };

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Music player"
        subtitle="Stream the playlist to selected zones — tracks auto-advance while playing."
        actions={
          <Button variant="outline" size="sm" onClick={() => setActiveTab('media')}>
            <Library size={13} /> Media library
          </Button>
        }
      />

      <div className="music-layout">
        <div className="music-column">
          <section className={`now-card${musicPlaying ? ' on-air' : ''}`}>
            <div className="now-top">
              <span className="now-kicker">
                <i className="now-dot" />
                {musicPlaying ? 'On air' : 'Ready'}
              </span>
              <span className="now-library">{sortedMusic.length} track{sortedMusic.length === 1 ? '' : 's'}</span>
            </div>

            <div className="now-body">
              <div className={`now-art${musicPlaying ? ' playing' : ''}`}>
                <Music2 size={42} />
              </div>
              <div className="now-info">
                <small>{musicPlaying ? 'Now playing' : 'Nothing playing'}</small>
                <h2>{musicPlaying && current ? current.name : 'Pick a track to begin'}</h2>
                <p>
                  {musicPlaying && current
                    ? `Track ${currentIndex + 1} of ${sortedMusic.length} · ${fmtSize(current.fileSize)}`
                    : 'Choose a zone below, then press play.'}
                </p>
              </div>
            </div>

            <div className="now-progress">
              <div className="now-bar">
                <i style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="now-times">
                <span>{formatDuration(elapsed)}</span>
                <span>{formatDuration(Math.max(0, duration - elapsed))}</span>
              </div>
            </div>

            <div className="now-controls">
              <button
                type="button"
                className="now-skip"
                onClick={() => void prevMusic()}
                disabled={!musicPlaying || sortedMusic.length < 2}
                title="Previous track"
              >
                <SkipBack size={18} />
              </button>
              <button
                type="button"
                className="now-main"
                onClick={toggle}
                disabled={busy || (!musicPlaying && !canPlay)}
                title={musicPlaying ? 'Stop music' : 'Play playlist'}
              >
                {musicPlaying ? <Square size={20} className="fill-current" /> : <Play size={24} className="fill-current" />}
              </button>
              <button
                type="button"
                className="now-skip"
                onClick={() => void nextMusic()}
                disabled={!musicPlaying || sortedMusic.length < 2}
                title="Next track"
              >
                <SkipForward size={18} />
              </button>
            </div>

            <div className="now-foot">
              <span>
                <Volume2 size={13} />
                {musicPlaying
                  ? `Live to ${musicTargetIds.length} endpoint${musicTargetIds.length === 1 ? '' : 's'}`
                  : `${targetedIds.length} endpoint${targetedIds.length === 1 ? '' : 's'} targeted`}
              </span>
              {musicPlaying ? (
                <button type="button" className="now-stop" onClick={() => stopMusic()}>
                  Stop
                </button>
              ) : (
                <span className="now-hint">
                  {targetedIds.length === 0 ? 'Select a zone' : `${onlineInZones} online`}
                </span>
              )}
            </div>
          </section>

          <Card className="zone-card">
            <div className="zone-head">
              <div>
                <b>Stream to</b>
                <small>
                  {targetedIds.length} endpoint{targetedIds.length === 1 ? '' : 's'} · {onlineInZones} online
                </small>
              </div>
              {selectedZones.size > 0 && (
                <button type="button" className="btn ghost small" onClick={clearZones}>
                  Clear
                </button>
              )}
            </div>

            {zones.length === 0 ? (
              <div className="state state-empty" style={{ minHeight: 90 }}>
                No zones configured yet.
              </div>
            ) : (
              <div className="zone-options">
                {zones.map((zone) => {
                  const members = endpoints.filter((e) => zone.endpointIds.includes(e.id));
                  const online = members.filter((e) => e.registered).length;
                  const on = selectedZones.has(zone.id);
                  return (
                    <label key={zone.id} className={`zone-option${on ? ' on' : ''}`}>
                      <Checkbox checked={on} onCheckedChange={() => toggleZone(zone.id)} />
                      <span className="zone-option-main">
                        <b>{zone.name}</b>
                        <small>
                          {online}/{members.length} online
                        </small>
                      </span>
                      <span className="zone-option-count">{zone.endpointCount}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card className="playlist-card">
          <div className="playlist-head">
            <div className="playlist-title">
              <b>Playlist</b>
              <small>{sortedMusic.length} tracks</small>
            </div>
            <div className="playlist-search">
              <Search size={14} />
              <Input
                placeholder="Search tracks"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search tracks"
              />
            </div>
          </div>

          <div className="playlist-list">
            {filtered.length === 0 && (
              <div className="state state-empty" style={{ minHeight: 120 }}>
                {sortedMusic.length === 0
                  ? 'No music yet — add music media in the library.'
                  : `No tracks match “${query.trim()}”.`}
              </div>
            )}
            {filtered.map((m) => {
              const isCurrent = musicPlaying && current?.id === m.id;
              return (
                <div key={m.id} className={`track-card${isCurrent ? ' on' : ''}`}>
                  <button
                    type="button"
                    className="track-play"
                    onClick={() => void playMusic(m.id, targetedIds)}
                    disabled={!targetedIds.length}
                    title="Play this track"
                  >
                    <span className="track-thumb">
                      {isCurrent ? (
                        <span className="eq" aria-label="Playing">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : (
                        <Music2 size={15} />
                      )}
                    </span>
                    <span className="track-main">
                      <b>{m.name}</b>
                      <small>{isCurrent ? 'Now playing' : fmtSize(m.fileSize)}</small>
                    </span>
                    <span className="track-duration">{formatDuration(trackDuration(m.fileSize))}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-link danger track-delete"
                    onClick={() => void removeMedia(m.id)}
                    title="Remove from playlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="playlist-foot">
            <span>
              <Radio size={12} /> {musicPlaying ? 'Streaming' : 'Idle'}
            </span>
            <span>{selectedZones.size} zone{selectedZones.size === 1 ? '' : 's'} selected</span>
          </div>
        </Card>
      </div>
    </div>
  );
};
