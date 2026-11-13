import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera as CameraIcon,
  Loader2,
  Pencil,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Trash2,
  VideoOff,
} from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { Input } from '@/components/Input/Input';
import { Badge } from '@/components/Badge/Badge';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { CameraForm, type CameraFormTransport } from '@/components/CameraForm/CameraForm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/Dialog/Dialog';
import { api } from '@/lib/api/client';
import { attachCameraPreview, startCameraSnapshotPoll } from '@/lib/camera';
import type { CameraSession } from '@/lib/camera';
import type { CameraView, DiscoveredCamera } from '@infinity/shared';

type StatusFilter = 'all' | 'online' | 'unreachable' | 'disabled';

const statusOf = (cam: CameraView): Exclude<StatusFilter, 'all'> => {
  if (!cam.enabled || !cam.configured) return 'disabled';
  return cam.reachable === false ? 'unreachable' : 'online';
};

const STATUS_LABEL: Record<Exclude<StatusFilter, 'all'>, string> = {
  online: 'Online',
  unreachable: 'Unreachable',
  disabled: 'Disabled',
};

const resolution = (cam: CameraView) =>
  cam.streamWidth && cam.streamHeight ? `${cam.streamWidth}×${cam.streamHeight}` : null;

/** IP camera management: fleet list, discovery, editing and preview. */
export const CamerasPage = () => {
  const endpoints = useStore((s) => s.endpoints);
  const [cameras, setCameras] = useState<CameraView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<CameraView | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<CameraView | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [found, setFound] = useState<DiscoveredCamera[] | null>(null);

  const load = async () => {
    try {
      setLoadError(null);
      setCameras(await api.cameras.list());
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Refresh statuses while the page is visible; a hidden tab does no work.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const counts = useMemo(() => {
    const out = { online: 0, unreachable: 0, disabled: 0 };
    for (const cam of cameras) out[statusOf(cam)] += 1;
    return out;
  }, [cameras]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cameras
      .filter((cam) => filter === 'all' || statusOf(cam) === filter)
      .filter(
        (cam) =>
          !q ||
          cam.name.toLowerCase().includes(q) ||
          cam.location.toLowerCase().includes(q) ||
          (cam.host ?? '').toLowerCase().includes(q),
      );
  }, [cameras, filter, query]);

  const endpointOptions = endpoints.map((e) => ({
    id: e.id,
    label: e.label,
    extension: e.extension,
  }));

  const transportFor = (id: number): CameraFormTransport => ({
    load: () => api.cameras.get(id),
    save: (body) => api.cameras.save(id, body),
    test: (cfg) => api.cameras.test(id, cfg),
    remove: () => api.cameras.remove(id),
    snapshotUrl: api.cameras.snapshotUrl(id),
  });

  const remove = async (cam: CameraView) => {
    if (!window.confirm(`Delete camera “${cam.name || cam.host}”?`)) return;
    await api.cameras.remove(cam.id).catch(() => undefined);
    await load();
  };

  const discover = async () => {
    setDiscovering(true);
    setFound(null);
    try {
      setFound(await api.cameras.discover(4000));
    } catch (e) {
      setFound([]);
      setLoadError((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  const addDiscovered = async (device: DiscoveredCamera) => {
    await api.cameras
      .addDiscovered({
        host: device.host,
        port: device.port,
        name: device.name ?? device.host,
        location: device.location ?? '',
      })
      .catch(() => undefined);
    await load();
    setFound((prev) => prev?.filter((d) => d.host !== device.host) ?? null);
  };

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Cameras"
        subtitle={`${counts.online} online · ${counts.unreachable} unreachable · ${counts.disabled} disabled — ONVIF cameras for room previews and monitoring`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setDiscoverOpen(true)}>
              <Radar size={13} /> Discover
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} /> Add camera
            </Button>
          </>
        }
      />

      <div className="target-filter">
        <div className="search-field">
          <Search size={14} />
          <Input
            placeholder="Search cameras by name, location or host"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search cameras"
          />
        </div>
        <select
          className="input"
          value={filter}
          onChange={(e) => setFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="unreachable">Unreachable</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {loadError && (
        <div className="inline-error">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw size={12} /> Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="state">
          <span className="spinner" aria-hidden="true" />
          Loading cameras…
        </div>
      ) : visible.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>
              {cameras.length === 0 ? 'No cameras yet' : 'No cameras match this filter'}
            </strong>
            <p>
              {cameras.length === 0
                ? 'Use Discover to find ONVIF cameras on this network, or add one by IP address.'
                : 'Clear the search or pick a different status.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid-cards">
          {visible.map((cam) => (
            <CameraCard
              key={cam.id}
              camera={cam}
              onPreview={() => setPreview(cam)}
              onEdit={() => setEditing(cam)}
              onDelete={() => void remove(cam)}
            />
          ))}
        </div>
      )}

      {/* Create */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add camera</DialogTitle>
            <DialogDescription>
              Name it now; host, credentials and streams are configured on the card
              afterwards.
            </DialogDescription>
          </DialogHeader>
          <CreateCameraForm
            endpoints={endpointOptions}
            onCreated={async () => {
              setCreating(false);
              await load();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="dialog-wide">
          <DialogHeader>
            <DialogTitle>Edit camera</DialogTitle>
            <DialogDescription>
              Probe with Test before saving. A linked camera also appears during a
              two-way call to that endpoint.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <CameraForm
              transport={transportFor(editing.id)}
              showMeta
              endpoints={endpointOptions}
              onSaved={() => void load()}
              onRemoved={() => {
                setEditing(null);
                void load();
              }}
            />
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview */}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="dialog-wide camera-preview-dialog">
          <DialogHeader>
            <DialogTitle>{preview?.name || 'Camera preview'}</DialogTitle>
            <DialogDescription>
              {preview?.location || preview?.host || ''}
            </DialogDescription>
          </DialogHeader>
          {preview && <CameraPreviewPanel camera={preview} />}
        </DialogContent>
      </Dialog>

      {/* Discovery */}
      <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discover cameras</DialogTitle>
            <DialogDescription>
              Multicasts an ONVIF probe on the local network. Cameras on another
              subnet, or with multicast blocked, will not answer.
            </DialogDescription>
          </DialogHeader>

          <div className="inline" style={{ justifyContent: 'space-between' }}>
            <Button size="sm" onClick={() => void discover()} disabled={discovering}>
              {discovering ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
              {discovering ? 'Scanning…' : 'Scan network'}
            </Button>
            {found && (
              <span className="muted tiny">
                {found.length} device{found.length === 1 ? '' : 's'} found
              </span>
            )}
          </div>

          {found && found.length > 0 && (
            <div className="discover-list">
              {found.map((device) => (
                <div key={device.host} className="discover-item">
                  <span className="discover-main">
                    <b>{device.name || device.host}</b>
                    <small>
                      {device.host}:{device.port}
                      {device.hardware ? ` · ${device.hardware}` : ''}
                    </small>
                  </span>
                  <Button
                    size="sm"
                    variant={device.alreadyAdded ? 'outline' : 'default'}
                    disabled={device.alreadyAdded}
                    onClick={() => void addDiscovered(device)}
                  >
                    {device.alreadyAdded ? 'Added' : 'Add'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {found && found.length === 0 && (
            <div className="state state-empty" style={{ minHeight: 110 }}>
              No ONVIF cameras answered. Add one by IP address instead.
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function CameraCard({
  camera,
  onPreview,
  onEdit,
  onDelete,
}: {
  camera: CameraView;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const status = statusOf(camera);
  const [thumbReady, setThumbReady] = useState(false);

  // Snapshots only while the card is on screen; 1 frame / 5 s keeps cameras calm.
  useEffect(() => {
    if (status !== 'online' || !camera.snapshotAvailable || !imgRef.current) return;
    let stop = () => undefined as void;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        stop = startCameraSnapshotPoll(camera.id, imgRef.current!, 5000);
      } else {
        stop();
      }
    });
    observer.observe(imgRef.current);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [camera.id, camera.snapshotAvailable, status]);

  const badgeVariant =
    status === 'online' ? 'default' : status === 'unreachable' ? 'destructive' : 'secondary';

  return (
    <Card className="camera-card">
      <div className="camera-thumb">
        {status === 'online' && camera.snapshotAvailable ? (
          <>
            {!thumbReady && (
              <span className="camera-thumb-empty">
                <CameraIcon size={18} />
                Loading snapshot…
              </span>
            )}
            <img
              ref={imgRef}
              alt={`${camera.name} snapshot`}
              onLoad={() => setThumbReady(true)}
              onError={() => setThumbReady(false)}
            />
          </>
        ) : (
          <span className="camera-thumb-empty">
            <VideoOff size={18} />
            {status === 'disabled' ? 'Camera disabled' : 'No snapshot available'}
          </span>
        )}
        {status === 'online' && (
          <span className="camera-thumb-actions">
            <button type="button" className="icon-link" onClick={onPreview} title="Preview">
              <Play size={14} />
            </button>
          </span>
        )}
      </div>

      <div className="camera-card-body">
        <div className="camera-card-title">
          <div style={{ minWidth: 0 }}>
            <b title={camera.name}>{camera.name || camera.host || 'Unnamed camera'}</b>
            <small>{camera.location || 'No location set'}</small>
          </div>
          <Badge variant={badgeVariant}>{STATUS_LABEL[status]}</Badge>
        </div>

        <div className="camera-meta">
          <span className="mono">{camera.host ? `${camera.host}:${camera.port ?? 80}` : '—'}</span>
          {camera.endpointLabel ? (
            <span>{camera.endpointLabel}</span>
          ) : (
            <span className="muted">Unassigned</span>
          )}
          {camera.streamCodec && (
            <span className="mono" style={{ textTransform: 'uppercase' }}>
              {camera.streamCodec}
            </span>
          )}
          {resolution(camera) && <span>{resolution(camera)}</span>}
        </div>

        <div className="camera-card-actions">
          <Button size="sm" variant="ghost" onClick={onPreview} disabled={status !== 'online'}>
            <Play size={12} /> Preview
          </Button>
          <span className="spacer" />
          <button type="button" className="row-action" onClick={onEdit} title="Edit camera">
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="row-action danger"
            onClick={onDelete}
            title="Delete camera"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  );
}

function CameraPreviewPanel({ camera }: { camera: CameraView }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [mode, setMode] = useState<'connecting' | 'live' | 'snapshot' | 'failed'>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let session: CameraSession | null = null;
    let stopPoll: (() => void) | null = null;

    const run = async () => {
      const isH264 = (camera.streamCodec ?? '').toLowerCase() === 'h264';
      if (isH264 && videoRef.current) {
        try {
          session = await attachCameraPreview(camera.id, videoRef.current);
          if (cancelled) {
            session.stop();
            return;
          }
          setMode('live');
          return;
        } catch (e) {
          if (cancelled) return;
          setError((e as Error).message);
        }
      }
      if (camera.snapshotAvailable && imgRef.current) {
        stopPoll = startCameraSnapshotPoll(camera.id, imgRef.current, 800);
        setMode('snapshot');
        return;
      }
      setMode('failed');
    };

    void run();
    return () => {
      cancelled = true;
      session?.stop();
      stopPoll?.();
    };
  }, [camera.id, camera.snapshotAvailable, camera.streamCodec]);

  return (
    <div className="camera-preview-stage">
      <video
        ref={videoRef}
        style={{ display: mode === 'live' ? 'block' : 'none' }}
        autoPlay
        playsInline
        muted
      />
      <img
        ref={imgRef}
        alt={`${camera.name} preview`}
        style={{ display: mode === 'snapshot' ? 'block' : 'none' }}
      />
      {mode === 'connecting' && (
        <div className="camera-preview-note">
          <Loader2 size={13} className="animate-spin" /> Connecting to the camera…
        </div>
      )}
      {mode === 'snapshot' && (
        <div className="camera-preview-note">
          <CameraIcon size={13} /> Snapshot preview — this camera streams HEVC, which browsers
          cannot play over WebRTC.
        </div>
      )}
      {mode === 'failed' && (
        <div className="camera-preview-note">
          <VideoOff size={13} /> {error ?? 'Preview unavailable for this camera.'}
        </div>
      )}
    </div>
  );
}

function CreateCameraForm({
  endpoints,
  onCreated,
}: {
  endpoints: { id: number; label: string; extension: string }[];
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [endpointId, setEndpointId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.cameras.create({ name: name.trim(), location, endpointId });
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="form-row">
        <label>Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Front gate"
          autoFocus
        />
      </div>
      <div className="form-row">
        <label>Location</label>
        <Input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Main entrance"
        />
      </div>
      <div className="form-row">
        <label>Linked endpoint (optional)</label>
        <select
          className="input"
          value={endpointId ?? ''}
          onChange={(e) => setEndpointId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Not linked</option>
          {endpoints.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.label} ({ep.extension})
            </option>
          ))}
        </select>
      </div>
      {error && <div className="form-error">{error}</div>}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create camera'}
        </Button>
      </DialogFooter>
    </>
  );
}
