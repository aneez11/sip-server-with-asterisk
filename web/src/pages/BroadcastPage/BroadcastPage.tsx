import { useRef, useState } from "react";
import {
  Headphones,
  Layers,
  Mic,
  Phone,
  Play,
  Radio,
  Search,
  Square,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useStore } from "@/store";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { ScreenHeader } from "@/components/ScreenHeader/ScreenHeader";
import { Input } from "@/components/Input/Input";
import { formatDurationOrBlank } from "@/lib/format";
import { api } from "@/lib/api/client";

const fmtSize = (b: number) => {
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  if (b >= 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
};

type TargetKind =
  | { kind: "endpoint"; id: number }
  | { kind: "zone"; id: number }
  | { kind: "group"; id: number };

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
  const cancelAnnouncementRecording = useStore(
    (s) => s.cancelAnnouncementRecording,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [targets, setTargets] = useState<TargetKind[]>([]);
  const [filter, setFilter] = useState("");

  const registeredIds = endpoints
    .filter((e) => e.isActive && e.registered)
    .map((e) => e.id);

  const toggle = (t: TargetKind) => {
    setTargets((prev) => {
      const key = (x: TargetKind) => `${x.kind}:${x.id}`;
      return prev.some((p) => key(p) === key(t))
        ? prev.filter((p) => key(p) !== key(t))
        : [...prev, t];
    });
  };
  const isOn = (t: TargetKind) =>
    targets.some((p) => p.kind === t.kind && p.id === t.id);

  const targetedIds = Array.from(
    new Set([
      ...targets.filter((t) => t.kind === "endpoint").map((t) => t.id),
      ...targets
        .filter((t) => t.kind === "zone")
        .flatMap((t) => zones.find((z) => z.id === t.id)?.endpointIds ?? []),
      ...targets
        .filter((t) => t.kind === "group")
        .flatMap(
          (t) => paGroups.find((g) => g.id === t.id)?.receiverEndpointIds ?? [],
        ),
    ]),
  ).filter((id) =>
    endpoints.some((e) => e.id === id && e.isActive && e.registered),
  );

  const q = filter.trim().toLowerCase();
  const matches = (...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => f?.toLowerCase().includes(q));

  const visibleEndpoints = endpoints.filter(
    (e) => e.isActive && matches(e.label, e.extension, e.location),
  );
  const visibleZones = zones.filter((z) => matches(z.name));
  const visibleGroups = paGroups.filter((g) => matches(g.name, g.extension));
  const visibleTargetCount =
    visibleEndpoints.length + visibleZones.length + visibleGroups.length;

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Broadcast"
        subtitle={`${announcements.length} announcement${announcements.length === 1 ? "" : "s"} · pick endpoints, zones or PA groups, then play`}
        actions={
          <>
            {recordingAnnouncement ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void cancelAnnouncementRecording()}
              >
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
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={13} /> Upload
            </Button>
          </>
        }
      />

      <div className="target-filter">
        <Search size={14} />
        <Input
          placeholder="Filter endpoints, zones or PA groups by name, extension or location"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted tiny">
          {visibleTargetCount} target{visibleTargetCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="target-grid">
        {visibleEndpoints
          .map((e) => {
            const t: TargetKind = { kind: "endpoint", id: e.id };
            return (
              <button
                key={`ep-${e.id}`}
                type="button"
                onClick={() => toggle(t)}
                className={`target-tile${isOn(t) ? " on" : ""}`}
              >
                <div className="tile-name">
                  {e.type === "speaker" ? <Volume2 size={12} /> : <Phone size={12} />}
                  <span>{e.label}</span>
                </div>
                <div className="tile-meta">
                  <span>{e.extension}</span>
                  <span className={`online-dot ${e.registered ? "on" : "off"}`} />
                </div>
              </button>
            );
          })}

        {visibleZones.map((z) => {
          const t: TargetKind = { kind: "zone", id: z.id };
          return (
            <button
              key={`zn-${z.id}`}
              type="button"
              onClick={() => toggle(t)}
              className={`target-tile${isOn(t) ? " on" : ""}`}
            >
              <div className="tile-name">
                <Layers size={12} />
                <span>{z.name}</span>
              </div>
              <div className="tile-meta">
                {z.endpointCount} endpoint{z.endpointCount === 1 ? "" : "s"}
              </div>
            </button>
          );
        })}

        {visibleGroups.map((g) => {
          const t: TargetKind = { kind: "group", id: g.id };
          return (
            <button
              key={`gr-${g.id}`}
              type="button"
              onClick={() => toggle(t)}
              className={`target-tile${isOn(t) ? " on" : ""}`}
            >
              <div className="tile-name">
                <Headphones size={12} />
                <span>{g.name}</span>
              </div>
              <div className="tile-meta">
                {g.receiverEndpointIds.length} receiver
                {g.receiverEndpointIds.length === 1 ? "" : "s"}
              </div>
            </button>
          );
        })}

        {visibleTargetCount === 0 && (
          <div className="state state-empty" style={{ gridColumn: "1 / -1" }}>
            {filter.trim()
              ? `No targets match “${filter.trim()}”.`
              : "No endpoints, zones or PA groups are available yet."}
          </div>
        )}
      </div>

      <div className="grid-cards">
        {announcements.map((a) => (
          <Card key={a.id} className="announce-card">
            <div className="inline" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="announce-name">{a.name}</div>
                <div className="announce-meta">
                  {a.originalName} · {fmtSize(a.fileSize)}
                  {a.duration ? ` · ${formatDurationOrBlank(a.duration)}` : ""}
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
                  onClick={() => void removeAnnouncement(a.id)}
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
                style={{ width: "100%", height: 32, marginTop: 10 }}
                src={api.announcements.audioUrl(a.id)}
              />
            )}

            <div className="announce-actions" style={{ marginTop: 10 }}>
              <Button
                size="sm"
                disabled={busy || targetedIds.length === 0}
                onClick={() => void playAnnouncement(a.id, targetedIds)}
              >
                <Play size={12} /> To {targetedIds.length} selected
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || registeredIds.length === 0}
                onClick={() => void playAnnouncement(a.id, registeredIds)}
              >
                <Radio size={12} /> All registered
              </Button>
            </div>
          </Card>
        ))}

        {announcements.length === 0 && (
          <div className="state state-empty" style={{ gridColumn: "1 / -1" }}>
            No announcements yet — upload a WAV file or record one.
          </div>
        )}
      </div>

      <div className="broadcast-bar" style={{ marginTop: "auto" }}>
        <span className="muted tiny">
          {targetedIds.length} targeted endpoint{targetedIds.length === 1 ? "" : "s"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || targetedIds.length === 0}
          onClick={() => void playAdhoc(targetedIds)}
        >
          <Play size={13} /> Broadcast default
        </Button>
      </div>
    </div>
  );
};
