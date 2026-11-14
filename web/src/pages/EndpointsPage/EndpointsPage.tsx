import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Layers,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
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
  const paGroups = useStore((s) => s.paGroups);
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

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "phone" | "speaker">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const zonesFor = (endpointId: number) =>
    zones.filter((z) => (z.endpointIds ?? []).includes(endpointId));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const zoneEndpointIds =
      zoneFilter === "all"
        ? null
        : new Set(zones.find((z) => String(z.id) === zoneFilter)?.endpointIds ?? []);
    const groupEndpointIds =
      groupFilter === "all"
        ? null
        : new Set(
            paGroups.find((g) => String(g.id) === groupFilter)?.receiverEndpointIds ?? [],
          );

    return endpoints.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (statusFilter === "online" && !e.registered) return false;
      if (statusFilter === "offline" && e.registered) return false;
      if (zoneEndpointIds && !zoneEndpointIds.has(e.id)) return false;
      if (groupEndpointIds && !groupEndpointIds.has(e.id)) return false;
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        e.extension.includes(q) ||
        e.location.toLowerCase().includes(q) ||
        (e.contactIp ?? "").toLowerCase().includes(q) ||
        (e.userAgent ?? "").toLowerCase().includes(q)
      );
    });
  }, [endpoints, zones, paGroups, query, typeFilter, statusFilter, zoneFilter, groupFilter]);

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

      <div className="target-filter">
        <div className="search-field">
          <Search size={14} />
          <Input
            placeholder="Search by label, extension, location, IP or model"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search endpoints"
          />
        </div>
        <select
          className="input"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | "phone" | "speaker")}
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          <option value="phone">Phones</option>
          <option value="speaker">Speakers</option>
        </select>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "online" | "offline")}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
        <select
          className="input"
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          aria-label="Filter by zone"
        >
          <option value="all">All zones</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          aria-label="Filter by PA group"
        >
          <option value="all">All PA groups</option>
          {paGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {endpoints.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>No endpoints yet</strong>
            <p>Add your first phone or IP speaker to start paging.</p>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>No endpoints match these filters</strong>
            <p>Clear the search or choose a different zone, group, type or status.</p>
          </div>
        </div>
      ) : (
        <div className="endpoint-grid">
          {visible.map((e) => {
            const memberships = zonesFor(e.id);
            const inGroups = paGroups.filter((g) =>
              (g.receiverEndpointIds ?? []).includes(e.id),
            );
            return (
              <article
                key={e.id}
                className={`endpoint-card${e.isActive ? "" : " inactive"}`}
              >
                <div className="endpoint-card-head">
                  <span className={`endpoint-type${e.type === "speaker" ? " speaker" : ""}`}>
                    {e.type === "phone" ? <Phone size={14} /> : <Volume2 size={14} />}
                  </span>
                  <div className="endpoint-ident">
                    <b title={e.label}>{e.label}</b>
                    <small>
                      <span className="mono">{e.extension}</span>
                      {e.location ? ` · ${e.location}` : ""}
                    </small>
                  </div>
                  <span className={`chip ${e.registered && e.isActive ? "" : "quiet"}`}>
                    <i className="dot" aria-hidden="true" />
                    {e.registered && e.isActive ? "Online" : "Offline"}
                  </span>
                </div>

                <div className="endpoint-meta">
                  <span className="mono">{e.contactIp ?? "—"}</span>
                  <span className="endpoint-model" title={e.userAgent ?? ""}>
                    {e.userAgent ?? "Unknown model"}
                  </span>
                </div>

                <div className="endpoint-members">
                  {memberships.length === 0 && inGroups.length === 0 && (
                    <span className="muted tiny">Not in a zone or PA group</span>
                  )}
                  {memberships.map((z) => (
                    <span key={`z${z.id}`} className="pill-label">
                      <Layers size={9} /> {z.name}
                    </span>
                  ))}
                  {inGroups.map((g) => (
                    <span key={`g${g.id}`} className="pill-label">
                      <Users size={9} /> {g.name}
                    </span>
                  ))}
                </div>

                <div className="endpoint-card-foot">
                  <Switch
                    checked={e.isActive}
                    onCheckedChange={(v) => void setEndpointActive(e.id, v)}
                    aria-label={`${e.isActive ? "Deactivate" : "Activate"} ${e.label}`}
                  />
                  <span className="tiny muted">{e.type === "speaker" ? "Speaker" : "Phone"}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="row-action"
                    onClick={() => void requalifyEndpoint(e.id)}
                    title="Ping / requalify — nudge the device to re-register"
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    className="row-action"
                    onClick={() => openEdit(e)}
                    title="Edit"
                  >
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
              </article>
            );
          })}
        </div>
      )}

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
