import { useRef, useState } from 'react';
import { Mic, Music2, Play, Radio, Square, Trash2, Upload } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { formatDurationOrBlank } from '@/lib/format';
import { api } from '@/lib/api/client';

const fmtSize = (b: number) => {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
};

/** Unified media library — announcements and music in one place. */
export const MediaManagerPage = () => {
  const announcements = useStore((s) => s.announcements);
  const music = useStore((s) => s.music);
  const busy = useStore((s) => s.busy);
  const uploadAnnouncement = useStore((s) => s.uploadAnnouncement);
  const removeAnnouncement = useStore((s) => s.removeAnnouncement);
  const recordingAnnouncement = useStore((s) => s.recordingAnnouncement);
  const recordAnnouncement = useStore((s) => s.recordAnnouncement);
  const cancelAnnouncementRecording = useStore((s) => s.cancelAnnouncementRecording);
  const uploadMusic = useStore((s) => s.uploadMusic);
  const removeMusic = useStore((s) => s.removeMusic);

  const fileRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);

  const all = [
    ...announcements.map((m) => ({ ...m, music: false })),
    ...music.map((m) => ({ ...m, music: true })),
  ];

  const onRemove = (id: number, musicType: boolean) => {
    if (musicType) void removeMusic(id);
    else void removeAnnouncement(id);
  };

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Media library"
        subtitle={`${all.length} item${all.length === 1 ? '' : 's'} · WAV / MP3 — shared by broadcast and the music player`}
        actions={
          <>
            {recordingAnnouncement ? (
              <Button variant="destructive" size="sm" onClick={() => void cancelAnnouncementRecording()}>
                <Square size={13} className="fill-current" /> Recording — Stop
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void recordAnnouncement()}>
                <Mic size={13} /> Record
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAnnouncement(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={13} /> Upload
            </Button>
            <input
              ref={musicRef}
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadMusic(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" size="sm" onClick={() => musicRef.current?.click()} disabled={busy}>
              <Music2 size={13} /> Add music
            </Button>
          </>
        }
      />

      <div className="grid-cards">
        {all.map((a) => (
          <Card key={`${a.music ? 'm' : 'a'}-${a.id}`}>
            <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span className="media-tag">
                    {a.music ? <Music2 size={9} /> : <Radio size={9} />}
                    {a.music ? 'Music' : 'Announcement'}
                  </span>
                  <b
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.name}
                  </b>
                </div>
                <div className="announce-meta">
                  {a.originalName} · {fmtSize(a.fileSize)}
                  {a.duration ? ` · ${formatDurationOrBlank(a.duration)}` : ''}
                </div>
              </div>
              <div className="inline" style={{ gap: 2, flexShrink: 0 }}>
                <button
                  type="button"
                  className="icon-link"
                  onClick={() => setPreviewId(previewId === a.id ? null : a.id)}
                  title="Preview locally"
                >
                  <Play size={13} />
                </button>
                <button
                  type="button"
                  className="icon-link danger"
                  onClick={() => onRemove(a.id, a.music)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {previewId === a.id && (
              <audio
                controls
                preload="auto"
                style={{ width: '100%', height: 32, marginTop: 10 }}
                src={api.announcements.audioUrl(a.id)}
              />
            )}
          </Card>
        ))}
        {all.length === 0 && (
          <div className="state state-empty" style={{ gridColumn: '1 / -1' }}>
            No media yet — upload a WAV/MP3 or record a new announcement.
          </div>
        )}
      </div>
    </div>
  );
};
