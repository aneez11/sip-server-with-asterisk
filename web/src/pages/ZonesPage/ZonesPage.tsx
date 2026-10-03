import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Layers,
  Volume2,
  SlidersHorizontal,
} from "lucide-react";
import { useStore } from "@/store";
import { Button } from "@/components/Button/Button";
import { Input } from "@/components/Input/Input";
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
import type { AutoAnswerProfile } from "@infinity/shared";

type DialogState =
  | { mode: "add" }
  | {
      mode: "edit";
      id: number;
      name: string;
      beep: boolean;
      volume: number | null;
      announcementId: number | null;
      autoAnswerProfileId: number | null;
    }
  | { mode: "members"; id: number; name: string }
  | null;

const EMPTY_PROFILE: Omit<AutoAnswerProfile, "id"> = {
  name: "",
  userAgentMatch: null,
  alertInfo: null,
  callInfo: null,
  sipUri: null,
  dTime: null,
  dialOptions: null,
};

const toneValue = (beep: boolean, announcementId: number | null): string =>
  announcementId != null ? `ann_${announcementId}` : beep ? "beep" : "none";

export const ZonesPage = () => {
  const zones = useStore((s) => s.zones);
  const endpoints = useStore((s) => s.endpoints);
  const announcements = useStore((s) => s.announcements);
  const profiles = useStore((s) => s.profiles);
  const busyZoneIds = useStore((s) => s.busyZoneIds);
  const addZone = useStore((s) => s.addZone);
  const updateZone = useStore((s) => s.updateZone);
  const removeZone = useStore((s) => s.removeZone);
  const attachMember = useStore((s) => s.attachMember);
  const detachMember = useStore((s) => s.detachMember);
  const createProfile = useStore((s) => s.createProfile);
  const updateProfile = useStore((s) => s.updateProfile);
  const removeProfile = useStore((s) => s.removeProfile);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Set<number>>(new Set());
  const [tone, setTone] = useState("beep");
  const [volumeCustom, setVolumeCustom] = useState(false);
  const [volume, setVolume] = useState(100);
  const [profileId, setProfileId] = useState("");

  const [profilesOpen, setProfilesOpen] = useState(false);
  const [profileForm, setProfileForm] =
    useState<Omit<AutoAnswerProfile, "id">>(EMPTY_PROFILE);
  const [editingProfile, setEditingProfile] = useState<number | null>(null);

  const openAdd = () => {
    setName("");
    setTone("beep");
    setVolumeCustom(false);
    setVolume(100);
    setProfileId("");
    setDialog({ mode: "add" });
  };
  const openEdit = (z: NonNullable<DialogState> & { mode: "edit" }) => {
    setName(z.name);
    setTone(toneValue(z.beep, z.announcementId));
    setVolumeCustom(z.volume != null);
    setVolume(z.volume ?? 100);
    setProfileId(
      z.autoAnswerProfileId != null ? String(z.autoAnswerProfileId) : "",
    );
    setDialog(z);
  };
  const openMembers = (id: number, zoneName: string, endpointIds: number[]) => {
    setMembers(new Set(endpointIds));
    setDialog({ mode: "members", id, name: zoneName });
  };

  const toggleMember = (id: number) =>
    setMembers((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = async () => {
    if (dialog?.mode === "add") {
      await addZone(name);
      setDialog(null);
    } else if (dialog?.mode === "edit") {
      const beep = tone !== "none";
      const announcementId = tone.startsWith("ann_")
        ? Number(tone.slice(4))
        : null;
      await updateZone(dialog.id, {
        name,
        beep,
        announcementId,
        volume: volumeCustom ? Math.min(100, Math.max(0, volume)) : null,
        autoAnswerProfileId: profileId ? Number(profileId) : null,
      });
      setDialog(null);
    } else if (dialog?.mode === "members") {
      const zone = zones.find((z) => z.id === dialog.id);
      const current = new Set(zone?.endpointIds ?? []);
      for (const id of current)
        if (!members.has(id)) await detachMember(dialog.id, id);
      for (const id of members)
        if (!current.has(id)) await attachMember(dialog.id, id);
      setDialog(null);
    }
  };

  const saveProfile = async () => {
    if (!profileForm.name.trim()) return;
    const data = {
      name: profileForm.name.trim(),
      userAgentMatch: profileForm.userAgentMatch || null,
      alertInfo: profileForm.alertInfo || null,
      callInfo: profileForm.callInfo || null,
      sipUri: profileForm.sipUri || null,
      dTime: profileForm.dTime,
      dialOptions: profileForm.dialOptions || null,
    };
    if (editingProfile != null) {
      await updateProfile(editingProfile, data);
      setEditingProfile(null);
    } else {
      await createProfile(data);
    }
    setProfileForm(EMPTY_PROFILE);
  };

  const editProfile = (p: AutoAnswerProfile) => {
    setEditingProfile(p.id);
    setProfileForm({
      name: p.name,
      userAgentMatch: p.userAgentMatch,
      alertInfo: p.alertInfo,
      callInfo: p.callInfo,
      sipUri: p.sipUri,
      dTime: p.dTime,
      dialOptions: p.dialOptions,
    });
  };

  const labelFor = (id: number) =>
    endpoints.find((e) => e.id === id)?.label ?? `#${id}`;

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-col items-stretch justify-between gap-2 flex-shrink-0 sm:flex-row sm:items-center">
        <span className="text-xs text-muted-foreground">
          {zones.length} zone{zones.length === 1 ? "" : "s"}
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs sm:w-auto"
            onClick={() => {
              setEditingProfile(null);
              setProfileForm(EMPTY_PROFILE);
              setProfilesOpen(true);
            }}
          >
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Auto-answer
            profiles
          </Button>
          <Button
            size="sm"
            className="w-full text-xs sm:w-auto"
            onClick={openAdd}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add zone
          </Button>
        </div>
      </div>

      <div className="flex-shrink-0 overflow-x-auto rounded-xl border bg-card">
        <table className="min-w-[620px] w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Endpoints</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr
                key={z.id}
                className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 font-medium">
                    <Layers size={13} className="text-muted-foreground" />
                    {z.name}
                    {busyZoneIds.has(z.id) && (
                      <span className="text-[10px] font-mono text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                        IN PROGRESS
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                    {z.volume != null && (
                      <span className="flex items-center gap-0.5">
                        <Volume2 size={10} />
                        {z.volume}%
                      </span>
                    )}
                    <span>
                      {z.announcementId != null
                        ? "custom tone"
                        : z.beep
                          ? "beep"
                          : "no tone"}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  <span className="font-mono text-[11px]">
                    {z.endpointCount}
                  </span>
                  <span className="ml-2 text-xs">
                    {(z.endpointIds ?? [])
                      .map((id) => labelFor(id))
                      .join(", ") || "—"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                      onClick={() =>
                        openMembers(z.id, z.name, z.endpointIds ?? [])
                      }
                      title="Manage members"
                    >
                      <Users size={14} />
                    </button>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                      onClick={() =>
                        openEdit({
                          mode: "edit",
                          id: z.id,
                          name: z.name,
                          beep: z.beep,
                          volume: z.volume,
                          announcementId: z.announcementId,
                          autoAnswerProfileId: z.autoAnswerProfileId,
                        })
                      }
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                      onClick={() => void removeZone(z.id)}
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
        {zones.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground">
            No zones yet — create one to group endpoints for broadcast.
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
              {dialog?.mode === "add"
                ? "Add zone"
                : dialog?.mode === "edit"
                  ? `Edit zone — ${dialog.name}`
                  : `Manage members — ${dialog?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription>
              {dialog?.mode === "members"
                ? "Tick the endpoints that belong to this zone. Broadcasts to the zone reach only these endpoints."
                : "Zones group endpoints for broadcast. Choose the attention tone and page volume applied before each broadcast."}
            </DialogDescription>
          </DialogHeader>

          {dialog?.mode === "members" ? (
            <div className="grid gap-1.5 max-h-72 overflow-y-auto pr-1">
              {endpoints.map((e) => (
                <label
                  key={e.id}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 cursor-pointer"
                >
                  <Checkbox
                    checked={members.has(e.id)}
                    onCheckedChange={() => toggleMember(e.id)}
                    className="h-3.5 w-3.5"
                  />
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${e.registered ? "bg-emerald-400" : "bg-muted-foreground"}`}
                  />
                  <span className="flex-1 text-sm truncate">{e.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {e.extension}
                  </span>
                </label>
              ))}
              {endpoints.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No endpoints to assign.
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4">
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="All Staff"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Attention tone
                </label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="none">None</option>
                  <option value="beep">Beep (default)</option>
                  {announcements.map((a) => (
                    <option key={a.id} value={`ann_${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1 block">
                  Auto-answer profile
                </label>
                <select
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Default (none)</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.userAgentMatch ? ` — ${p.userAgentMatch}` : ""}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Vendor-matched SIP headers applied to this zone's pages.
                </div>
              </div>
              <div>
                <label className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Page volume</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={volumeCustom}
                      onCheckedChange={(c) => setVolumeCustom(Boolean(c))}
                      className="h-3.5 w-3.5"
                    />
                    Custom
                  </label>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  disabled={!volumeCustom}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="w-full accent-[hsl(var(--primary))] disabled:opacity-40"
                />
                <div className="text-[10px] text-muted-foreground text-right">
                  {volumeCustom ? `${volume}%` : "Phone default"}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Profiles manager dialog */}
      <Dialog open={profilesOpen} onOpenChange={setProfilesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Auto-answer profiles</DialogTitle>
            <DialogDescription>
              Define per-vendor SIP header overrides for auto-answer. Zone
              broadcasts reference a profile by name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 max-h-80 overflow-y-auto">
            {profiles.length === 0 && (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No profiles yet — add one below.
              </div>
            )}
            {profiles.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between border rounded-lg p-3 gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground font-mono truncate">
                    {p.userAgentMatch && (
                      <span className="mr-2">UA: {p.userAgentMatch}</span>
                    )}
                    {p.alertInfo && (
                      <span className="mr-2">Alert-Info: {p.alertInfo}</span>
                    )}
                    {p.callInfo && (
                      <span className="mr-2">Call-Info: {p.callInfo}</span>
                    )}
                    {p.dTime != null && <span>Timeout: {p.dTime}s</span>}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                    onClick={() => editProfile(p)}
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="p-1.5 text-muted-foreground hover:text-destructive rounded-md transition-colors"
                    onClick={() => void removeProfile(p.id)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="border rounded-lg p-3 grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">
                    Name
                  </label>
                  <Input
                    value={profileForm.name}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, name: e.target.value })
                    }
                    placeholder="Grandstream"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">
                    User-Agent match
                  </label>
                  <Input
                    value={profileForm.userAgentMatch ?? ""}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        userAgentMatch: e.target.value || null,
                      })
                    }
                    placeholder="Grandstream GXP"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">
                    Alert-Info
                  </label>
                  <Input
                    value={profileForm.alertInfo ?? ""}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        alertInfo: e.target.value || null,
                      })
                    }
                    placeholder="Ring Answer"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">
                    Call-Info
                  </label>
                  <Input
                    value={profileForm.callInfo ?? ""}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        callInfo: e.target.value || null,
                      })
                    }
                    placeholder="answer-after=0"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">
                    Intercom (SIP URI)
                  </label>
                  <Input
                    value={profileForm.sipUri ?? ""}
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        sipUri: e.target.value || null,
                      })
                    }
                    placeholder="intercom=true"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">
                    Dial timeout (s)
                  </label>
                  <Input
                    value={
                      profileForm.dTime != null ? String(profileForm.dTime) : ""
                    }
                    onChange={(e) =>
                      setProfileForm({
                        ...profileForm,
                        dTime: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder="30"
                    type="number"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <Button size="sm" className="text-xs" onClick={saveProfile}>
                {editingProfile != null ? "Update profile" : "Add profile"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
