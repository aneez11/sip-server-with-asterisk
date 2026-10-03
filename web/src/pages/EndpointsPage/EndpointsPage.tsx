import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Phone,
  Volume2,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import { useStore } from "@/store";
import { Button } from "@/components/Button/Button";
import { Input } from "@/components/Input/Input";
import { Badge } from "@/components/Badge/Badge";
import { Switch } from "@/components/Switch/Switch";
import { Checkbox } from "@/components/Checkbox/Checkbox";
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
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">SIP password:</span>
      <code className="font-mono text-primary">{password}</code>
      <button
        type="button"
        onClick={() => void copy()}
        className="text-muted-foreground hover:text-primary transition-colors"
        title="Copy password"
      >
        {copied ? (
          <Check size={13} className="text-emerald-500" />
        ) : (
          <Copy size={13} />
        )}
      </button>
    </div>
  );
};

export const EndpointsPage = () => {
  const endpoints = useStore((s) => s.endpoints);
  const zones = useStore((s) => s.zones);
  const addEndpoint = useStore((s) => s.addEndpoint);
  const updateEndpoint = useStore((s) => s.updateEndpoint);
  const regenerateEndpointPassword = useStore(
    (s) => s.regenerateEndpointPassword,
  );
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
        if ((created as any).sipPassword)
          setPassword((created as any).sipPassword);
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
      for (const zid of current)
        if (!editZones.has(zid)) await detachMember(zid, dialog.id);
      for (const zid of editZones)
        if (!current.has(zid)) await attachMember(zid, dialog.id);
      setDialog(null);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-col items-stretch justify-between gap-2 flex-shrink-0 sm:flex-row sm:items-center">
        <span className="text-xs text-muted-foreground">
          {endpoints.length} endpoint{endpoints.length === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          className="w-full text-xs sm:w-auto"
          onClick={openAdd}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add endpoint
        </Button>
      </div>

      <div className="flex-shrink-0 overflow-x-auto rounded-xl border bg-card">
        <table className="min-w-[920px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Extension</th>
              <th className="px-4 py-2.5 font-semibold">Label</th>
              <th className="px-4 py-2.5 font-semibold">Location</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">IP</th>
              <th className="px-4 py-2.5 font-semibold">Model</th>
              <th className="px-4 py-2.5 font-semibold">SIP Password</th>
              <th className="px-4 py-2.5 font-semibold">Active</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr
                key={e.id}
                className={`border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors ${!e.isActive ? "opacity-60" : ""}`}
              >
                <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                  {e.extension}
                </td>
                <td className="px-4 py-2.5 font-medium">{e.label}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {e.location || "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {e.type === "phone" ? (
                      <Phone size={11} />
                    ) : (
                      <Volume2 size={11} />
                    )}
                    {e.type}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Badge
                    variant={e.registered ? "default" : "outline"}
                    className={e.registered ? "" : "text-muted-foreground"}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full mr-1.5 ${e.registered ? "bg-emerald-400" : "bg-muted-foreground"}`}
                    />
                    {e.registered ? "Online" : "Offline"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {e.contactIp ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-[10px] font-mono truncate max-w-[140px]">
                  {e.userAgent ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  {e.sipPassword ? (
                    <PasswordRow password={e.sipPassword} />
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Switch
                    checked={e.isActive}
                    onCheckedChange={(v) => void setEndpointActive(e.id, v)}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="p-1.5 text-muted-foreground hover:text-primary rounded-md transition-colors"
                      onClick={() => void requalifyEndpoint(e.id)}
                      title="Ping / requalify — nudge the device to re-register"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                      onClick={() => openEdit(e)}
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded-md transition-colors"
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
          <div className="py-12 text-center text-xs text-muted-foreground">
            No endpoints yet — add your first phone or speaker.
          </div>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "add" ? "Add endpoint" : "Edit endpoint"}
            </DialogTitle>
            <DialogDescription>
              A SIP password is generated automatically (fits the 16-char limit
              of most devices).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Extension
                </label>
                <Input
                  value={form.extension}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      extension: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  placeholder="2001"
                  disabled={dialog?.mode === "edit"}
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Type
                </label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      type: e.target.value as "phone" | "speaker",
                    })
                  }
                >
                  <option value="phone">Phone</option>
                  <option value="speaker">Speaker</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">
                Label
              </label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Office Phone"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">
                Location
              </label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Ground Floor"
              />
            </div>
            {dialog?.mode === "add" && (
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Add to zone (optional)
                </label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {dialog?.mode === "edit" && (
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Zones
                </label>
                <div className="grid gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {zones.map((z) => (
                    <label
                      key={z.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={editZones.has(z.id)}
                        onCheckedChange={() => toggleEditZone(z.id)}
                        className="h-3.5 w-3.5"
                      />
                      <span className="flex-1 text-sm truncate">{z.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {z.endpointCount}
                      </span>
                    </label>
                  ))}
                  {zones.length === 0 && (
                    <div className="text-xs text-muted-foreground py-1">
                      No zones — create one in the Zones tab.
                    </div>
                  )}
                </div>
              </div>
            )}
            {password && (
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                <PasswordRow password={password} />
                {dialog?.mode === "edit" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => void regeneratePassword()}
                    disabled={regeneratingPassword}
                  >
                    <RefreshCw
                      className={`mr-1.5 h-3.5 w-3.5 ${regeneratingPassword ? "animate-spin" : ""}`}
                    />
                    {regeneratingPassword
                      ? "Regenerating..."
                      : "Regenerate password"}
                  </Button>
                )}
              </div>
            )}
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
