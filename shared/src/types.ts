export type EndpointType = "phone" | "speaker";

export interface Endpoint {
  id: number;
  extension: string;
  label: string;
  location: string;
  type: EndpointType;
  isActive: boolean;
  registered: boolean;
  contact?: string | null;
  contactIp?: string | null;
  userAgent?: string | null;
  sipPassword?: string;
  createdAt?: string;
}

export interface Zone {
  id: number;
  name: string;
  beep: boolean;
  volume: number | null;
  announcementId: number | null;
  autoAnswerProfileId: number | null;
  endpointCount: number;
  endpointIds: number[];
}

export interface AutoAnswerProfile {
  id: number;
  name: string;
  userAgentMatch: string | null;
  alertInfo: string | null;
  callInfo: string | null;
  sipUri: string | null;
  dTime: number | null;
  dialOptions: string | null;
}

// ---- PA groups (initiator/receiver one-to-many announcements) ---------------

export interface PaGroup {
  id: number;
  name: string;
  extension: string;
  initiatorEndpointId: number | null;
  initiatorExtension?: string | null;
  initiatorLabel?: string | null;
  paStartAnnouncementId: number | null;
  paEndAnnouncementId: number | null;
  receiverEndpointIds: number[];
  receiverCount?: number;
  createdAt?: string;
}

/** Resolved group used by the AGI trigger (receiver extension list + audio). */
export interface PaGroupTrigger {
  ok: boolean;
  pageConf: string;
  receivers: string[]; // extensions to originate as member legs
  paStart: string | null; // announcement filename or 'beep'
  paEnd: string | null;
  title: string;
}

export type BroadcastStatus =
  | "pending"
  | "success"
  | "partial"
  | "failed"
  | "stopped";

export interface BroadcastLog {
  id: number;
  status: BroadcastStatus;
  zoneId: number | null;
  zoneName?: string | null;
  title: string;
  endpointIds: number[];
  durationSec?: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Announcement {
  id: number;
  name: string;
  filename: string;
  originalName: string;
  originalFile?: string;
  fileSize: number;
  duration?: number | null;
  flash: boolean;
  music?: boolean;
  createdAt?: string;
}

export interface Music {
  id: number;
  name: string;
  filename: string;
  originalName: string;
  originalFile?: string;
  fileSize: number;
  duration?: number | null;
  createdAt?: string;
}

export interface OverviewResponse {
  endpoints: Endpoint[];
  zones: Zone[];
  recentLogs: BroadcastLog[];
  announcements: Announcement[];
  music: Music[];
  profiles: AutoAnswerProfile[];
  /** Zone ids with a currently active (pending) broadcast. */
  busyZoneIds: number[];
  /** Whether the API is connected to Asterisk's AMI (true status of AMI). */
  amiConnected: boolean;
  /** Docker host LAN IP clients use to reach the SIP server (HOST_IP). */
  serverHost?: string | null;
  serverTime: string;
}

export interface AuthResponse {
  ok: boolean;
  user?: { id: number; username: string; displayName: string };
  message?: string;
}

// ---- live talk (record-then-play) -----------------------------------------

export interface TalkStartResponse {
  broadcastLogId: number;
}

// ---- WebSocket events ------------------------------------------------------

export interface CodecNegotiatedPayload {
  endpointId: number | null;
  extension: string;
  endpointModel: string;
  negotiatedCodec: string;
  broadcastId: number | null;
  ts: number;
}

export type SocketEvent =
  | { type: "broadcast.updated"; log: BroadcastLog }
  | { type: "talk.played"; broadcastLogId: number }
  | { type: "endpoints.changed" }
  | { type: "codec.negotiated"; data: CodecNegotiatedPayload };

// ---- live monitor (active calls) --------------------------------------------

export type CallKind = "broadcast" | "music" | "live" | "twoway";

/** Per-device receive status for an active call. */
export type DeviceCallStatus =
  | "idle"
  | "dialing"
  | "receiving"
  | "done"
  | "missed";

export interface ActiveCallMember {
  extension: string;
  status: DeviceCallStatus;
}

export interface ActiveCall {
  id: string;
  kind: CallKind;
  title: string;
  zoneId: number | null;
  startedAt: string | null;
  members: ActiveCallMember[];
}

export interface CallsSnapshot {
  active: ActiveCall[];
  serverTime: string;
}

export const EVENTS = {
  broadcastUpdated: "broadcast.updated",
  talkPlayed: "talk.played",
  endpointsChanged: "endpoints.changed",
  codecNegotiated: "codec:negotiated",
  callsUpdated: "calls.updated",
} as const;
