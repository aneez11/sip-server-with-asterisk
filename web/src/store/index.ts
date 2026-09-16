import { create } from 'zustand';
import toast from 'react-hot-toast';
import type { Announcement, AutoAnswerProfile, BroadcastLog, CallsSnapshot, Endpoint, Music, OverviewResponse, PaGroup, Zone } from '@infinity/shared';
import { api, ApiError } from '@/lib/api/client';
import { talkSocket } from '@/lib/api/socket';
import { liveTalk } from '@/recorder/recorder';
import { webmToWav } from '@/lib/audio';

interface StoreState {
  endpoints: Endpoint[];
  zones: Zone[];
  announcements: Announcement[];
  music: Music[];
  profiles: AutoAnswerProfile[];
  paGroups: PaGroup[];
  recentLogs: BroadcastLog[];
  busyZoneIds: Set<number>;
  lastSync: Date | null;
  /** Whether the API is connected to Asterisk's AMI. */
  amiConnected: boolean;
  activeTab: 'broadcast' | 'media' | 'talk' | 'music' | 'endpoints' | 'zones' | 'history' | 'monitor' | 'pa-group';
  /** Live active calls snapshot (Monitor dashboard). */
  calls: CallsSnapshot | null;
  selectedZoneIds: Set<number>;
  collapsedZones: Set<string>;
  searchQuery: string;
  recording: boolean;
  activeTalkId: string | null;
  talkMode: 'live' | 'twoway' | null;
  busy: boolean;
  talkLevel: number;
  talkTargetIds: Set<number>;

  musicPlaying: boolean;
  currentMusicId: number | null;
  currentMusicLogId: number | null;
  musicStartedAt: string | null;
  musicTargetIds: number[];

  /** Recording a new announcement via the browser mic (record + upload). */
  recordingAnnouncement: boolean;
  recordAnnouncement: (name?: string) => Promise<Announcement | null>;
  cancelAnnouncementRecording: () => void;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshCalls: () => Promise<void>;
  setCalls: (snapshot: CallsSnapshot) => void;
  endCallMonitor: (callId: string) => Promise<void>;
  addToast: (msg: string, kind?: 'success' | 'error') => void;
  setActiveTab: (t: StoreState['activeTab']) => void;
  setSearchQuery: (q: string) => void;
  toggleCollapsed: (zone: string) => void;
  toggleZone: (id: number) => void;
  setTalkTargets: (ids: number[]) => void;
  toggleTalkTarget: (id: number) => void;
  setRecording: (r: boolean) => void;
  setTalkLevel: (l: number) => void;
  startLiveTalk: () => Promise<void>;
  stopLiveTalk: () => Promise<void>;

  playAnnouncement: (id: number, endpointIds: number[]) => Promise<void>;
  playAdhoc: (endpointIds: number[]) => Promise<void>;
  playZone: (zoneId: number) => Promise<void>;
  stopBroadcast: (logId?: number) => Promise<void>;
  uploadAnnouncement: (file: File, name?: string) => Promise<void>;
  removeAnnouncement: (id: number) => Promise<void>;

  uploadMusic: (file: File, name?: string) => Promise<void>;
  removeMusic: (id: number) => Promise<void>;
  playMusic: (id: number, endpointIds: number[]) => Promise<boolean>;
  stopMusic: () => Promise<void>;
  nextMusic: () => Promise<void>;
  prevMusic: () => Promise<void>;
  onMusicBroadcastUpdate: (log: BroadcastLog) => void;
  onBroadcastUpdated: (log: BroadcastLog) => void;

  addEndpoint: (d: { extension: string; label: string; location: string; type: string }) => Promise<Endpoint & { sipPassword?: string } | null>;
  updateEndpoint: (id: number, d: { label: string; location: string; type: string; isActive: boolean }) => Promise<void>;
  removeEndpoint: (id: number) => Promise<void>;
  setEndpointActive: (id: number, active: boolean) => Promise<void>;
  requalifyEndpoint: (id: number) => Promise<boolean>;
  addZone: (name: string) => Promise<void>;
  updateZone: (id: number, data: { name: string; beep: boolean; volume: number | null; announcementId: number | null; autoAnswerProfileId: number | null }) => Promise<void>;
  removeZone: (id: number) => Promise<void>;
  attachMember: (zoneId: number, endpointId: number) => Promise<void>;
  detachMember: (zoneId: number, endpointId: number) => Promise<void>;
  createProfile: (data: { name: string; userAgentMatch?: string | null; alertInfo?: string | null; callInfo?: string | null; sipUri?: string | null; dTime?: number | null; dialOptions?: string | null }) => Promise<void>;
  updateProfile: (id: number, data: { name: string; userAgentMatch?: string | null; alertInfo?: string | null; callInfo?: string | null; sipUri?: string | null; dTime?: number | null; dialOptions?: string | null }) => Promise<void>;
  removeProfile: (id: number) => Promise<void>;

