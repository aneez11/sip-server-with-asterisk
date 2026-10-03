import type {
  Announcement,
  AuthResponse,
  AutoAnswerProfile,
  BroadcastLog,
  CallsSnapshot,
  Endpoint,
  Music,
  OverviewResponse,
  PaGroup,
  Zone,
} from "@infinity/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    ...options,
  });
  if (res.status === 401 && !path.includes("/auth/login")) {
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data as any)?.message ?? `HTTP ${res.status}`,
      (data as any)?.errors,
    );
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  overview: () => request<OverviewResponse>("/api/status/overview"),

  monitor: {
    snapshot: () => request<CallsSnapshot>("/api/monitor"),
    endCall: (callId: string) =>
      request<{ stopped: number }>("/api/monitor/end-call", {
        method: "POST",
        body: JSON.stringify({ callId }),
      }),
  },

  endpoints: {
    list: () => request<Endpoint[]>("/api/endpoints"),
    create: (data: {
      extension: string;
      label: string;
      location: string;
      type: "phone" | "speaker";
    }) =>
      request<Endpoint & { sipPassword?: string }>("/api/endpoints", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (
      id: number,
      data: {
        label: string;
        location: string;
        type: string;
        isActive: boolean;
      },
    ) =>
      request<Endpoint>(`/api/endpoints/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    regeneratePassword: (id: number) =>
      request<Endpoint>(`/api/endpoints/${id}/regenerate-password`, {
        method: "POST",
      }),
    remove: (id: number) =>
      request<void>(`/api/endpoints/${id}`, { method: "DELETE" }),
    setActive: (id: number, active: boolean) =>
      request<Endpoint>(
        `/api/endpoints/${id}/${active ? "activate" : "deactivate"}`,
        { method: "POST" },
      ),
    requalify: (id: number) =>
      request<{ ok: boolean }>(`/api/endpoints/${id}/requalify`, {
        method: "POST",
      }),
  },

  zones: {
    list: () => request<Zone[]>("/api/zones"),
    create: (
      name: string,
      data?: {
        beep?: boolean;
        volume?: number | null;
        announcementId?: number | null;
        autoAnswerProfileId?: number | null;
      },
    ) =>
      request<Zone>("/api/zones", {
        method: "POST",
        body: JSON.stringify({ name, ...(data ?? {}) }),
      }),
    update: (
      id: number,
      data: {
        name: string;
        beep: boolean;
        volume: number | null;
        announcementId: number | null;
        autoAnswerProfileId: number | null;
      },
    ) =>
      request<{ ok: boolean }>(`/api/zones/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id: number) =>
      request<void>(`/api/zones/${id}`, { method: "DELETE" }),
    attach: (zoneId: number, endpointId: number) =>
      request<{ ok: boolean }>(`/api/zones/${zoneId}/members`, {
        method: "POST",
        body: JSON.stringify({ endpointId }),
      }),
    detach: (zoneId: number, endpointId: number) =>
      request<void>(`/api/zones/${zoneId}/members/${endpointId}`, {
        method: "DELETE",
      }),
  },

  profiles: {
    create: (data: {
      name: string;
      userAgentMatch?: string | null;
      alertInfo?: string | null;
      callInfo?: string | null;
      sipUri?: string | null;
      dTime?: number | null;
      dialOptions?: string | null;
    }) =>
      request<AutoAnswerProfile>("/api/profiles", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (
      id: number,
      data: {
        name: string;
        userAgentMatch?: string | null;
        alertInfo?: string | null;
        callInfo?: string | null;
        sipUri?: string | null;
        dTime?: number | null;
        dialOptions?: string | null;
      },
    ) =>
      request<AutoAnswerProfile>(`/api/profiles/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id: number) =>
      request<void>(`/api/profiles/${id}`, { method: "DELETE" }),
  },

  paGroups: {
    list: () => request<PaGroup[]>("/api/pa-groups"),
    create: (data: {
      name: string;
      extension: string;
      initiatorEndpointId: number | null;
      paStartAnnouncementId: number | null;
      paEndAnnouncementId: number | null;
      receiverEndpointIds: number[];
    }) =>
      request<PaGroup>("/api/pa-groups", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (
      id: number,
      data: Partial<{
        name: string;
        extension: string;
        initiatorEndpointId: number | null;
        paStartAnnouncementId: number | null;
        paEndAnnouncementId: number | null;
        receiverEndpointIds: number[];
      }>,
    ) =>
      request<PaGroup>(`/api/pa-groups/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id: number) =>
      request<void>(`/api/pa-groups/${id}`, { method: "DELETE" }),
  },

  announcements: {
    list: () => request<Announcement[]>("/api/announcements"),
    upload: (file: File, name?: string) => {
      const fd = new FormData();
      fd.append("file", file);
      if (name) fd.append("name", name);
      return request<Announcement>("/api/announcements", {
        method: "POST",
        body: fd,
      });
    },
    remove: (id: number) =>
      request<void>(`/api/announcements/${id}`, { method: "DELETE" }),
    play: (id: number, endpointIds: number[]) =>
      request<{ broadcastLogId: number }>(`/api/announcements/${id}/play`, {
        method: "POST",
        body: JSON.stringify({ endpointIds }),
      }),
    audioUrl: (id: number) => `/api/announcements/${id}/audio`,
  },

  broadcast: {
    zone: (zoneId: number) =>
      request<{ broadcastLogId: number }>("/api/broadcast", {
        method: "POST",
        body: JSON.stringify({ mode: "zone", zoneId }),
      }),
    adhoc: (endpointIds: number[]) =>
      request<{ broadcastLogId: number }>("/api/broadcast", {
        method: "POST",
        body: JSON.stringify({ mode: "adhoc", endpointIds }),
      }),
    stop: (logId?: number) =>
      request<{ stopped: number }>("/api/broadcast/stop", {
        method: "POST",
        body: JSON.stringify({ logId: logId ?? null }),
      }),
  },

  talk: {
    start: (endpointIds: number[]) =>
      request<{
        id: string;
        mode: "live" | "twoway";
        endpointIds: number[];
        startedAt: string;
      }>("/api/talk/start", {
        method: "POST",
        body: JSON.stringify({ endpointIds }),
      }),
    stop: (talkId?: string) =>
      request<{ stopped: number }>("/api/talk/stop", {
        method: "POST",
        body: JSON.stringify({ talkId: talkId ?? null }),
      }),
    status: () =>
      request<{
        active: {
          id: string;
          mode: "live" | "twoway";
          endpointIds: number[];
          startedAt: string;
        }[];
      }>("/api/talk/status"),
  },

  music: {
    upload: (file: File, name?: string) => {
      const fd = new FormData();
      fd.append("file", file);
      if (name) fd.append("name", name);
      return request<Music>("/api/music", { method: "POST", body: fd });
    },
    remove: (id: number) =>
      request<void>(`/api/music/${id}`, { method: "DELETE" }),
    play: (id: number, endpointIds: number[]) =>
      request<{ broadcastLogId: number }>(`/api/music/${id}/play`, {
        method: "POST",
        body: JSON.stringify({ endpointIds }),
      }),
    stop: () =>
      request<{ stopped: number }>("/api/music/stop", { method: "POST" }),
  },

  // Unified media index (announcements + music) for the Media Manager.
  media: {
    list: () => request<(Announcement & { music: boolean })[]>("/api/media"),
  },
};
