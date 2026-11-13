import { useRef, useState } from 'react';
import { Mic, Music2, Pencil, Play, Radio, Square, Trash2, Upload } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { Input } from '@/components/Input/Input';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { Switch } from '@/components/Switch/Switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/Dialog/Dialog';
import { api } from '@/lib/api/client';
import { formatDurationOrBlank } from '@/lib/format';

const fmtSize = (b: number) => {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
};

type AvailabilityField = 'broadcast' | 'music';

/** Single media library shared by Broadcast and the Music player. */
export const MediaManagerPage = () => {
  const media = useStore((s) => s.media);
  const busy = useStore((s) => s.busy);
  const uploadMedia = useStore((s) => s.uploadMedia);
  const updateMediaAvailability = useStore((s) => s.updateMediaAvailability);
  const removeMedia = useStore((s) => s.removeMedia);
  const recordingAnnouncement = useStore((s) => s.recordingAnnouncement);
  const recordAnnouncement = useStore((s) => s.recordAnnouncement);
  const cancelAnnouncementRecording = useStore((s) => s.cancelAnnouncementRecording);

  const fileRef = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const [optimistic, setOptimistic] = useState<
    Record<number, Partial<Record<AvailabilityField, boolean>>>
  >({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingName, setSavingName] = useState(false);

  const sortedMedia = [...media].sort((a, b) => a.name.localeCompare(b.name));
  const broadcastCount = sortedMedia.filter((m) => m.broadcast ?? !m.music).length;
  const musicCount = sortedMedia.filter((m) => m.music).length;

  const handleUpload = async (file: File) => {
    setUploading({ name: file.name, progress: 0 });
    try {
      await uploadMedia(file, { broadcast: true, music: true }, (fraction) =>
        setUploading((current) => (current ? { ...current, progress: fraction } : current)),
      );
    } finally {
      setUploading(null);
    }
  };

  const toggleAvailability = async (
    id: number,
    field: AvailabilityField,
    value: boolean,
  ) => {
    const key = `${id}:${field}`;
    setOptimistic((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setPending((prev) => new Set(prev).add(key));
    try {
      await updateMediaAvailability(id, { [field]: value });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setOptimistic((prev) => {
        const item = { ...prev[id] };
        delete item[field];
        const next = { ...prev };
        if (Object.keys(item).length) next[id] = item;
        else delete next[id];
        return next;
      });
    }
  };

  const startRename = (id: number, name: string) => {
    setRenameTarget({ id, name });
    setRenameValue(name);
  };

  const cancelRename = () => {
    setRenameTarget(null);
    setRenameValue('');
  };

  const saveRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) return;
    setSavingName(true);
    try {
      await updateMediaAvailability(renameTarget.id, { name });
      setRenameTarget(null);
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Media library"
        subtitle={`${sortedMedia.length} item${sortedMedia.length === 1 ? '' : 's'} · ${broadcastCount} for broadcast · ${musicCount} for music — choose where each upload is available.`}
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
                if (f) void handleUpload(f);
                e.target.value = '';
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy || !!uploading}>
              <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload media'}
            </Button>
          </>
        }
      />

      {uploading && (
        <div className="upload-progress">
          <div className="upload-progress-head">
            <span className="spinner" aria-hidden="true" />
            <b>Uploading {uploading.name}</b>
            <span>{Math.round(uploading.progress * 100)}%</span>
          </div>
          <div className="meter-thin">
            <i style={{ width: `${Math.max(4, uploading.progress * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="grid-cards">
        {sortedMedia.map((m) => {
          const overrides = optimistic[m.id] ?? {};
          const inBroadcast = overrides.broadcast ?? (m.broadcast ?? !m.music);
          const inMusic = overrides.music ?? !!m.music;
          const broadcastPending = pending.has(`${m.id}:broadcast`);
          const musicPending = pending.has(`${m.id}:music`);

          return (
            <Card key={m.id} className="media-card">
              <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                                    <b className="media-name" title={m.name}>
                      {m.name}
                    </b>
                  <div className="announce-meta">
                    {fmtSize(m.fileSize)}
                    {formatDurationOrBlank(m.duration) ? ` · ${formatDurationOrBlank(m.duration)}` : ''}
                  </div>
                </div>
                <div className="inline" style={{ gap: 2, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="icon-link"
                    onClick={() => startRename(m.id, m.name)}
                    title="Rename"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-link"
                    onClick={() => setPreviewId(previewId === m.id ? null : m.id)}
                    title="Preview locally"
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-link danger"
                    onClick={() => void removeMedia(m.id)}
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {previewId === m.id && (
                <audio
                  controls
                  preload="auto"
                  style={{ width: '100%', height: 32, marginTop: 10 }}
                  src={api.announcements.audioUrl(m.id)}
                />
              )}

              <div className="media-avail">
                <label
                  className={`avail-toggle${inBroadcast ? ' on' : ''}${broadcastPending ? ' pending' : ''}`}
                >
                  <Switch
                    checked={inBroadcast}
                    onCheckedChange={(v) => void toggleAvailability(m.id, 'broadcast', v)}
                  />
                  {broadcastPending ? (
                    <span className="spinner avail-spinner" aria-hidden="true" />
                  ) : (
                    <Radio size={12} />
                  )}
                  <span>Broadcast</span>
                </label>
                <label className={`avail-toggle${inMusic ? ' on' : ''}${musicPending ? ' pending' : ''}`}>
                  <Switch
                    checked={inMusic}
                    onCheckedChange={(v) => void toggleAvailability(m.id, 'music', v)}
                  />
                  {musicPending ? (
                    <span className="spinner avail-spinner" aria-hidden="true" />
                  ) : (
                    <Music2 size={12} />
                  )}
                  <span>Music</span>
                </label>
              </div>
            </Card>
          );
        })}
        {sortedMedia.length === 0 && (
          <div className="state state-empty" style={{ gridColumn: '1 / -1' }}>
            No media yet — upload a WAV/MP3 or record a new announcement.
          </div>
        )}
      </div>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) cancelRename();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename media</DialogTitle>
            <DialogDescription>
              The new name appears in broadcast announcements and the music playlist.
            </DialogDescription>
          </DialogHeader>
          <div className="form-row">
            <label htmlFor="media-rename">Name</label>
            <Input
              id="media-rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveRename();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => void saveRename()}
              disabled={savingName || !renameValue.trim()}
            >
              {savingName ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