  createPaGroup: (data: { name: string; extension: string; initiatorEndpointId: number | null; paStartAnnouncementId: number | null; paEndAnnouncementId: number | null; receiverEndpointIds: number[] }) => Promise<void>;
  updatePaGroup: (id: number, data: Partial<{ name: string; extension: string; initiatorEndpointId: number | null; paStartAnnouncementId: number | null; paEndAnnouncementId: number | null; receiverEndpointIds: number[] }>) => Promise<void>;
  removePaGroup: (id: number) => Promise<void>;
}

export const useStore = create<StoreState>((set, get) => {
  const addToast = (msg: string, kind: 'success' | 'error' = 'error') =>
    kind === 'success' ? toast.success(msg) : toast.error(msg);

  const applyOverview = (data: OverviewResponse) =>
    set({
      endpoints: data.endpoints,
      zones: data.zones,
      recentLogs: data.recentLogs,
      announcements: data.announcements,
      music: data.music ?? [],
      profiles: data.profiles ?? [],
      busyZoneIds: new Set(data.busyZoneIds ?? []),
      amiConnected: data.amiConnected ?? true,
      lastSync: new Date(),
    });

  const applyBroadcastUpdated = (log: BroadcastLog) => {
    const zoneId = log.zoneId;
    if (zoneId == null) return;
    set((s) => {
      const busy = new Set(s.busyZoneIds);
      if (log.status === 'pending') busy.add(zoneId);
      else busy.delete(zoneId);
      return { busyZoneIds: busy };
    });
  };

  return {
    endpoints: [],
    zones: [],
    announcements: [],
    music: [],
    profiles: [],
    paGroups: [],
    recentLogs: [],
    busyZoneIds: new Set(),
    lastSync: null,
    amiConnected: true,
    activeTab: 'broadcast',
    calls: null,
    selectedZoneIds: new Set(),
    collapsedZones: new Set(),
    searchQuery: '',
    recording: false,
    activeTalkId: null,
    talkMode: null,
    busy: false,
    talkLevel: 0,
    talkTargetIds: new Set(),
    musicPlaying: false,
    currentMusicId: null,
    currentMusicLogId: null,
    musicStartedAt: null,
    musicTargetIds: [],
    recordingAnnouncement: false,

    init: async () => {
      try { applyOverview(await api.overview()); } catch (e) { addToast((e as Error).message); }
      try { set({ paGroups: await api.paGroups.list() }); } catch (e) { addToast((e as Error).message); }
    },
    refresh: async () => {
      try { applyOverview(await api.overview()); } catch (e) { addToast((e as Error).message); }
      try { set({ paGroups: await api.paGroups.list() }); } catch (e) { /* keep last known */ }
    },
    refreshCalls: async () => {
      try { set({ calls: await api.monitor.snapshot() }); } catch (e) { addToast((e as Error).message); }
    },
    setCalls: (snapshot) => set({ calls: snapshot }),
    endCallMonitor: async (callId: string) => {
      try { await api.monitor.endCall(callId); await get().refreshCalls(); } catch (e) { addToast((e as Error).message); }
    },
    addToast,

    setActiveTab: (t) => set({ activeTab: t }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    toggleCollapsed: (zone) => set((s) => {
      const z = new Set(s.collapsedZones);
      z.has(zone) ? z.delete(zone) : z.add(zone);
      return { collapsedZones: z };
    }),
    toggleZone: (id) => set((s) => {
      const z = new Set(s.selectedZoneIds);
      z.has(id) ? z.delete(id) : z.add(id);
      return { selectedZoneIds: z };
    }),
    setTalkTargets: (ids) => set({ talkTargetIds: new Set(ids) }),
    toggleTalkTarget: (id) => set((s) => {
      const next = new Set(s.talkTargetIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { talkTargetIds: next };
    }),
    setRecording: (r) => set({ recording: r }),
    setTalkLevel: (l) => set({ talkLevel: l }),

    playAnnouncement: async (id, endpointIds) => {
      set({ busy: true });
      try { await api.announcements.play(id, endpointIds); addToast('Announcement playing', 'success'); } catch (e) { addToast((e as Error).message); }
      set({ busy: false });
    },
    playAdhoc: async (endpointIds) => {
      set({ busy: true });
      try { await api.broadcast.adhoc(endpointIds); addToast('Broadcast sent', 'success'); } catch (e) { addToast((e as Error).message); }
      set({ busy: false });
    },
    playZone: async (zoneId) => {
      set({ busy: true });
      try { await api.broadcast.zone(zoneId); addToast('Broadcast sent', 'success'); } catch (e) { addToast((e as Error).message); }
      set({ busy: false });
    },
    stopBroadcast: async (logId) => {
      try { const r = await api.broadcast.stop(logId); addToast(`Stopped ${r.stopped} channel(s)`, 'success'); await get().refresh(); } catch (e) { addToast((e as Error).message); }
    },
    uploadAnnouncement: async (file, name) => {
      try {
        const a = await api.announcements.upload(file, name);
        set((s) => ({ announcements: [...s.announcements, a] }));
        addToast('Announcement uploaded', 'success');
      } catch (e) { addToast((e as Error).message); }
    },
    recordAnnouncement: async (name) => {
      set({ recordingAnnouncement: true });
      let mediaRecorder: MediaRecorder;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      } catch (e) {
        set({ recordingAnnouncement: false });
        addToast(`Microphone access denied: ${(e as Error).message}`);
        return null;
      }
      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void (async () => {
          try {
            const wav = await webmToWav(new Blob(chunks, { type: 'audio/webm' }));
            if (!wav) { addToast('Recording too short'); return; }
            const fileName = `recording-${Date.now()}.wav`;
            const file = new File([wav], fileName, { type: 'audio/wav' });
            const a = await api.announcements.upload(file, name ?? `Recording ${new Date().toLocaleTimeString()}`);
            set((s) => ({ announcements: [...s.announcements, a] }));
            addToast('Recording uploaded', 'success');
          } catch (e) {
            addToast((e as Error).message);
          } finally {
            set({ recordingAnnouncement: false });
          }
        })();
      };
      mediaRecorder.start();
      // Store the recorder/stream so cancel can stop it.
      (get() as any).__rec = { mediaRecorder, stream };
      return null;
    },
    cancelAnnouncementRecording: () => {
      const rec = (get() as any).__rec as { mediaRecorder: MediaRecorder; stream: MediaStream } | null;
      if (rec) {
        rec.stream.getTracks().forEach((t) => t.stop());
        try { rec.mediaRecorder.stop(); } catch { /* already stopped */ }
      }
      set({ recordingAnnouncement: false });
    },
    removeAnnouncement: async (id) => {
      try {
        await api.announcements.remove(id);
        set((s) => ({ announcements: s.announcements.filter((a) => a.id !== id) }));
        addToast('Announcement removed', 'success');
      } catch (e) { addToast((e as Error).message); }
    },
    startLiveTalk: async () => {
      const ids = get().talkTargetIds;
      if (ids.size === 0) { addToast('Select endpoints first'); return; }
      set({ busy: true });
      try {
        const session = await api.talk.start([...ids]);
        talkSocket.join(session.id);
        try {
          await liveTalk.start({
            onLevel: (l) => set({ talkLevel: l }),
            onChunk: (pcm, rate) => talkSocket.sendAudio(session.id, pcm, rate),
          });
        } catch (e) {
          await api.talk.stop(session.id);
          addToast(`Microphone access denied: ${(e as Error).message}`);
          set({ activeTalkId: null, talkMode: null, busy: false });
          return;
        }
        set({ activeTalkId: session.id, talkMode: session.mode, recording: true, busy: false });
        addToast(`Live talk started (${session.mode === 'twoway' ? 'two-way call' : 'live broadcast'})`, 'success');
      } catch (e) { addToast((e as Error).message); set({ busy: false }); }
    },
    stopLiveTalk: async () => {
      const talkId = get().activeTalkId;
      if (!talkId) return;
      liveTalk.close();
      set({ busy: true });
      try { await api.talk.stop(talkId); addToast('Talk stopped', 'success'); } catch (e) { addToast((e as Error).message); }
      set({ activeTalkId: null, talkMode: null, recording: false, talkLevel: 0, busy: false });
    },

    uploadMusic: async (file, name) => {
      try {
        const m = await api.music.upload(file, name);
        set((s) => ({ music: [...s.music, m] }));
        addToast('Music uploaded', 'success');
      } catch (e) { addToast((e as Error).message); }
    },
    removeMusic: async (id) => {
      try {
        await api.music.remove(id);
        set((s) => ({ music: s.music.filter((m) => m.id !== id) }));
        if (get().currentMusicId === id) get().stopMusic();
        addToast('Music removed', 'success');
      } catch (e) { addToast((e as Error).message); }
    },
    playMusic: async (id, endpointIds) => {
      if (endpointIds.length === 0) { addToast('No endpoints selected'); return false; }
      set({ busy: true, musicPlaying: true, currentMusicId: id, musicTargetIds: endpointIds, musicStartedAt: new Date().toISOString() });
      try {
        const { broadcastLogId } = await api.music.play(id, endpointIds);
        set({ currentMusicLogId: broadcastLogId, busy: false });
        return true;
      } catch (e) {
        addToast((e as Error).message);
        set({ musicPlaying: false, currentMusicId: null, currentMusicLogId: null, musicStartedAt: null, busy: false });
        return false;
      }
    },
  stopMusic: async () => {
    // Hard-stop: hang up the active music broadcast via AMI so audio ends
    // immediately instead of playing out the current track.
    try { await api.music.stop(); } catch { /* best effort */ }
    set({ musicPlaying: false, currentMusicId: null, currentMusicLogId: null, musicStartedAt: null, musicTargetIds: [] });
  },
    nextMusic: async () => {
      const { music, currentMusicId, musicTargetIds } = get();
      if (music.length === 0) { get().stopMusic(); return; }
      const idx = music.findIndex((m) => m.id === currentMusicId);
      const next = music[(idx + 1) % music.length];
      if (next) await get().playMusic(next.id, musicTargetIds);
    },
    prevMusic: async () => {
      const { music, currentMusicId, musicTargetIds } = get();
      if (music.length === 0) { get().stopMusic(); return; }
      const idx = music.findIndex((m) => m.id === currentMusicId);
      const prev = music[(idx - 1 + music.length) % music.length];
      if (prev) await get().playMusic(prev.id, musicTargetIds);
    },
    onMusicBroadcastUpdate: (log) => {
      const s = get();
      if (!s.musicPlaying || s.currentMusicLogId === null || log.id !== s.currentMusicLogId) return;
      if (log.status === 'pending') return;
      // Broadcast finished — advance to next track
      void s.nextMusic();
    },
    onBroadcastUpdated: (log) => applyBroadcastUpdated(log),

    addEndpoint: async (d) => {
      try {
        const created = await api.endpoints.create({ ...d, type: d.type as 'phone' | 'speaker' });
        await get().refresh();
        addToast(`Endpoint ${created.extension} added`, 'success');
        return created;
      } catch (e) { addToast((e as ApiError).message ?? (e as Error).message); return null; }
    },
    updateEndpoint: async (id, d) => {
      try { await api.endpoints.update(id, d); await get().refresh(); addToast('Endpoint updated', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    removeEndpoint: async (id) => {
      try { await api.endpoints.remove(id); await get().refresh(); addToast('Endpoint removed', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    setEndpointActive: async (id, active) => {
      try { await api.endpoints.setActive(id, active); await get().refresh(); } catch (e) { addToast((e as Error).message); }
    },
    requalifyEndpoint: async (id) => {
      try {
        await api.endpoints.requalify(id);
        await get().refresh();
        addToast('Requalify sent — device should re-register', 'success');
        return true;
      } catch (e) {
        addToast((e as Error).message);
        return false;
      }
    },
    addZone: async (name) => {
      try { await api.zones.create(name); await get().refresh(); addToast(`Zone ${name} created`, 'success'); } catch (e) { addToast((e as Error).message); }
    },
    updateZone: async (id, data) => {
      try { await api.zones.update(id, data); await get().refresh(); addToast('Zone updated', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    removeZone: async (id) => {
      try { await api.zones.remove(id); await get().refresh(); addToast('Zone removed', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    attachMember: async (zoneId, endpointId) => {
      try { await api.zones.attach(zoneId, endpointId); await get().refresh(); } catch (e) { addToast((e as Error).message); }
    },
    detachMember: async (zoneId, endpointId) => {
      try { await api.zones.detach(zoneId, endpointId); await get().refresh(); } catch (e) { addToast((e as Error).message); }
    },
    createProfile: async (data) => {
      try { await api.profiles.create(data); await get().refresh(); addToast('Profile created', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    updateProfile: async (id, data) => {
      try { await api.profiles.update(id, data); await get().refresh(); addToast('Profile updated', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    removeProfile: async (id) => {
      try { await api.profiles.remove(id); await get().refresh(); addToast('Profile removed', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    createPaGroup: async (data) => {
      try { await api.paGroups.create(data); await get().refresh(); addToast('PA group created', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    updatePaGroup: async (id, data) => {
      try { await api.paGroups.update(id, data); await get().refresh(); addToast('PA group updated', 'success'); } catch (e) { addToast((e as Error).message); }
    },
    removePaGroup: async (id) => {
      try { await api.paGroups.remove(id); await get().refresh(); addToast('PA group removed', 'success'); } catch (e) { addToast((e as Error).message); }
    },
  };
});
