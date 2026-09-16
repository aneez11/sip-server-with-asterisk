import { useState } from 'react';
import { Plus, Pencil, Trash2, Phone, Volume2, Radio, Hash } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Input } from '@/components/Input/Input';
import { Badge } from '@/components/Badge/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/Dialog/Dialog';
import type { PaGroup } from '@infinity/shared';

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; id: number }
  | null;

interface FormState {
  name: string;
  extension: string;
  initiatorEndpointId: number | null;
  paStartAnnouncementId: number | null;
  paEndAnnouncementId: number | null;
  receiverEndpointIds: number[];
}

const NOT_SET = '__none__';

export const PaGroupsPage = () => {
  const paGroups = useStore((s) => s.paGroups);
  const endpoints = useStore((s) => s.endpoints);
  const announcements = useStore((s) => s.announcements);
  const createPaGroup = useStore((s) => s.createPaGroup);
  const updatePaGroup = useStore((s) => s.updatePaGroup);
  const removePaGroup = useStore((s) => s.removePaGroup);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState<FormState>({
    name: '',
    extension: '',
    initiatorEndpointId: null,
    paStartAnnouncementId: null,
    paEndAnnouncementId: null,
    receiverEndpointIds: [],
  });

  const openAdd = () => {
    setForm({ name: '', extension: '', initiatorEndpointId: null, paStartAnnouncementId: null, paEndAnnouncementId: null, receiverEndpointIds: [] });
    setDialog({ mode: 'add' });
  };
  const openEdit = (g: PaGroup) => {
    setForm({
      name: g.name,
      extension: g.extension,
      initiatorEndpointId: g.initiatorEndpointId,
      paStartAnnouncementId: g.paStartAnnouncementId,
      paEndAnnouncementId: g.paEndAnnouncementId,
      receiverEndpointIds: [...g.receiverEndpointIds],
    });
    setDialog({ mode: 'edit', id: g.id });
  };

  const toggleReceiver = (id: number) => {
    setForm((f) => ({
      ...f,
      receiverEndpointIds: f.receiverEndpointIds.includes(id)
        ? f.receiverEndpointIds.filter((x) => x !== id)
        : [...f.receiverEndpointIds, id],
    }));
  };

  const save = async () => {
    if (!form.name.trim()) { return; }
    const payload = {
      name: form.name.trim(),
      extension: form.extension.trim(),
      initiatorEndpointId: form.initiatorEndpointId,
      paStartAnnouncementId: form.paStartAnnouncementId,
      paEndAnnouncementId: form.paEndAnnouncementId,
      receiverEndpointIds: form.receiverEndpointIds,
    };
    if (dialog?.mode === 'add') await createPaGroup(payload);
    else if (dialog?.mode === 'edit') await updatePaGroup(dialog.id, payload);
    setDialog(null);
  };

  const selectedName = endpoints.find((e) => e.id === form.initiatorEndpointId);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {paGroups.length} PA group{paGroups.length === 1 ? '' : 's'} — dial a group extension on an initiator device to announce to its receivers
        </span>
        <Button variant="default" size="sm" className="text-xs" onClick={openAdd}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New PA group
        </Button>
      </div>

      {paGroups.length === 0 ? (
        <div className="flex-1 border rounded-xl bg-muted/30 p-16 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
          <div className="text-4xl">📣</div>
          <div>No PA groups yet. Create one to start a one-to-many announcement.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 content-start">
          {paGroups.map((g) => {
            const receivers = endpoints.filter((e) => g.receiverEndpointIds.includes(e.id));
            return (
              <div key={g.id} className="bg-card border rounded-xl shadow-sm p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{g.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 font-mono">
                        <Hash size={9} className="mr-0.5" /> {g.extension}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground text-[11px] mt-1 flex items-center gap-1">
                      <Phone size={11} className="flex-shrink-0" />
                      Initiator: {g.initiatorLabel ?? g.initiatorExtension ?? 'Any device'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button className="p-1.5 text-muted-foreground hover:text-primary rounded-md transition-colors" onClick={() => openEdit(g)} title="Edit"><Pencil size={14} /></button>
                    <button className="p-1.5 text-muted-foreground hover:text-destructive rounded-md transition-colors" onClick={() => void removePaGroup(g.id)} title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>

                <div className="text-muted-foreground text-[11px] flex items-center gap-1">
                  <Radio size={11} className="flex-shrink-0" />
                  {receivers.length} receiver{receivers.length === 1 ? '' : 's'}
                </div>
                {receivers.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {receivers.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40 border border-border/60 text-[10px]">
                        {r.type === 'speaker' ? <Volume2 size={9} /> : <Phone size={9} />}
                        {r.label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center pt-1 text-[11px] text-muted-foreground">
                  <span>Start: {findAnc(announcements, g.paStartAnnouncementId) ?? 'Beep'}</span>
                  <span>End: {findAnc(announcements, g.paEndAnnouncementId) ?? 'None'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'edit' ? 'Edit PA group' : 'New PA group'}</DialogTitle>
            <DialogDescription>Dial the extension on the initiator device to announce to the receivers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. All classrooms" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Group extension</label>
                <Input value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })} placeholder="e.g. 9100" inputMode="numeric" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Initiator device (leave as Any to let any endpoint trigger it)</label>
              <select
                className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
                value={form.initiatorEndpointId ?? ''}
                onChange={(e) => setForm({ ...form, initiatorEndpointId: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Any endpoint</option>
                {endpoints.map((e) => (
                  <option key={e.id} value={e.id}>{e.label} ({e.extension})</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">PA start sound</label>
                <select className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm" value={form.paStartAnnouncementId ?? NOT_SET} onChange={(e) => setForm({ ...form, paStartAnnouncementId: e.target.value === NOT_SET ? null : Number(e.target.value) })}>
                  <option value={NOT_SET}>Default beep</option>
                  {announcements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">PA end sound</label>
                <select className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm" value={form.paEndAnnouncementId ?? NOT_SET} onChange={(e) => setForm({ ...form, paEndAnnouncementId: e.target.value === NOT_SET ? null : Number(e.target.value) })}>
                  <option value={NOT_SET}>None</option>
                  {announcements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Receivers ({form.receiverEndpointIds.length} selected)</label>
              <div className="max-h-48 overflow-y-auto border rounded-lg divide-y divide-border/60 bg-muted/10">
                {endpoints.length === 0 && <div className="p-3 text-xs text-muted-foreground">No endpoints configured.</div>}
                {endpoints.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/40 cursor-pointer">
                    <input type="checkbox" className="accent-primary" checked={form.receiverEndpointIds.includes(e.id)} onChange={() => toggleReceiver(e.id)} />
                    <span className="flex-1 truncate">{e.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{e.extension}</span>
                    <span className="text-[10px] text-muted-foreground">{e.type === 'speaker' ? 'Speaker' : 'Phone'}</span>
                  </label>
                ))}
              </div>
            </div>

            {form.initiatorEndpointId != null && selectedName && !form.receiverEndpointIds.includes(form.initiatorEndpointId) && (
              <p className="text-[11px] text-amber-500">The initiator ({selectedName.label}) is not also selected as a receiver — good; it will not hear itself.</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
            <Button size="sm" onClick={() => void save()} disabled={!form.name.trim() || !form.extension.trim()}>{dialog?.mode === 'edit' ? 'Save changes' : 'Create group'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function findAnc(announcements: { id: number; name: string }[], id: number | null): string | null {
  if (id == null) return null;
  return announcements.find((a) => a.id === id)?.name ?? null;
}
