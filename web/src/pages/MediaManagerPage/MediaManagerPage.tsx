import { useRef, useState } from 'react';
import { Play, Upload, Trash2, Mic, Square, Radio, Music as MusicIcon } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card, CardContent } from '@/components/Card/Card';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';

const fmtSize = (b: number) => {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
};
const fmtDur = (s: number | null | undefined) => {
  if (!s || s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/** Unified Media Manager — every uploaded sound (broadcast announcements +
 *  music tracks) in one place, shared by the broadcast window and music player. */
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
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {all.length} media item{all.length === 1 ? '' : 's'} · WAV / MP3 — shared by broadcast and music player
        </span>
        <div className="flex items-center gap-2">
          {recordingAnnouncement ? (
            <Button variant="destructive" size="sm" className="text-xs" onClick={() => void cancelAnnouncementRecording()}>
              <Square className="mr-1.5 h-3.5 w-3.5 fill-current" /> Recording — Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => void recordAnnouncement()}>
              <Mic className="mr-1.5 h-3.5 w-3.5" /> Record
            </Button>
          )}
          <input ref={fileRef} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAnnouncement(f); e.target.value = ''; }} />
          <Button variant="outline" size="sm" className="text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload
          </Button>
          <input ref={musicRef} type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadMusic(f); e.target.value = ''; }} />
          <Button variant="outline" size="sm" className="text-xs" onClick={() => musicRef.current?.click()} disabled={busy}>
            <MusicIcon className="mr-1.5 h-3.5 w-3.5" /> Add music
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
        {all.map((a) => (
          <Card key={`${a.music ? 'm' : 'a'}-${a.id}`} className="bg-card">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted/40 border border-border/60 text-[10px] text-muted-foreground flex-shrink-0">
                      {a.music ? <MusicIcon size={9} className="mr-0.5" /> : <Radio size={9} className="mr-0.5" />}
                      {a.music ? 'Music' : 'Announcement'}
                    </span>
                    <span className="text-sm font-medium truncate">{a.name}</span>
                  </div>
                  <div className="text-muted-foreground text-[10px] font-mono mt-1">{a.originalName} · {fmtSize(a.fileSize)}{a.duration ? ` · ${fmtDur(a.duration)}` : ''}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button className="p-1 text-muted-foreground hover:text-primary transition-colors" onClick={() => setPreviewId(previewId === a.id ? null : a.id)} title="Preview locally">
                    <Play size={13} />
                  </button>
                  <button className="p-1 text-muted-foreground hover:text-destructive transition-colors" onClick={() => onRemove(a.id, a.music)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {previewId === a.id && (
                <audio controls preload="auto" className="w-full h-8" src={api.announcements.audioUrl(a.id)} />
              )}
            </CardContent>
          </Card>
        ))}
        {all.length === 0 && (
          <div className={cn('col-span-full border rounded-xl bg-muted/30 p-10 text-center text-xs text-muted-foreground')}>
            No media yet — upload a WAV/MP3 or record a new announcement.
          </div>
        )}
      </div>
    </div>
  );
};
