import { useState } from 'react';
import { Hash, Pencil, Phone, Plus, Radio, Trash2, Volume2 } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Input } from '@/components/Input/Input';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/Dialog/Dialog';
import type { PaGroup } from '@infinity/shared';

type DialogState = { mode: 'add' } | { mode: 'edit'; id: number } | null;

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
    if (!form.name.trim()) return;
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
    <div className="page-scroll">
      <ScreenHeader
        title="PA groups"
        subtitle={`${paGroups.length} group${paGroups.length === 1 ? '' : 's'} · dial a group extension on an initiator device to announce to its receivers`}
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={13} /> New PA group
          </Button>
        }
      />

      {paGroups.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>No PA groups yet</strong>
            <p>Create one to start a one-to-many announcement from any phone.</p>
          </div>
        </div>
      ) : (
        <div className="grid-cards">
          {paGroups.map((g) => {
            const receivers = endpoints.filter((e) => g.receiverEndpointIds.includes(e.id));
            return (
              <div key={g.id} className="card pa-card">
                <div className="pa-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="pa-name">
                      <b>{g.name}</b>
                      <span className="pill-label mono">
                        <Hash size={9} /> {g.extension}
                      </span>
                    </div>
                    <div className="pa-line">
                      <Phone size={11} />
                      Initiator: {g.initiatorLabel ?? g.initiatorExtension ?? 'Any device'}
                    </div>
                  </div>
                  <div className="inline" style={{ gap: 2, flexShrink: 0 }}>
                    <button type="button" className="row-action" onClick={() => openEdit(g)} title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="row-action danger" onClick={() => void removePaGroup(g.id)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="pa-line">
                  <Radio size={11} />
                  {receivers.length} receiver{receivers.length === 1 ? '' : 's'}
                </div>

                {receivers.length > 0 && (
                  <div className="pa-receivers">
                    {receivers.map((r) => (
                      <span key={r.id} className="pill-label">
                        {r.type === 'speaker' ? <Volume2 size={9} /> : <Phone size={9} />}
                        {r.label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="pa-tone">
                  <span>Start: {findAnc(announcements, g.paStartAnnouncementId) ?? 'Beep'}</span>
                  <span>End: {findAnc(announcements, g.paEndAnnouncementId) ?? 'None'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'edit' ? 'Edit PA group' : 'New PA group'}</DialogTitle>
            <DialogDescription>Dial the extension on the initiator device to announce to the receivers.</DialogDescription>
          </DialogHeader>

          <div className="stack" style={{ gap: 12 }}>
            <div className="form-grid">
              <div className="form-row">
                <label>Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. All classrooms" />
              </div>
              <div className="form-row">
                <label>Group extension</label>
                <Input value={form.extension} onChange={(e) => setForm({ ...form, extension: e.target.value })} placeholder="e.g. 9100" inputMode="numeric" />
              </div>
            </div>

            <div className="form-row">
              <label>Initiator device (leave as Any to let any endpoint trigger it)</label>
              <select
                className="input"
                value={form.initiatorEndpointId ?? ''}
                onChange={(e) => setForm({ ...form, initiatorEndpointId: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Any endpoint</option>
                {endpoints.map((e) => (
                  <option key={e.id} value={e.id}>{e.label} ({e.extension})</option>
                ))}
              </select>
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label>PA start sound</label>
                <select className="input" value={form.paStartAnnouncementId ?? NOT_SET} onChange={(e) => setForm({ ...form, paStartAnnouncementId: e.target.value === NOT_SET ? null : Number(e.target.value) })}>
                  <option value={NOT_SET}>Default beep</option>
                  {announcements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>PA end sound</label>
                <select className="input" value={form.paEndAnnouncementId ?? NOT_SET} onChange={(e) => setForm({ ...form, paEndAnnouncementId: e.target.value === NOT_SET ? null : Number(e.target.value) })}>
                  <option value={NOT_SET}>None</option>
                  {announcements.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <label>Receivers ({form.receiverEndpointIds.length} selected)</label>
              <div className="stack-sm" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 9, padding: 4 }}>
                {endpoints.length === 0 && <div className="muted tiny" style={{ padding: 10 }}>No endpoints configured.</div>}
                {endpoints.map((e) => (
                  <label key={e.id} className="check-row">
                    <input
                      type="checkbox"
                      style={{ accentColor: 'var(--acc)' }}
                      checked={form.receiverEndpointIds.includes(e.id)}
                      onChange={() => toggleReceiver(e.id)}
                    />
                    <span style={{ flex: 1 }}>{e.label}</span>
                    <span className="mono muted" style={{ fontSize: 10 }}>{e.extension}</span>
                    <span className="muted tiny">{e.type === 'speaker' ? 'Speaker' : 'Phone'}</span>
                  </label>
                ))}
              </div>
            </div>

            {form.initiatorEndpointId != null && selectedName && !form.receiverEndpointIds.includes(form.initiatorEndpointId) && (
              <p className="note" style={{ color: 'var(--warn)', margin: 0 }}>
                The initiator ({selectedName.label}) is not also selected as a receiver — good; it will not hear itself.
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
            <Button size="sm" onClick={() => void save()} disabled={!form.name.trim() || !form.extension.trim()}>
              {dialog?.mode === 'edit' ? 'Save changes' : 'Create group'}
            </Button>
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
