import { useState } from "react";
import {
  Check,
  Copy,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  Volume2,
} from "lucide-react";
import { useStore } from "@/store";
import { Button } from "@/components/Button/Button";
import { Input } from "@/components/Input/Input";
import { Switch } from "@/components/Switch/Switch";
import { Checkbox } from "@/components/Checkbox/Checkbox";
import { CameraSettings } from "@/components/CameraSettings/CameraSettings";
import { ScreenHeader } from "@/components/ScreenHeader/ScreenHeader";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/Dialog/Dialog";

const EMPTY = {
  extension: "",
  label: "",
  location: "",
  type: "phone" as "phone" | "speaker",
};

interface EndpointForm {
  extension: string;
  label: string;
  location: string;
  type: "phone" | "speaker";
}

type DialogState =
  | { mode: "add"; data: EndpointForm }
  | {
      mode: "edit";
      id: number;
      data: EndpointForm & { isActive: boolean; sipPassword?: string };
    }
  | null;

const PasswordRow = ({ password }: { password: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="inline" style={{ gap: 6, fontSize: 12 }}>
      <span className="muted">SIP password:</span>
      <code style={{ font: "11.5px var(--font-mono)", color: "var(--acc-text)" }}>{password}</code>
      <button
        type="button"
        className="icon-link"
        onClick={() => void copy()}
        title="Copy password"
      >
        {copied ? <Check size={13} className="ok-text" /> : <Copy size={13} />}
      </button>
    </div>
  );
};

