import { useEffect, useState } from "react";
import { Camera, RefreshCw, X } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api/client";
import { Button } from "@/components/Button/Button";
import { Input } from "@/components/Input/Input";
import { Switch } from "@/components/Switch/Switch";
import type { CameraView, OnvifProfileView } from "@infinity/shared";

const EMPTY = {
  enabled: false,
  host: "",
  port: 80,
  username: "",
  password: "",
  channel: 1,
  preferredStream: "sub" as "sub" | "main",
  profileToken: "",
};

export const CameraSettings = ({ endpointId }: { endpointId: number }) => {
  const [form, setForm] = useState(EMPTY);
  const [profiles, setProfiles] = useState<OnvifProfileView[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; error?: string } | null>(null);
  const [codec, setCodec] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thumb, setThumb] = useState(0);

  const load = async () => {
    const cam: CameraView = await api.camera.get(endpointId);
    setForm({
      enabled: cam.enabled,
      host: cam.host ?? "",
      port: cam.port ?? 80,
      username: cam.username ?? "",
      password: "",
      channel: cam.channel,
      preferredStream: (cam.preferredStream as "sub" | "main") ?? "sub",
      profileToken: cam.profileToken,
    });
    setStatus(
      cam.configured
        ? cam.lastCheckError
          ? { ok: false, error: cam.lastCheckError }
          : { ok: cam.reachable !== false }
        : null,
    );
    setCodec(cam.streamCodec ?? null);
  };

  useEffect(() => {
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointId]);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.camera.save(endpointId, {
        enabled: form.enabled,
        host: form.host.trim(),
        port: form.port,
        username: form.username,
        ...(form.password ? { password: form.password } : {}),
        channel: form.channel,
        preferredStream: form.preferredStream,
        ...(form.profileToken ? { profileToken: form.profileToken } : {}),
      });
      setProfiles(saved.profiles ?? []);
      setForm((f) => ({ ...f, password: "", profileToken: saved.profileToken }));
      setStatus(saved.lastCheckError ? { ok: false, error: saved.lastCheckError } : { ok: true });
      setThumb(Date.now());
      toast.success(saved.lastCheckError ? "Saved (camera not reachable)" : "Camera saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.camera.test(endpointId, {
        host: form.host.trim(),
        port: form.port,
        username: form.username,
        ...(form.password ? { password: form.password } : {}),
      });
      setStatus(r.ok ? { ok: true } : { ok: false, error: r.error });
      if (r.codec) setCodec(r.codec);
      if (r.ok) toast.success("Camera reachable");
      else toast.error(r.error ?? "Camera unreachable");
    } catch (e) {
      setStatus({ ok: false, error: (e as Error).message });
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await api.camera.remove(endpointId).catch(() => undefined);
    setForm(EMPTY);
    setProfiles([]);
    setStatus(null);
    toast.success("Camera removed");
  };

  return (
    <div className="camera-settings">
      <div className="camera-head">
        <b>
          <Camera size={14} /> Camera (ONVIF)
        </b>
        <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
      </div>

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
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy || !form.host}>
          <RefreshCw size={13} /> Test
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          Save camera
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void remove()}>
          <X size={13} /> Remove
        </Button>
      </div>

      {status && (
        <div className={`camera-status ${status.ok ? "ok" : "bad"}`}>
          {status.ok ? "Camera reachable" : `Camera error: ${status.error}`}
        </div>
      )}

      {codec && (
        <div className={`camera-status ${codec.toLowerCase() === "h264" ? "" : "warn"}`}>
          Stream codec: <span className="mono" style={{ textTransform: "uppercase" }}>{codec}</span>
          {codec.toLowerCase() !== "h264"
            ? " — browsers need H.264; the server will transcode (or switch the camera stream to H.264 to save CPU)"
            : ""}
        </div>
      )}

      {form.host && (
        <img
          key={thumb}
          src={`${api.camera.snapshotUrl(endpointId)}?t=${thumb}`}
          alt="Camera snapshot"
          className="camera-shot"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
          }}
        />
      )}
    </div>
  );
};
