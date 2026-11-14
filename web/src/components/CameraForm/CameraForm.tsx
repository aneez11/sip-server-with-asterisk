import { useEffect, useState, type ReactNode } from "react";
import { Camera, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/Button/Button";
import { Input } from "@/components/Input/Input";
import { Switch } from "@/components/Switch/Switch";
import type { CameraView, OnvifProfileView } from "@infinity/shared";

export interface CameraFormBody {
  name?: string;
  location?: string;
  endpointId?: number | null;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password?: string;
  channel: number;
  preferredStream: "sub" | "main";
  profileToken?: string;
}

export interface CameraFormTransport {
  load: () => Promise<CameraView>;
  save: (body: CameraFormBody) => Promise<CameraView>;
  test: (cfg: {
    host: string;
    port: number;
    username: string;
    password?: string;
  }) => Promise<{ ok: boolean; error?: string; codec?: string }>;
  remove?: () => Promise<void>;
  /** Null while the camera has not been created yet. */
  snapshotUrl: string | null;
}

const EMPTY = {
  name: "",
  location: "",
  endpointId: null as number | null,
  enabled: false,
  host: "",
  port: 80,
  username: "",
  password: "",
  channel: 1,
  preferredStream: "sub" as "sub" | "main",
  profileToken: "",
};

/**
 * Shared ONVIF camera form.
 *
 * Used both in the endpoint dialog (camera follows an endpoint) and on the
 * Cameras page (standalone camera, optional endpoint link). The transport prop
 * decides which API surface is used, so there is exactly one form.
 */
export const CameraForm = ({
  transport,
  showMeta = false,
  endpoints,
  onSaved,
  onRemoved,
  footer,
}: {
  transport: CameraFormTransport;
  /** Show name / location / endpoint link (Cameras page). */
  showMeta?: boolean;
  endpoints?: { id: number; label: string; extension: string }[];
  onSaved?: (cam: CameraView) => void;
  onRemoved?: () => void;
  footer?: ReactNode;
}) => {
  const [form, setForm] = useState(EMPTY);
  const [profiles, setProfiles] = useState<OnvifProfileView[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [codec, setCodec] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thumb, setThumb] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void transport
      .load()
      .then((cam) => {
        if (cancelled) return;
        setForm({
          name: cam.name ?? "",
          location: cam.location ?? "",
          endpointId: cam.endpointId,
          enabled: cam.enabled,
          host: cam.host ?? "",
          port: cam.port ?? 80,
          username: cam.username ?? "",
          password: "",
          channel: cam.channel,
          preferredStream: (cam.preferredStream as "sub" | "main") ?? "sub",
          profileToken: cam.profileToken,
        });
        setProfiles(cam.profiles ?? []);
        setStatus(
          cam.configured
            ? cam.lastCheckError
              ? { ok: false, error: cam.lastCheckError }
              : { ok: cam.reachable !== false }
            : null,
        );
        setCodec(cam.streamCodec ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body: CameraFormBody = {
    ...(showMeta
      ? {
          name: form.name.trim(),
          location: form.location.trim(),
          endpointId: form.endpointId,
        }
      : {}),
    enabled: form.enabled,
    host: form.host.trim(),
    port: form.port,
    username: form.username,
    ...(form.password ? { password: form.password } : {}),
    channel: form.channel,
    preferredStream: form.preferredStream,
    ...(form.profileToken ? { profileToken: form.profileToken } : {}),
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await transport.save(body);
      setProfiles(saved.profiles ?? []);
      setForm((f) => ({ ...f, password: "", profileToken: saved.profileToken }));
      setStatus(
        saved.lastCheckError ? { ok: false, error: saved.lastCheckError } : { ok: true },
      );
      setCodec(saved.streamCodec ?? null);
      setThumb(Date.now());
      onSaved?.(saved);
    } catch (e) {
      setStatus({ ok: false, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await transport.test(body);
      setStatus(r.ok ? { ok: true } : { ok: false, error: r.error });
      if (r.codec) setCodec(r.codec);
    } catch (e) {
      setStatus({ ok: false, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!transport.remove) return;
    setBusy(true);
    try {
      await transport.remove();
      setForm(EMPTY);
      setProfiles([]);
      setStatus(null);
      setCodec(null);
      onRemoved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="camera-form">
      <div className="camera-head">
        <b>
          <Camera size={14} /> Camera (ONVIF)
        </b>
        <Switch
          checked={form.enabled}
          onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          aria-label="Camera enabled"
        />
      </div>

      {showMeta && (
        <>
          <div className="form-grid">
            <div className="form-row">
              <label>Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Front gate"
              />
            </div>
            <div className="form-row">
              <label>Location</label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Main entrance"
              />
            </div>
          </div>

          {endpoints && (
            <div className="form-row">
              <label>Linked endpoint (optional)</label>
              <select
                className="input"
                value={form.endpointId ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    endpointId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Not linked</option>
                {endpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.label} ({ep.extension})
                  </option>
                ))}
              </select>
              <div className="muted tiny">
                A linked camera also appears during a two-way call to that endpoint.
              </div>
            </div>
          )}
        </>
      )}

      <div className="form-grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div className="form-row">
          <label>Host / IP</label>
          <Input
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="192.168.10.61"
          />
        </div>
        <div className="form-row">
          <label>Port</label>
          <Input
            value={String(form.port)}
            onChange={(e) =>
              setForm({ ...form, port: Number(e.target.value.replace(/\D/g, "")) || 80 })
            }
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>ONVIF user</label>
          <Input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="admin"
          />
        </div>
        <div className="form-row">
          <label>Password (write-only)</label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="unchanged"
          />
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="form-row">
          <label>Stream profile (prefer the H.264 sub-stream)</label>
          <select
            className="input"
            value={form.profileToken}
            onChange={(e) => setForm({ ...form, profileToken: e.target.value })}
          >
            {profiles.map((p) => (
              <option key={p.token} value={p.token}>
                {p.name} — {p.width ?? "?"}x{p.height ?? "?"} {p.encoding ?? ""}{" "}
                {p.bitrateKbps ? `${p.bitrateKbps}kbps` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="inline">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void test()}
          disabled={busy || !form.host}
        >
          <RefreshCw size={13} /> Test
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : transport.snapshotUrl === null ? "Add camera" : "Save camera"}
        </Button>
        {transport.remove && (
          <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
            <X size={13} /> Remove
          </Button>
        )}
        {footer}
      </div>

      {status && (
        <div className={`camera-status ${status.ok ? "ok" : "bad"}`}>
          {status.ok ? "Camera reachable" : `Camera error: ${status.error}`}
        </div>
      )}

      {codec && (
        <div className={`camera-status ${codec.toLowerCase() === "h264" ? "" : "warn"}`}>
          Stream codec:{" "}
          <span className="mono" style={{ textTransform: "uppercase" }}>
            {codec}
          </span>
          {codec.toLowerCase() !== "h264"
            ? " — browsers need H.264; the server transcodes (or switch the camera stream to H.264 to save CPU)"
            : ""}
        </div>
      )}

      {form.host && transport.snapshotUrl && (
        <img
          key={thumb}
          src={`${transport.snapshotUrl}?t=${thumb}`}
          alt="Camera snapshot"
          className="camera-shot"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
          }}
        />
      )}
    </div>
  );
};
