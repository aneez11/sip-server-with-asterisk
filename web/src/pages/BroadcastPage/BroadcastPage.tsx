import { useRef, useState } from 'react';
import { Play, Upload, Trash2, Radio, Mic, Square, Phone, Volume2, Layers, Headphones } from 'lucide-react';
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

type TargetKind = { kind: 'endpoint'; id: number } | { kind: 'zone'; id: number } | { kind: 'group'; id: number };

export const BroadcastPage = () => {
  const announcements = useStore((s) => s.announcements);
  const endpoints = useStore((s) => s.endpoints);
  const zones = useStore((s) => s.zones);
  const paGroups = useStore((s) => s.paGroups);
  const busy = useStore((s) => s.busy);
  const playAnnouncement = useStore((s) => s.playAnnouncement);
  const playAdhoc = useStore((s) => s.playAdhoc);
  const uploadAnnouncement = useStore((s) => s.uploadAnnouncement);
  const removeAnnouncement = useStore((s) => s.removeAnnouncement);
  const recordingAnnouncement = useStore((s) => s.recordingAnnouncement);
  const recordAnnouncement = useStore((s) => s.recordAnnouncement);
  const cancelAnnouncementRecording = useStore((s) => s.cancelAnnouncementRecording);
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [targets, setTargets] = useState<TargetKind[]>([]);

  const registeredIds = endpoints.filter((e) => e.isActive && e.registered).map((e) => e.id);

  const toggle = (t: TargetKind) => {
    setTargets((prev) => {
      const key = (x: TargetKind) => `${x.kind}:${x.id}`;
      return prev.some((p) => key(p) === key(t)) ? prev.filter((p) => key(p) !== key(t)) : [...prev, t];
    });
  };
  const isOn = (t: TargetKind) => targets.some((p) => p.kind === t.kind && p.id === t.id);

  // Resolve the union of selected endpoint ids (direct + zone members + group receivers).
  const targetedIds = Array.from(new Set([
    ...targets.filter((t) => t.kind === 'endpoint').map((t) => t.id),
    ...targets.filter((t) => t.kind === 'zone').flatMap((t) => zones.find((z) => z.id === t.id)?.endpointIds ?? []),
    ...targets.filter((t) => t.kind === 'group').flatMap((t) => paGroups.find((g) => g.id === t.id)?.receiverEndpointIds ?? []),
  ])).filter((id) => endpoints.some((e) => e.id === id && e.isActive));

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {announcements.length} announcement{announcements.length === 1 ? '' : 's'} · select endpoints, zones or PA groups below, then play
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
        </div>
      </div>

      {/* Selectable target cards: endpoints, zones, PA groups */}
      <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
        {endpoints.filter((e) => e.isActive).map((e) => {
          const t: TargetKind = { kind: 'endpoint', id: e.id };
          return (
            <button key={`ep-${e.id}`} onClick={() => toggle(t)}
              className={cn('rounded-xl border text-left p-2.5 transition-colors', isOn(t) ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-muted-foreground/40')}>
              <div className="flex items-center gap-1.5">
                {e.type === 'speaker' ? <Volume2 size={12} className="text-muted-foreground" /> : <Phone size={12} className="text-muted-foreground" />}
                <span className="text-[12px] font-medium truncate">{e.label}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="font-mono text-[10px] text-muted-foreground">{e.extension}</span>
                <span className={cn('h-1.5 w-1.5 rounded-full', e.registered ? 'bg-emerald-400' : 'bg-muted-foreground')} />
              </div>
            </button>
          );
        })}

        {zones.map((z) => {
          const t: TargetKind = { kind: 'zone', id: z.id };
          return (
            <button key={`zn-${z.id}`} onClick={() => toggle(t)}
              className={cn('rounded-xl border text-left p-2.5 transition-colors', isOn(t) ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-muted-foreground/40')}>
              <div className="flex items-center gap-1.5">
                <Layers size={12} className="text-muted-foreground" />
                <span className="text-[12px] font-medium truncate">{z.name}</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground mt-1">{z.endpointCount} endpoint{z.endpointCount === 1 ? '' : 's'}</div>
            </button>
          );
        })}

        {paGroups.map((g) => {
          const t: TargetKind = { kind: 'group', id: g.id };
          return (
            <button key={`gr-${g.id}`} onClick={() => toggle(t)}
              className={cn('rounded-xl border text-left p-2.5 transition-colors', isOn(t) ? 'bg-primary/10 border-primary' : 'bg-card border-border hover:border-muted-foreground/40')}>
              <div className="flex items-center gap-1.5">
                <Headphones size={12} className="text-muted-foreground" />
                <span className="text-[12px] font-medium truncate">{g.name}</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground mt-1">{g.receiverEndpointIds.length} receiver{g.receiverEndpointIds.length === 1 ? '' : 's'}</div>
            </button>
          );
        })}
      </div>

      {/* Announcements */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
        {announcements.map((a) => (
          <Card key={a.id} className="bg-card">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{a.name}</div>
                  <div className="text-muted-foreground text-[10px] font-mono mt-0.5">{a.originalName} · {fmtSize(a.fileSize)}{a.duration ? ` · ${fmtDur(a.duration)}` : ''}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button className="p-1 text-muted-foreground hover:text-primary transition-colors" onClick={() => setPreviewId(previewId === a.id ? null : a.id)} title="Preview locally"><Play size={13} /></button>
                  <button className="p-1 text-muted-foreground hover:text-destructive transition-colors" onClick={() => void removeAnnouncement(a.id)} title="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
              {previewId === a.id && <audio controls preload="auto" className="w-full h-8" src={api.announcements.audioUrl(a.id)} />}
              <div className="flex gap-2">
                <Button variant="default" size="sm" className="flex-1 h-7 text-[11px]" disabled={busy || targetedIds.length === 0} onClick={() => void playAnnouncement(a.id, targetedIds)}>
                  <Play className="w-3 h-3 mr-1" /> To {targetedIds.length} selected
                </Button>
                <Button variant="outline" size="sm" className="flex-1 h-7 text-[11px]" disabled={busy || registeredIds.length === 0} onClick={() => void playAnnouncement(a.id, registeredIds)}>
                  <Radio className="w-3 h-3 mr-1" /> All registered
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {announcements.length === 0 && (
          <div className="col-span-full border rounded-xl bg-muted/30 p-10 text-center text-xs text-muted-foreground">
            No announcements yet — upload a WAV file or record one.
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border rounded-xl bg-card shadow-lg p-4 flex items-center justify-between gap-4 mt-auto">
        <span className="text-muted-foreground text-xs">{targetedIds.length} targeted endpoint{targetedIds.length === 1 ? '' : 's'}</span>
        <Button variant="outline" size="sm" className="text-xs" disabled={busy || targetedIds.length === 0} onClick={() => void playAdhoc(targetedIds)}>
          <Play className="mr-1.5 h-3.5 w-3.5" /> Broadcast default
        </Button>
      </div>
    </div>
  );
};
