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

/**
 * Camera section of the endpoint dialog: ONVIF host/credentials, "Test" probe,
 * profile selection and a live snapshot thumbnail. Password is write-only — the
 * API returns only `hasPassword`.
 */
export const CameraSettings = ({ endpointId }: { endpointId: number }) => {
  const [form, setForm] = useState(EMPTY);
  const [profiles, setProfiles] = useState<OnvifProfileView[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; error?: string } | null>(null);
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
      setStatus(
        saved.lastCheckError
          ? { ok: false, error: saved.lastCheckError }
          : { ok: true },
      );
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
      const r = await api.camera.test(endpointId);
      setStatus(r.ok ? { ok: true } : { ok: false, error: r.error });
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
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] font-medium">
          <Camera size={14} /> Camera (ONVIF)
        </div>
        <Switch
          checked={form.enabled}
          onCheckedChange={(v) => setForm({ ...form, enabled: v })}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-[11px] text-muted-foreground mb-1 block">Host / IP</label>
          <Input
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="192.168.10.61"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">Port</label>
          <Input
            value={String(form.port)}
            onChange={(e) => setForm({ ...form, port: Number(e.target.value.replace(/\D/g, "")) || 80 })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">ONVIF user</label>
          <Input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="admin"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">
            Password (write-only)
          </label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="unchanged"
          />
        </div>
      </div>

      {profiles.length > 0 && (
        <div>
          <label className="text-[11px] text-muted-foreground mb-1 block">
            Stream profile (prefer the H.264 sub-stream)
          </label>
          <select
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
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

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy || !form.host}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Test
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          Save camera
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void remove()}>
          <X className="mr-1 h-3.5 w-3.5" /> Remove
        </Button>
      </div>

      {status && (
        <div className={`text-[11px] ${status.ok ? "text-emerald-500" : "text-destructive"}`}>
          {status.ok ? "Camera reachable" : `Camera error: ${status.error}`}
        </div>
      )}

      {form.host && (
        <img
          key={thumb}
          src={`${api.camera.snapshotUrl(endpointId)}?t=${thumb}`}
          alt="Camera snapshot"
          className="w-full aspect-video object-contain rounded border border-border bg-black/60"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
          }}
        />
      )}
    </div>
  );
};
