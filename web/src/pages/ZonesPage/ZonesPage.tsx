import { useState } from "react";
import { Layers, Pencil, Plus, SlidersHorizontal, Trash2, Users, Volume2 } from "lucide-react";
import { useStore } from "@/store";
import { Button } from "@/components/Button/Button";
import { Card } from "@/components/Card/Card";
import { Input } from "@/components/Input/Input";
import { Checkbox } from "@/components/Checkbox/Checkbox";
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
  const [profileForm, setProfileForm] = useState<Omit<AutoAnswerProfile, "id">>(EMPTY_PROFILE);
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
    setProfileId(z.autoAnswerProfileId != null ? String(z.autoAnswerProfileId) : "");
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
      const announcementId = tone.startsWith("ann_") ? Number(tone.slice(4)) : null;
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
      for (const id of current) if (!members.has(id)) await detachMember(dialog.id, id);
      for (const id of members) if (!current.has(id)) await attachMember(dialog.id, id);
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

  const labelFor = (id: number) => endpoints.find((e) => e.id === id)?.label ?? `#${id}`;

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Zones"
        subtitle={`${zones.length} zone${zones.length === 1 ? "" : "s"} · group endpoints for one-touch broadcast`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingProfile(null);
                setProfileForm(EMPTY_PROFILE);
                setProfilesOpen(true);
              }}
            >
              <SlidersHorizontal size={13} /> Auto-answer profiles
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus size={13} /> Add zone
            </Button>
          </>
        }
      />

      <div className="grid-cards">
        {zones.map((z) => (
          <Card key={z.id} className="stack-sm" style={{ gap: 10 }}>
            <div className="inline" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div className="inline" style={{ gap: 7 }}>
                  <Layers size={13} className="muted" />
                  <b style={{ fontSize: 13.5 }}>{z.name}</b>
                  {busyZoneIds.has(z.id) && <span className="chip warn">In progress</span>}
                </div>
                <div className="inline muted" style={{ gap: 10, marginTop: 4, fontSize: 11 }}>
                  {z.volume != null && (
                    <span className="inline" style={{ gap: 3 }}>
                      <Volume2 size={10} /> {z.volume}%
                    </span>
                  )}
                  <span>
                    {z.announcementId != null ? "custom tone" : z.beep ? "beep" : "no tone"}
                  </span>
                  <span>·</span>
                  <span>
                    {z.endpointCount} endpoint{z.endpointCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              <div className="inline" style={{ gap: 2, flexShrink: 0 }}>
                <button
                  type="button"
                  className="row-action"
                  onClick={() => openMembers(z.id, z.name, z.endpointIds ?? [])}
                  title="Manage members"
                >
                  <Users size={14} />
                </button>
                <button
                  type="button"
                  className="row-action"
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
                  type="button"
                  className="row-action danger"
                  onClick={() => void removeZone(z.id)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="inline" style={{ gap: 5, flexWrap: "wrap" }}>
              {(z.endpointIds ?? []).map((id) => (
                <span key={id} className="pill-label">
                  {labelFor(id)}
                </span>
              ))}
              {(z.endpointIds ?? []).length === 0 && (
                <span className="muted tiny">No endpoints assigned</span>
              )}
            </div>
          </Card>
        ))}
        {zones.length === 0 && (
          <div className="state state-empty" style={{ gridColumn: "1 / -1" }}>
            No zones yet — create one to group endpoints for broadcast.
          </div>
        )}
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
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
            <div className="stack-sm" style={{ maxHeight: 300, overflowY: "auto" }}>
              {endpoints.map((e) => (
                <label key={e.id} className="check-row">
                  <Checkbox checked={members.has(e.id)} onCheckedChange={() => toggleMember(e.id)} />
                  <span className={`online-dot ${e.registered ? "on" : "off"}`} />
                  <span style={{ flex: 1 }}>{e.label}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>{e.extension}</span>
                </label>
              ))}
              {endpoints.length === 0 && <div className="muted tiny">No endpoints to assign.</div>}
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <div className="form-row">
                <label>Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="All Staff" autoFocus />
              </div>
              <div className="form-row">
                <label>Attention tone</label>
                <select className="input" value={tone} onChange={(e) => setTone(e.target.value)}>
                  <option value="none">None</option>
                  <option value="beep">Beep (default)</option>
                  {announcements.map((a) => (
                    <option key={a.id} value={`ann_${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Auto-answer profile</label>
                <select className="input" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <option value="">Default (none)</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.userAgentMatch ? ` — ${p.userAgentMatch}` : ""}
                    </option>
                  ))}
                </select>
                <div className="muted tiny">Vendor-matched SIP headers applied to this zone's pages.</div>
              </div>
              <div className="form-row">
                <label className="inline" style={{ justifyContent: "space-between" }}>
                  <span>Page volume</span>
                  <label className="inline" style={{ gap: 6, cursor: "pointer" }}>
                    <Checkbox checked={volumeCustom} onCheckedChange={(c) => setVolumeCustom(Boolean(c))} />
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
                  style={{ opacity: volumeCustom ? 1 : 0.4 }}
                />
                <div className="muted tiny" style={{ textAlign: "right" }}>
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

      <Dialog open={profilesOpen} onOpenChange={setProfilesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auto-answer profiles</DialogTitle>
            <DialogDescription>
              Define per-vendor SIP header overrides for auto-answer. Zone broadcasts reference a profile by name.
            </DialogDescription>
          </DialogHeader>
          <div className="stack-sm" style={{ maxHeight: 340, overflowY: "auto" }}>
            {profiles.length === 0 && <div className="muted tiny" style={{ textAlign: "center", padding: 16 }}>No profiles yet — add one below.</div>}
            {profiles.map((p) => (
              <div key={p.id} className="profile-card">
                <div style={{ minWidth: 0 }}>
                  <b>{p.name}</b>
                  <small>
                    {p.userAgentMatch && <span style={{ marginRight: 8 }}>UA: {p.userAgentMatch}</span>}
                    {p.alertInfo && <span style={{ marginRight: 8 }}>Alert-Info: {p.alertInfo}</span>}
                    {p.callInfo && <span style={{ marginRight: 8 }}>Call-Info: {p.callInfo}</span>}
                    {p.dTime != null && <span>Timeout: {p.dTime}s</span>}
                  </small>
                </div>
                <div className="inline" style={{ gap: 2, flexShrink: 0 }}>
                  <button type="button" className="row-action" onClick={() => editProfile(p)} title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="row-action danger" onClick={() => void removeProfile(p.id)} title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="card" style={{ padding: 12 }}>
              <div className="form-grid">
                <div className="form-row">
                  <label>Name</label>
                  <Input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    placeholder="Grandstream"
                  />
                </div>
                <div className="form-row">
                  <label>User-Agent match</label>
                  <Input
                    value={profileForm.userAgentMatch ?? ""}
                    onChange={(e) => setProfileForm({ ...profileForm, userAgentMatch: e.target.value || null })}
                    placeholder="Grandstream GXP"
                  />
                </div>
                <div className="form-row">
                  <label>Alert-Info</label>
                  <Input
                    value={profileForm.alertInfo ?? ""}
                    onChange={(e) => setProfileForm({ ...profileForm, alertInfo: e.target.value || null })}
                    placeholder="Ring Answer"
                  />
                </div>
                <div className="form-row">
                  <label>Call-Info</label>
                  <Input
                    value={profileForm.callInfo ?? ""}
                    onChange={(e) => setProfileForm({ ...profileForm, callInfo: e.target.value || null })}
                    placeholder="answer-after=0"
                  />
                </div>
                <div className="form-row">
                  <label>Intercom (SIP URI)</label>
                  <Input
                    value={profileForm.sipUri ?? ""}
                    onChange={(e) => setProfileForm({ ...profileForm, sipUri: e.target.value || null })}
                    placeholder="intercom=true"
                  />
                </div>
                <div className="form-row">
                  <label>Dial timeout (s)</label>
                  <Input
                    value={profileForm.dTime != null ? String(profileForm.dTime) : ""}
                    onChange={(e) => setProfileForm({ ...profileForm, dTime: e.target.value ? Number(e.target.value) : null })}
                    placeholder="30"
                    type="number"
                  />
                </div>
              </div>
              <Button size="sm" style={{ marginTop: 10 }} onClick={saveProfile}>
                {editingProfile != null ? "Update profile" : "Add profile"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