export const EndpointsPage = () => {
  const endpoints = useStore((s) => s.endpoints);
  const zones = useStore((s) => s.zones);
  const addEndpoint = useStore((s) => s.addEndpoint);
  const updateEndpoint = useStore((s) => s.updateEndpoint);
  const regenerateEndpointPassword = useStore((s) => s.regenerateEndpointPassword);
  const removeEndpoint = useStore((s) => s.removeEndpoint);
  const setEndpointActive = useStore((s) => s.setEndpointActive);
  const requalifyEndpoint = useStore((s) => s.requalifyEndpoint);
  const attachMember = useStore((s) => s.attachMember);
  const detachMember = useStore((s) => s.detachMember);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState<EndpointForm>(EMPTY);
  const [password, setPassword] = useState("");
  const [regeneratingPassword, setRegeneratingPassword] = useState(false);
  const [zoneId, setZoneId] = useState("");
  const [editZones, setEditZones] = useState<Set<number>>(new Set());

  const openAdd = () => {
    setForm(EMPTY);
    setPassword("");
    setZoneId("");
    setEditZones(new Set());
    setDialog({ mode: "add", data: EMPTY });
  };
  const openEdit = (e: (typeof endpoints)[0]) => {
    setForm({
      extension: e.extension,
      label: e.label,
      location: e.location,
      type: e.type,
    });
    setPassword(e.sipPassword ?? "");
    setEditZones(
      new Set(
        zones
          .filter((z) => (z.endpointIds ?? []).includes(e.id))
          .map((z) => z.id),
      ),
    );
    setDialog({
      mode: "edit",
      id: e.id,
      data: {
        extension: e.extension,
        label: e.label,
        location: e.location,
        type: e.type,
        isActive: e.isActive,
        sipPassword: e.sipPassword,
      },
    });
  };

  const toggleEditZone = (id: number) =>
    setEditZones((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const regeneratePassword = async () => {
    if (dialog?.mode !== "edit") return;
    setRegeneratingPassword(true);
    try {
      const nextPassword = await regenerateEndpointPassword(dialog.id);
      if (nextPassword) setPassword(nextPassword);
    } finally {
      setRegeneratingPassword(false);
    }
  };

  const save = async () => {
    if (!form.extension || !form.label) return;
    if (dialog?.mode === "add") {
      const created = await addEndpoint({
        ...form,
        location: form.location || "",
      });
      if (created) {
        if ((created as any).sipPassword) setPassword((created as any).sipPassword);
        if (zoneId) await attachMember(Number(zoneId), created.id);
        setDialog(null);
      }
    } else if (dialog?.mode === "edit") {
      await updateEndpoint(dialog.id, {
        ...form,
        location: form.location || "",
        isActive: true,
      });
      const current = new Set(
        zones
          .filter((z) => (z.endpointIds ?? []).includes(dialog.id))
          .map((z) => z.id),
      );
      for (const zid of current) if (!editZones.has(zid)) await detachMember(zid, dialog.id);
      for (const zid of editZones) if (!current.has(zid)) await attachMember(zid, dialog.id);
      setDialog(null);
    }
  };

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Endpoints"
        subtitle={`${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"} · phones and IP speakers share the same paging path`}
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={13} /> Add endpoint
          </Button>
        }
      />

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Extension</th>
              <th>Label</th>
              <th>Location</th>
              <th>Type</th>
              <th>Status</th>
              <th>IP</th>
              <th>Model</th>
              <th>SIP password</th>
              <th>Active</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id} className={!e.isActive ? "inactive" : ""}>
                <td className="mono">{e.extension}</td>
                <td style={{ fontWeight: 600 }}>{e.label}</td>
                <td className="muted">{e.location || "—"}</td>
                <td>
                  <span className="inline muted" style={{ gap: 5, fontSize: 11 }}>
                    {e.type === "phone" ? <Phone size={11} /> : <Volume2 size={11} />}
                    {e.type}
                  </span>
                </td>
                <td>
                  <span className={`chip ${e.registered ? "" : "outline"}`}>
                    <i className="dot" aria-hidden="true" />
                    {e.registered ? "Online" : "Offline"}
                  </span>
                </td>
                <td className="mono muted">{e.contactIp ?? "—"}</td>
                <td className="mono muted" style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.userAgent ?? "—"}
                </td>
                <td>{e.sipPassword ? <PasswordRow password={e.sipPassword} /> : "—"}</td>
                <td>
                  <Switch
                    checked={e.isActive}
                    onCheckedChange={(v) => void setEndpointActive(e.id, v)}
                    aria-label={`${e.isActive ? "Deactivate" : "Activate"} ${e.label}`}
                  />
                </td>
                <td className="actions">
                  <div className="row-actions">
                    <button
                      type="button"
                      className="row-action"
                      onClick={() => void requalifyEndpoint(e.id)}
                      title="Ping / requalify — nudge the device to re-register"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button type="button" className="row-action" onClick={() => openEdit(e)} title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="row-action danger"
                      onClick={() => void removeEndpoint(e.id)}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {endpoints.length === 0 && (
          <div className="table-empty">No endpoints yet — add your first phone or speaker.</div>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="dialog-wide">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "add" ? "Add endpoint" : "Edit endpoint"}</DialogTitle>
            <DialogDescription>
              A SIP password is generated automatically (fits the 16-char limit of most devices).
            </DialogDescription>
          </DialogHeader>

          <div className="endpoint-dialog-grid">
            <section className="endpoint-col">
              <div className="form-grid">
                <div className="form-row">
                  <label>Extension</label>
                  <Input
                    value={form.extension}
                    onChange={(e) =>
                      setForm({ ...form, extension: e.target.value.replace(/\D/g, "") })
                    }
                    placeholder="2001"
                    disabled={dialog?.mode === "edit"}
                  />
                </div>
                <div className="form-row">
                  <label>Type</label>
                  <select
                    className="input"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as "phone" | "speaker" })}
                  >
                    <option value="phone">Phone</option>
                    <option value="speaker">Speaker</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <label>Label</label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Office Phone"
                />
              </div>

              <div className="form-row">
                <label>Location</label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Ground Floor"
                />
              </div>

              {password && (
                <div className="endpoint-password">
                  <PasswordRow password={password} />
                  {dialog?.mode === "edit" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void regeneratePassword()}
                      disabled={regeneratingPassword}
                    >
                      <RefreshCw size={13} className={regeneratingPassword ? "animate-spin" : ""} />
                      {regeneratingPassword ? "Regenerating…" : "Regenerate"}
                    </Button>
                  )}
                </div>
              )}
            </section>

            <section className="endpoint-col">
              {dialog?.mode === "edit" ? (
                <CameraSettings endpointId={dialog.id} />
              ) : (
                <div className="state state-empty" style={{ minHeight: 120 }}>
                  <div>
                    <strong>Camera (ONVIF)</strong>
                    <p>Save the endpoint first, then reopen it to configure a room camera.</p>
                  </div>
                </div>
              )}
            </section>

            <section className="endpoint-zone-row">
              {dialog?.mode === "add" ? (
                <div className="form-row">
                  <label>Add to zone (optional)</label>
                  <select className="input" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                    <option value="">— none —</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <label>Zones</label>
                  <div className="zone-pick-grid">
                    {zones.map((z) => (
                      <label key={z.id} className="check-row">
                        <Checkbox checked={editZones.has(z.id)} onCheckedChange={() => toggleEditZone(z.id)} />
                        <span style={{ flex: 1 }}>{z.name}</span>
                        <span className="mono muted" style={{ fontSize: 11 }}>{z.endpointCount}</span>
                      </label>
                    ))}
                    {zones.length === 0 && <div className="muted tiny">No zones — create one in the Zones tab.</div>}
                  </div>
                </>
              )}
            </section>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
