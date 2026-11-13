import { Activity, Mic, Music2, Radio, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "@/store";
import { hasContextRail } from "@/lib/tabs";
import { Badge } from "@/components/Badge/Badge";

const fmtClock = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

const statusVariant = (status: string) =>
  status === "success"
    ? "default"
    : status === "failed"
      ? "destructive"
      : status === "stopped"
        ? "secondary"
        : "outline";

export const RightRail = () => {
  const activeTab = useStore((s) => s.activeTab);
  const endpoints = useStore((s) => s.endpoints);
  const recentLogs = useStore((s) => s.recentLogs);
  const recording = useStore((s) => s.recording);
  const talkTargetIds = useStore((s) => s.talkTargetIds);
  const toggleTalkTarget = useStore((s) => s.toggleTalkTarget);
  const paGroups = useStore((s) => s.paGroups);
  const talkPaGroupIds = useStore((s) => s.talkPaGroupIds);
  const toggleTalkPaGroup = useStore((s) => s.toggleTalkPaGroup);
  const selectedZoneIds = useStore((s) => s.selectedZoneIds);
  const musicPlaying = useStore((s) => s.musicPlaying);
  const playAdhoc = useStore((s) => s.playAdhoc);
  const busy = useStore((s) => s.busy);
  const music = useStore((s) => s.music);
  const currentMusicId = useStore((s) => s.currentMusicId);
  const musicTargetIds = useStore((s) => s.musicTargetIds);
  const calls = useStore((s) => s.calls);

  if (!hasContextRail(activeTab)) return null;

  const currentTrack = currentMusicId
    ? music.find((m) => m.id === currentMusicId)
    : null;

  const monitorCalls = calls?.active ?? [];
  const monitorTargets = monitorCalls.reduce((n, c) => n + c.members.length, 0);
  const monitorReceiving = monitorCalls.reduce(
    (n, c) => n + c.members.filter((m) => m.status === "receiving").length,
    0,
  );
  const monitorMissed = monitorCalls.reduce(
    (n, c) => n + c.members.filter((m) => m.status === "missed").length,
    0,
  );

  const active = recentLogs.filter((b) => b.status === "pending");
  const history = recentLogs.filter((b) => b.status !== "pending").slice(0, 8);

  const headerMap: Record<string, { icon: LucideIcon; title: string }> = {
    broadcast: { icon: Radio, title: "Recent broadcasts" },
    talk: { icon: Mic, title: "Talk targets" },
    monitor: { icon: Activity, title: "Call summary" },
    music: { icon: Music2, title: "Music status" },
  };
  const header = headerMap[activeTab] ?? headerMap.broadcast;
  const HeaderIcon = header.icon;

  return (
    <aside className="context-rail">
      <div className="context-head">
        <span className="inline">
          <HeaderIcon size={15} />
          {header.title}
        </span>
      </div>

      <div className="context-body">
        {activeTab === "talk" && (
          <>
            {paGroups.length > 0 && (
              <>
                <div className="context-section">PA groups</div>
                {paGroups.map((g) => {
                  const selected = talkPaGroupIds.has(g.id);
                  const receivers = g.receiverEndpointIds ?? [];
                  const onlineCount = endpoints.filter(
                    (e) => receivers.includes(e.id) && e.registered && e.isActive,
                  ).length;
                  return (
                    <button
                      key={`pa-${g.id}`}
                      type="button"
                      onClick={() => toggleTalkPaGroup(g.id)}
                      title={`Talk live to every receiver in ${g.name}`}
                      className={`context-card${selected && recording ? " live" : selected ? " on" : ""}`}
                    >
                      <div className="card-line">
                        <Users size={14} className="muted" />
                        <span className="card-name">{g.name}</span>
                        <Badge
                          variant={
                            selected && recording
                              ? "destructive"
                              : selected
                                ? "default"
                                : "outline"
                          }
                        >
                          {selected && recording ? "Live" : selected ? "Selected" : "Group"}
                        </Badge>
                      </div>
                      <div className="card-meta">
                        {receivers.length} receiver{receivers.length === 1 ? "" : "s"} ·{" "}
                        {onlineCount} online · ext {g.extension}
                      </div>
                    </button>
                  );
                })}
                <div className="context-section">Endpoints</div>
              </>
            )}
            {endpoints.map((e) => {
              const online = e.registered && e.isActive;
              const targeted = talkTargetIds.has(e.id);
              const live = targeted && recording;
              const viaGroup =
                !targeted &&
                paGroups.some(
                  (g) =>
                    talkPaGroupIds.has(g.id) &&
                    (g.receiverEndpointIds ?? []).includes(e.id),
                );
              const effective = targeted || viaGroup;
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={!online}
                  onClick={() => toggleTalkTarget(e.id)}
                  title={
                    online
                      ? viaGroup
                        ? "Selected via a PA group"
                        : "Click to talk to this endpoint"
                      : "Endpoint not registered"
                  }
                  className={`context-card${!online ? " off" : live ? " live" : effective ? " on" : ""}`}
                >
                  <div className="card-line">
                    <span
                      className={`online-dot ${!online ? "off" : live ? "live" : "on"}`}
                    />
                    <span className="card-name">{e.label}</span>
                    <Badge
                      variant={live ? "destructive" : effective ? "default" : "outline"}
                    >
                      {live
                        ? "Live"
                        : online
                          ? targeted
                            ? "Selected"
                            : viaGroup
                              ? "In group"
                              : "Online"
                          : "Offline"}
                    </Badge>
                  </div>
                  <div className="card-meta">
                    {e.extension} · {e.location || "—"}
                    {viaGroup ? " · via group" : ""}
                  </div>
                </button>
              );
            })}
          </>
        )}

        {activeTab === "broadcast" && (
          <>
            {history.length === 0 && active.length === 0 && (
              <div className="state state-empty" style={{ minHeight: 120 }}>
                Nothing broadcast yet
              </div>
            )}
            {active.map((b) => (
              <div key={b.id} className="card" style={{ borderColor: "var(--warn)" }}>
                <div className="inline" style={{ gap: 6 }}>
                  <Radio size={13} className="warn-text animate-pulse" />
                  <b style={{ fontSize: 12 }}>
                    {b.title || b.zoneName || "Broadcast"}
                  </b>
                </div>
                <div className="card-meta" style={{ color: "var(--mut)", fontSize: 10.5 }}>
                  {b.zoneName ?? "Ad-hoc"} · {b.endpointIds?.length ?? 0} endpoint
                  {(b.endpointIds?.length ?? 0) === 1 ? "" : "s"}
                </div>
              </div>
            ))}
            {history.map((b) => (
              <div key={b.id} className="card" style={{ padding: 10 }}>
                <div className="inline" style={{ justifyContent: "space-between" }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {b.title || b.zoneName || "Broadcast"}
                    </div>
                    <div style={{ color: "var(--mut)", fontSize: 10.5 }}>
                      {b.zoneName ? `${b.zoneName} · ` : ""}
                      {fmtClock(b.startedAt)} · {b.endpointIds?.length ?? 0} endpoint
                      {(b.endpointIds?.length ?? 0) === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Badge variant={statusVariant(b.status)}>{b.status}</Badge>
                </div>
                <button
                  type="button"
                  className="btn small"
                  style={{ width: "100%", marginTop: 8 }}
                  onClick={() => void playAdhoc(b.endpointIds)}
                  disabled={busy || b.endpointIds.length === 0}
                  title="Rebroadcast to the same endpoint configuration"
                >
                  <Radio size={12} />
                  Rebroadcast
                </button>
              </div>
            ))}
          </>
        )}

        {activeTab === "music" && (
          <>
            {musicPlaying ? (
              <div className="card" style={{ borderColor: "var(--ok)" }}>
                <div className="inline" style={{ gap: 6 }}>
                  <Music2 size={13} className="ok-text" />
                  <b style={{ fontSize: 12 }}>{currentTrack?.name ?? "Playing"}</b>
                </div>
                <div className="card-meta" style={{ color: "var(--mut)", fontSize: 10.5 }}>
                  {musicTargetIds.length} endpoint
                  {musicTargetIds.length === 1 ? "" : "s"}
                </div>
              </div>
            ) : (
              <div className="state state-empty" style={{ minHeight: 120 }}>
                Nothing playing — pick a track in the main panel.
              </div>
            )}
            <div className="context-section">
              {music.length} track{music.length === 1 ? "" : "s"} in library
            </div>
          </>
        )}

        {activeTab === "monitor" && (
          <div className="stack-sm">
            <div className="meta-row">
              <span>Active calls</span>
              <strong>{monitorCalls.length}</strong>
            </div>
            <div className="meta-row">
              <span>Targeted endpoints</span>
              <strong>{monitorTargets}</strong>
            </div>
            <div className="meta-row">
              <span>Receiving now</span>
              <strong className="ok-text">{monitorReceiving}</strong>
            </div>
            <div className="meta-row">
              <span>Unavailable</span>
              <strong className={monitorMissed > 0 ? "bad-text" : ""}>
                {monitorMissed}
              </strong>
            </div>
          </div>
        )}
      </div>

      <div className="context-foot">
        <div className="meta-row">
          <span>Endpoints</span>
          <strong>{endpoints.length}</strong>
        </div>
        <div className="meta-row">
          <span>Registered</span>
          <strong className="ok-text">
            {endpoints.filter((e) => e.registered).length}
          </strong>
        </div>
        <div className="meta-row">
          <span>Zones selected</span>
          <strong>{selectedZoneIds.size}</strong>
        </div>
      </div>
    </aside>
  );
};
